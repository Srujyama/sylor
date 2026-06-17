"""
Wave K tests:
  A. Bayesian-flavored calibration
     - POST /api/simulations/{id}/calibrate
     - POST /api/simulations/{id}/calibrate/apply
  B. Causal graph + do-operator
     - GET  /api/graphs/{graph_id}/causal
     - POST /api/graphs/{graph_id}/intervene

Firebase is mocked via the shared ``mock_firebase`` fixture; the in-memory
graph store is seeded directly (the graphs router pattern). LLM calls are
mocked per-test. The calibration math is also exercised at the pure-function
level.
"""
from datetime import datetime
from unittest.mock import patch, AsyncMock

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.calibration import calibrate, resolve_mapping
from app.services.causal import build_causal_dag, do_intervene, edge_sign
from app.services.knowledge_graph import (
    graph_builder, KnowledgeGraph, GraphStatus, EntityNode, EntityEdge,
)

AUTH_HEADER = {"Authorization": "Bearer valid-token"}   # uid test-user-123
USER2_HEADER = {"Authorization": "Bearer user2-token"}   # uid user-2


def _now_iso() -> str:
    return datetime.utcnow().isoformat()


@pytest.fixture(autouse=True)
def _clear_graph_store():
    graph_builder._graphs.clear()
    yield
    graph_builder._graphs.clear()


# ---------------------------------------------------------------------------
# Sim seeding
# ---------------------------------------------------------------------------

def _sim_config():
    return {
        "name": "Wave K Sim",
        "category": "startup",
        "variables": [
            {"name": "price", "label": "Price", "value": 100.0, "type": "currency"},
            {"name": "churn", "label": "Churn", "value": 5.0, "type": "percentage",
             "min": 0.1, "max": 20},
            {"name": "growth", "label": "Growth", "value": 10.0, "type": "number"},
        ],
        "agents": [
            {"type": "customer", "name": "Users", "count": 100, "sensitivity": 0.7},
        ],
        "num_runs": 30,
        "time_horizon": 4,
    }


def _seed_sim(store, sim_id="wk-sim", user_id="test-user-123", status="draft"):
    store[f"simulations/{sim_id}"] = {
        "id": sim_id,
        "user_id": user_id,
        "name": "Wave K Sim",
        "category": "startup",
        "config": _sim_config(),
        "status": status,
        "results": None,
        "run_count": 0,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
        "parent_id": None,
        "root_id": sim_id,
        "branch_label": None,
    }
    return sim_id


# ===========================================================================
# A. Calibration — pure function
# ===========================================================================

class TestCalibrateFunction:
    def test_posterior_between_prior_and_observed(self):
        """Posterior lies strictly between the prior and the observed mean and
        moves TOWARD the data."""
        cfg = [{"name": "price", "label": "Price", "value": 100.0}]
        # Observed mean (150) is well above the prior (100).
        observed = {"price": [140.0, 150.0, 160.0, 150.0]}
        calibrated, score, unmatched = calibrate(cfg, observed)
        assert len(calibrated) == 1
        c = calibrated[0]
        assert c.prior_value == 100.0
        # Strictly between prior and observed mean, and shifted upward.
        assert 100.0 < c.posterior_value < 150.0
        assert c.shift_pct > 0
        assert c.observed_summary["n"] == 4
        assert abs(c.observed_summary["mean"] - 150.0) < 1e-6
        assert unmatched == []

    def test_score_in_range(self):
        cfg = [{"name": "price", "label": "Price", "value": 100.0}]
        observed = {"price": [150.0] * 30}
        _, score, _ = calibrate(cfg, observed)
        assert 0.0 <= score <= 100.0

    def test_tighter_data_raises_score(self):
        """More, tighter observations constrain the parameter more -> higher
        score than few noisy ones."""
        cfg = [{"name": "price", "label": "Price", "value": 100.0}]
        tight = {"price": [150.0] * 50}
        noisy = {"price": [100.0, 200.0, 50.0]}
        _, score_tight, _ = calibrate(cfg, tight)
        _, score_noisy, _ = calibrate(cfg, noisy)
        assert score_tight > score_noisy

    def test_unmatched_columns_reported(self):
        cfg = [{"name": "price", "label": "Price", "value": 100.0}]
        observed = {"price": [110.0], "unknown_col": [1.0, 2.0]}
        calibrated, _, unmatched = calibrate(cfg, observed)
        assert [c.variable_name for c in calibrated] == ["price"]
        assert unmatched == ["unknown_col"]

    def test_fuzzy_name_match(self):
        """Case/separator-insensitive matching maps 'Churn Rate' columns when
        named to match, and explicit mapping wins."""
        cfg = [{"name": "churn", "label": "Churn", "value": 5.0}]
        # Fuzzy: 'Churn' (case-insensitive) -> churn.
        calibrated, _, unmatched = calibrate(cfg, {"Churn": [6.0, 7.0]})
        assert [c.variable_name for c in calibrated] == ["churn"]
        assert unmatched == []

    def test_explicit_mapping(self):
        cfg = [{"name": "churn", "label": "Churn", "value": 5.0}]
        observed = {"col_a": [6.0, 7.0, 8.0]}
        calibrated, _, unmatched = calibrate(cfg, observed, mapping={"col_a": "churn"})
        assert [c.variable_name for c in calibrated] == ["churn"]
        assert unmatched == []

    def test_resolve_mapping_unknown_explicit_target_falls_through(self):
        resolved, unmatched = resolve_mapping(
            ["price"], {"col_a": [1.0]}, mapping={"col_a": "nonexistent"}
        )
        # Explicit target invalid -> fuzzy fails too -> unmatched.
        assert resolved == {}
        assert unmatched == ["col_a"]

    def test_resolve_mapping_enforces_one_to_one(self):
        """Two columns claiming the SAME variable: first wins, second is
        unmatched (no silent duplicate posterior / overwrite)."""
        resolved, unmatched = resolve_mapping(
            ["price"], {"col_a": [1.0], "col_b": [2.0]},
            mapping={"col_a": "price", "col_b": "price"},
        )
        assert resolved == {"col_a": "price"}
        assert unmatched == ["col_b"]

    def test_single_point_series_keeps_finite_uncertainty(self):
        """A single observation must not collapse the posterior to 0 std
        ('infinite certainty from one point')."""
        cfg = [{"name": "price", "label": "Price", "value": 100.0}]
        calibrated, _, _ = calibrate(cfg, {"price": [200.0]})
        c = calibrated[0]
        # Moves toward the data but does not pin exactly onto it, and reports
        # a non-zero uncertainty.
        assert c.posterior_std > 0.0
        assert c.posterior_value < 200.0

    def test_no_matches_score_zero(self):
        cfg = [{"name": "price", "label": "Price", "value": 100.0}]
        calibrated, score, unmatched = calibrate(cfg, {"weird": [1.0]})
        assert calibrated == []
        assert score == 0.0
        assert unmatched == ["weird"]


# ===========================================================================
# A. Calibration — endpoints
# ===========================================================================

class TestCalibrateEndpoint:
    def test_calibrate_shape_with_llm(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="cal-1")
        client = TestClient(app)
        with patch("app.routers.simulations.llm_client.chat",
                   new=AsyncMock(return_value=type("R", (), {"text": "Your price looks higher."})())):
            res = client.post("/api/simulations/cal-1/calibrate", headers=AUTH_HEADER,
                              json={"observed": {"price": [140.0, 150.0, 160.0]}})
        assert res.status_code == 200, res.text
        body = res.json()
        assert len(body["calibrated"]) == 1
        c = body["calibrated"][0]
        assert c["variable_name"] == "price"
        assert 100.0 < c["posterior_value"] < 150.0
        assert 0 <= body["calibration_score"] <= 100
        assert body["unmatched_columns"] == []
        assert "moment-matching" in body["method"]
        assert body["summary"] == "Your price looks higher."

    def test_calibrate_posterior_moves_toward_data(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="cal-2")
        client = TestClient(app)
        with patch("app.routers.simulations.llm_client.chat",
                   new=AsyncMock(side_effect=Exception("LLM down"))):
            res = client.post("/api/simulations/cal-2/calibrate", headers=AUTH_HEADER,
                              json={"observed": {"churn": [10.0, 11.0, 9.0, 10.0]}})
        assert res.status_code == 200, res.text
        c = res.json()["calibrated"][0]
        # Prior 5.0, observed ~10 -> posterior shifts up.
        assert c["prior_value"] == 5.0
        assert c["posterior_value"] > 5.0
        assert c["shift_pct"] > 0

    def test_calibrate_template_fallback(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="cal-fb")
        client = TestClient(app)
        with patch("app.routers.simulations.llm_client.chat",
                   new=AsyncMock(side_effect=Exception("LLM down"))):
            res = client.post("/api/simulations/cal-fb/calibrate", headers=AUTH_HEADER,
                              json={"observed": {"price": [200.0, 210.0]}})
        assert res.status_code == 200
        # Template fallback mentions the lightweight nature honestly.
        assert "lightweight moment-matching Bayesian" in res.json()["summary"]

    def test_calibrate_unmatched_reported(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="cal-un")
        client = TestClient(app)
        with patch("app.routers.simulations.llm_client.chat",
                   new=AsyncMock(side_effect=Exception("down"))):
            res = client.post("/api/simulations/cal-un/calibrate", headers=AUTH_HEADER,
                              json={"observed": {"price": [110.0], "mystery": [1.0, 2.0]}})
        assert res.status_code == 200
        assert res.json()["unmatched_columns"] == ["mystery"]

    def test_calibrate_422_empty_series(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="cal-empty")
        client = TestClient(app)
        res = client.post("/api/simulations/cal-empty/calibrate", headers=AUTH_HEADER,
                          json={"observed": {"price": []}})
        assert res.status_code == 422

    def test_calibrate_422_non_numeric(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="cal-nan")
        client = TestClient(app)
        res = client.post("/api/simulations/cal-nan/calibrate", headers=AUTH_HEADER,
                          json={"observed": {"price": ["a", "b"]}})
        # Either pydantic coercion (422) or our validator (422).
        assert res.status_code == 422

    def test_calibrate_422_no_observed(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="cal-no")
        client = TestClient(app)
        res = client.post("/api/simulations/cal-no/calibrate", headers=AUTH_HEADER,
                          json={"observed": {}})
        assert res.status_code == 422

    def test_calibrate_422_non_finite(self, mock_firebase):
        """NaN/inf pass an isinstance(float) check but would poison the score —
        they must be rejected with 422, not 500 with a NaN response."""
        import json as _json
        _seed_sim(mock_firebase, sim_id="cal-inf")
        client = TestClient(app)
        # JSON literals Infinity/NaN are accepted by the JSON parser; send raw.
        res = client.post(
            "/api/simulations/cal-inf/calibrate", headers=AUTH_HEADER,
            content=_json.dumps({"observed": {"price": [float("inf"), 1.0]}}),
        )
        assert res.status_code == 422

    def test_calibrate_404(self, mock_firebase):
        client = TestClient(app)
        res = client.post("/api/simulations/missing/calibrate", headers=AUTH_HEADER,
                          json={"observed": {"price": [100.0]}})
        assert res.status_code == 404

    def test_calibrate_403_not_owner(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="cal-other", user_id="user-2")
        client = TestClient(app)
        res = client.post("/api/simulations/cal-other/calibrate", headers=AUTH_HEADER,
                          json={"observed": {"price": [100.0]}})
        assert res.status_code == 403


class TestCalibrateApplyEndpoint:
    def test_apply_writes_config(self, mock_firebase):
        sim_id = _seed_sim(mock_firebase, sim_id="ap-1")
        client = TestClient(app)
        old_updated = mock_firebase[f"simulations/{sim_id}"]["updated_at"]
        res = client.post("/api/simulations/ap-1/calibrate/apply", headers=AUTH_HEADER,
                          json={"posteriors": {"price": 142.5, "churn": 9.0}})
        assert res.status_code == 200, res.text
        assert res.json() == {"simulation_id": "ap-1"}
        # Config variable values were updated in the store.
        cfg = mock_firebase[f"simulations/{sim_id}"]["config"]
        vals = {v["name"]: v["value"] for v in cfg["variables"]}
        assert vals["price"] == 142.5
        assert vals["churn"] == 9.0
        assert vals["growth"] == 10.0  # untouched
        # updated_at bumped, status preserved.
        assert mock_firebase[f"simulations/{sim_id}"]["updated_at"] >= old_updated
        assert mock_firebase[f"simulations/{sim_id}"]["status"] == "draft"

    def test_apply_422_unknown_key(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="ap-bad")
        client = TestClient(app)
        res = client.post("/api/simulations/ap-bad/calibrate/apply", headers=AUTH_HEADER,
                          json={"posteriors": {"nonexistent": 1.0}})
        assert res.status_code == 422

    def test_apply_404(self, mock_firebase):
        client = TestClient(app)
        res = client.post("/api/simulations/missing/calibrate/apply", headers=AUTH_HEADER,
                          json={"posteriors": {"price": 1.0}})
        assert res.status_code == 404

    def test_apply_403_not_owner(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="ap-other", user_id="user-2")
        client = TestClient(app)
        res = client.post("/api/simulations/ap-other/calibrate/apply", headers=AUTH_HEADER,
                          json={"posteriors": {"price": 1.0}})
        assert res.status_code == 403


# ===========================================================================
# B. Causal — pure functions
# ===========================================================================

def _edge(uuid, src, tgt, rel, weight=1.0):
    return EntityEdge(uuid=uuid, source_uuid=src, target_uuid=tgt,
                      relation_type=rel, weight=weight)


def _node(uuid, name="N", etype="Factor"):
    return EntityNode(uuid=uuid, name=name, entity_type=etype)


class TestCausalFunctions:
    def test_filters_non_causal_edges(self):
        nodes = [_node("a"), _node("b"), _node("c")]
        edges = [
            _edge("e1", "a", "b", "CAUSES"),
            _edge("e2", "b", "c", "CORRELATES_WITH"),  # non-causal -> dropped
            _edge("e3", "a", "c", "RELATED_TO"),        # non-causal -> dropped
        ]
        dag = build_causal_dag(nodes, edges)
        rels = {(e["source_uuid"], e["target_uuid"]) for e in dag.edges}
        assert rels == {("a", "b")}

    def test_edge_sign_dampens_negative(self):
        assert edge_sign("DAMPENS") == -1
        assert edge_sign("CAUSES") == 1
        assert edge_sign("AMPLIFIES") == 1

    def test_sign_in_dag_edges(self):
        nodes = [_node("a"), _node("b")]
        edges = [_edge("e1", "a", "b", "DAMPENS")]
        dag = build_causal_dag(nodes, edges)
        assert dag.edges[0]["sign"] == "negative"

    def test_cycle_detection(self):
        nodes = [_node("a"), _node("b"), _node("c")]
        edges = [
            _edge("e1", "a", "b", "CAUSES"),
            _edge("e2", "b", "c", "CAUSES"),
            _edge("e3", "c", "a", "CAUSES"),  # closes a cycle
        ]
        dag = build_causal_dag(nodes, edges)
        assert dag.has_cycles is True
        assert dag.cycle_note is not None

    def test_acyclic_no_note(self):
        nodes = [_node("a"), _node("b")]
        edges = [_edge("e1", "a", "b", "CAUSES")]
        dag = build_causal_dag(nodes, edges)
        assert dag.has_cycles is False
        assert dag.cycle_note is None

    def test_do_intervene_signed_decaying(self):
        # a -> b -> c, all positive. Increasing a pushes b and c up; c decays.
        nodes = [_node("a"), _node("b"), _node("c")]
        edges = [
            _edge("e1", "a", "b", "CAUSES"),
            _edge("e2", "b", "c", "CAUSES"),
        ]
        dag = build_causal_dag(nodes, edges)
        effects = do_intervene(dag, "a", "increase", magnitude=1.0)
        by_uuid = {e["uuid"]: e for e in effects}
        assert by_uuid["b"]["predicted_change"] > 0
        assert by_uuid["c"]["predicted_change"] > 0
        # c is further -> smaller magnitude (decay) and longer path.
        assert abs(by_uuid["c"]["predicted_change"]) < abs(by_uuid["b"]["predicted_change"])
        assert by_uuid["b"]["path_length"] == 1
        assert by_uuid["c"]["path_length"] == 2
        # Sorted by absolute magnitude descending.
        assert abs(effects[0]["predicted_change"]) >= abs(effects[-1]["predicted_change"])

    def test_do_intervene_negative_edge_flips_sign(self):
        nodes = [_node("a"), _node("b")]
        edges = [_edge("e1", "a", "b", "DAMPENS")]
        dag = build_causal_dag(nodes, edges)
        # Increasing a through a DAMPENS edge pushes b DOWN.
        up = do_intervene(dag, "a", "increase", magnitude=1.0)
        assert up[0]["uuid"] == "b"
        assert up[0]["predicted_change"] < 0
        # Decreasing a flips it back up.
        down = do_intervene(dag, "a", "decrease", magnitude=1.0)
        assert down[0]["predicted_change"] > 0

    def test_do_intervene_bounded(self):
        # Strong weights still bound predicted_change to [-1, 1].
        nodes = [_node("a"), _node("b")]
        edges = [_edge("e1", "a", "b", "AMPLIFIES", weight=10.0)]
        dag = build_causal_dag(nodes, edges)
        effects = do_intervene(dag, "a", "increase", magnitude=1.0)
        assert -1.0 <= effects[0]["predicted_change"] <= 1.0

    def test_do_intervene_unknown_node_raises(self):
        dag = build_causal_dag([_node("a")], [])
        with pytest.raises(KeyError):
            do_intervene(dag, "nope", "increase")

    def test_do_intervene_terminates_on_cycle(self):
        # A 3-cycle must not loop forever — depth bound stops it.
        nodes = [_node("a"), _node("b"), _node("c")]
        edges = [
            _edge("e1", "a", "b", "CAUSES"),
            _edge("e2", "b", "c", "CAUSES"),
            _edge("e3", "c", "a", "CAUSES"),
        ]
        dag = build_causal_dag(nodes, edges)
        effects = do_intervene(dag, "a", "increase", magnitude=1.0)
        # b and c get effects; the intervened node a is never its own downstream.
        uuids = {e["uuid"] for e in effects}
        assert "a" not in uuids
        assert "b" in uuids and "c" in uuids

    def test_deep_chain_no_recursion_overflow(self):
        """A causal chain deeper than Python's recursion limit must not 500 the
        cycle-detection pass (iterative DFS)."""
        depth = 3000  # well past the default recursion limit of ~1000
        nodes = [_node(f"n{i}") for i in range(depth)]
        edges = [_edge(f"e{i}", f"n{i}", f"n{i+1}", "CAUSES") for i in range(depth - 1)]
        dag = build_causal_dag(nodes, edges)  # must not raise RecursionError
        assert dag.has_cycles is False


# ===========================================================================
# B. Causal — endpoints
# ===========================================================================

def _seed_causal_graph(graph_id="cg", user_id="test-user-123", with_cycle=False):
    graph = KnowledgeGraph(graph_id=graph_id, name="Causal", status=GraphStatus.READY,
                           user_id=user_id)
    n_a = EntityNode(uuid="a", name="Marketing Spend", entity_type="Factor")
    n_b = EntityNode(uuid="b", name="Signups", entity_type="Metric")
    n_c = EntityNode(uuid="c", name="Revenue", entity_type="Metric")
    n_d = EntityNode(uuid="d", name="Churn", entity_type="Metric")
    graph.nodes = {n.uuid: n for n in (n_a, n_b, n_c, n_d)}
    edges = {
        "e1": EntityEdge(uuid="e1", source_uuid="a", target_uuid="b",
                         relation_type="CAUSES", weight=0.9),
        "e2": EntityEdge(uuid="e2", source_uuid="b", target_uuid="c",
                         relation_type="AMPLIFIES", weight=0.8),
        "e3": EntityEdge(uuid="e3", source_uuid="d", target_uuid="c",
                         relation_type="DAMPENS", weight=0.7),
        # Non-causal edge — must be filtered out of the causal view.
        "e4": EntityEdge(uuid="e4", source_uuid="a", target_uuid="d",
                         relation_type="CORRELATES_WITH", weight=0.5),
    }
    if with_cycle:
        edges["e5"] = EntityEdge(uuid="e5", source_uuid="c", target_uuid="a",
                                 relation_type="TRIGGERS", weight=0.6)
    graph.edges = edges
    graph_builder._graphs[graph_id] = graph
    return graph_id


class TestCausalEndpoint:
    def test_causal_view_filters_non_causal(self, mock_firebase):
        _seed_causal_graph(graph_id="cg-1")
        client = TestClient(app)
        res = client.get("/api/graphs/cg-1/causal", headers=AUTH_HEADER)
        assert res.status_code == 200, res.text
        body = res.json()
        rels = {(e["source_uuid"], e["target_uuid"]): e["relation_type"]
                for e in body["edges"]}
        # CORRELATES_WITH (a->d) filtered out.
        assert ("a", "d") not in rels
        assert ("a", "b") in rels and ("b", "c") in rels and ("d", "c") in rels
        # DAMPENS edge is negative.
        dampens = next(e for e in body["edges"] if e["relation_type"] == "DAMPENS")
        assert dampens["sign"] == "negative"
        assert body["has_cycles"] is False
        assert "cycle_note" not in body
        assert len(body["nodes"]) == 4

    def test_causal_view_flags_cycle(self, mock_firebase):
        _seed_causal_graph(graph_id="cg-cyc", with_cycle=True)
        client = TestClient(app)
        res = client.get("/api/graphs/cg-cyc/causal", headers=AUTH_HEADER)
        assert res.status_code == 200
        body = res.json()
        assert body["has_cycles"] is True
        assert "cycle_note" in body

    def test_causal_404(self, mock_firebase):
        client = TestClient(app)
        res = client.get("/api/graphs/missing/causal", headers=AUTH_HEADER)
        assert res.status_code == 404

    def test_causal_403_not_owner(self, mock_firebase):
        _seed_causal_graph(graph_id="cg-other", user_id="user-2")
        client = TestClient(app)
        res = client.get("/api/graphs/cg-other/causal", headers=AUTH_HEADER)
        assert res.status_code == 403


class TestInterveneEndpoint:
    def test_intervene_signed_downstream(self, mock_firebase):
        _seed_causal_graph(graph_id="iv-1")
        client = TestClient(app)
        res = client.post("/api/graphs/iv-1/intervene", headers=AUTH_HEADER,
                          json={"node_uuid": "a", "direction": "increase", "magnitude": 1.0})
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["intervened_node"]["uuid"] == "a"
        by_uuid = {e["uuid"]: e for e in body["effects"]}
        # a -> b (CAUSES) -> c (AMPLIFIES): both positive.
        assert by_uuid["b"]["predicted_change"] > 0
        assert by_uuid["c"]["predicted_change"] > 0
        # c is downstream of b -> smaller magnitude (decay) and longer path.
        assert abs(by_uuid["c"]["predicted_change"]) < abs(by_uuid["b"]["predicted_change"])
        assert by_uuid["b"]["path_length"] == 1
        assert by_uuid["c"]["path_length"] == 2
        assert "directional inference" in body["note"].lower()

    def test_intervene_negative_edge(self, mock_firebase):
        _seed_causal_graph(graph_id="iv-neg")
        client = TestClient(app)
        # Increasing Churn (d) DAMPENS Revenue (c) -> c goes down.
        res = client.post("/api/graphs/iv-neg/intervene", headers=AUTH_HEADER,
                          json={"node_uuid": "d", "direction": "increase"})
        assert res.status_code == 200
        by_uuid = {e["uuid"]: e for e in res.json()["effects"]}
        assert by_uuid["c"]["predicted_change"] < 0

    def test_intervene_default_magnitude(self, mock_firebase):
        _seed_causal_graph(graph_id="iv-def")
        client = TestClient(app)
        res = client.post("/api/graphs/iv-def/intervene", headers=AUTH_HEADER,
                          json={"node_uuid": "a", "direction": "increase"})
        assert res.status_code == 200
        assert res.json()["effects"]  # non-empty

    def test_intervene_422_unknown_node(self, mock_firebase):
        _seed_causal_graph(graph_id="iv-bad")
        client = TestClient(app)
        res = client.post("/api/graphs/iv-bad/intervene", headers=AUTH_HEADER,
                          json={"node_uuid": "nonexistent", "direction": "increase"})
        assert res.status_code == 422

    def test_intervene_422_bad_direction(self, mock_firebase):
        _seed_causal_graph(graph_id="iv-dir")
        client = TestClient(app)
        res = client.post("/api/graphs/iv-dir/intervene", headers=AUTH_HEADER,
                          json={"node_uuid": "a", "direction": "sideways"})
        assert res.status_code == 422

    def test_intervene_404(self, mock_firebase):
        client = TestClient(app)
        res = client.post("/api/graphs/missing/intervene", headers=AUTH_HEADER,
                          json={"node_uuid": "a", "direction": "increase"})
        assert res.status_code == 404

    def test_intervene_403_not_owner(self, mock_firebase):
        _seed_causal_graph(graph_id="iv-other", user_id="user-2")
        client = TestClient(app)
        res = client.post("/api/graphs/iv-other/intervene", headers=AUTH_HEADER,
                          json={"node_uuid": "a", "direction": "increase"})
        assert res.status_code == 403
