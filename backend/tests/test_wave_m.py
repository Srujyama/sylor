"""
Wave M tests: cross-domain composite simulations.

Covers:
  - validate_dag rejects cycles + unknown node/variable refs (pure function).
  - run_composite per-path uncertainty propagation actually couples the sims:
    factor=0 vs a large factor changes the downstream success_probability under
    the SAME base_seed (proving the link is wired, not ignored).
  - Endpoints A/B/C: create + get + list + delete roundtrip, owner-scoped
    (+403 cross-user), run shape matches the contract, node-cap + num_runs cap.

Firebase is mocked via the shared ``mock_firebase`` fixture. The single LLM call
for the run summary is mocked (AsyncMock). num_runs is kept tiny (20-50).
"""
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.composite import (
    CompositeConfig,
    CompositeValidationError,
    run_composite,
    validate_dag,
)

AUTH_HEADER = {"Authorization": "Bearer valid-token"}    # uid test-user-123
USER2_HEADER = {"Authorization": "Bearer user2-token"}   # uid user-2


# ---------------------------------------------------------------------------
# Config builders
# ---------------------------------------------------------------------------

def _biology_node():
    return {
        "node_id": "biology",
        "label": "Drug Binding",
        "config": {
            "name": "Binding Model",
            "category": "biology",
            "variables": [
                {"name": "num_molecules", "label": "Molecules", "value": 128},
                {"name": "sim_steps", "label": "Steps", "value": 300},
                {"name": "binding_affinity", "label": "Kd", "value": 10},
                {"name": "concentration", "label": "Concentration", "value": 100},
            ],
            "agents": [
                {"type": "molecule", "name": "Ligand", "count": 128, "sensitivity": 0.7},
                {"type": "enzyme", "name": "Enzyme", "count": 5, "sensitivity": 0.6},
            ],
            "num_runs": 40,
            "time_horizon": 6,
        },
    }


def _business_node():
    return {
        "node_id": "business",
        "label": "Go To Market",
        "config": {
            "name": "GTM Model",
            "category": "startup",
            "variables": [
                {"name": "budget", "label": "Budget", "value": 50000, "type": "currency"},
                {"name": "price_per_unit", "label": "Price", "value": 99, "type": "currency"},
                {"name": "conversion_rate", "label": "Conversion", "value": 5,
                 "type": "percentage", "min": 0, "max": 100},
                {"name": "market_size", "label": "Market", "value": 1000000},
            ],
            "agents": [
                {"type": "customer", "name": "Customers", "count": 100, "sensitivity": 0.7},
                {"type": "market", "name": "Market", "count": 1, "sensitivity": 0.6},
            ],
            "num_runs": 40,
            "time_horizon": 6,
        },
    }


def _per_path_composite(factor: float, num_runs: int = 40) -> dict:
    """biology --(final_market_share -> conversion_rate, linear*factor)--> business."""
    return {
        "name": "Bio to Biz",
        "num_runs": num_runs,
        "nodes": [_biology_node(), _business_node()],
        "links": [{
            "from_node": "biology",
            "from_metric": "final_market_share",
            "to_node": "business",
            "to_variable": "conversion_rate",
            "transform": "linear",
            "factor": factor,
        }],
    }


def _aggregate_composite(num_runs: int = 40) -> dict:
    """biology --(avg_market_share -> conversion_rate, scale)--> business (mean-passed)."""
    c = _per_path_composite(1.0, num_runs)
    c["links"] = [{
        "from_node": "biology",
        "from_metric": "avg_market_share",
        "to_node": "business",
        "to_variable": "conversion_rate",
        "transform": "scale",
        "factor": 2.0,
    }]
    return c


_NARRATIVE = AsyncMock(return_value=type("R", (), {"text": "Domains fed each other."})())


# ===========================================================================
# A. validate_dag — pure function
# ===========================================================================

class TestValidateDag:
    def test_topo_order_correct(self):
        composite = CompositeConfig.from_dict(_per_path_composite(1.0))
        order = validate_dag(composite)
        assert order == ["biology", "business"]

    def test_rejects_unknown_to_node(self):
        cfg = _per_path_composite(1.0)
        cfg["links"][0]["to_node"] = "ghost"
        with pytest.raises(CompositeValidationError):
            validate_dag(CompositeConfig.from_dict(cfg))

    def test_rejects_unknown_from_node(self):
        cfg = _per_path_composite(1.0)
        cfg["links"][0]["from_node"] = "ghost"
        with pytest.raises(CompositeValidationError):
            validate_dag(CompositeConfig.from_dict(cfg))

    def test_rejects_unknown_to_variable(self):
        cfg = _per_path_composite(1.0)
        cfg["links"][0]["to_variable"] = "not_a_real_var"
        with pytest.raises(CompositeValidationError):
            validate_dag(CompositeConfig.from_dict(cfg))

    def test_rejects_cycle(self):
        cfg = _per_path_composite(1.0)
        # Add a back-edge business -> biology to close a cycle.
        cfg["links"].append({
            "from_node": "business",
            "from_metric": "avg_revenue",
            "to_node": "biology",
            "to_variable": "binding_affinity",
            "transform": "direct",
        })
        with pytest.raises(CompositeValidationError):
            validate_dag(CompositeConfig.from_dict(cfg))

    def test_rejects_invalid_metric(self):
        cfg = _per_path_composite(1.0)
        cfg["links"][0]["from_metric"] = "made_up_metric"
        with pytest.raises(CompositeValidationError):
            validate_dag(CompositeConfig.from_dict(cfg))

    def test_deep_chain_no_recursion(self):
        """A long linear chain must topo-sort iteratively (no recursion limit)."""
        nodes = []
        links = []
        depth = 6  # capped at MAX_NODES; iterative either way
        for i in range(depth):
            n = _business_node()
            n["node_id"] = f"n{i}"
            n["label"] = f"Node {i}"
            nodes.append(n)
            if i > 0:
                links.append({
                    "from_node": f"n{i-1}",
                    "from_metric": "avg_revenue",
                    "to_node": f"n{i}",
                    "to_variable": "budget",
                    "transform": "direct",
                })
        composite = CompositeConfig.from_dict({"name": "chain", "nodes": nodes, "links": links})
        order = validate_dag(composite)
        assert order == [f"n{i}" for i in range(depth)]


# ===========================================================================
# B. run_composite — per-path coupling
# ===========================================================================

class TestRunComposite:
    def test_topo_order_and_terminal(self):
        resp = run_composite(CompositeConfig.from_dict(_per_path_composite(10.0)), base_seed=42)
        assert resp["order"] == ["biology", "business"]
        assert resp["composite_outcome"]["terminal_node"] == "business"

    def test_per_path_link_couples_sims(self):
        """factor=0 vs a large factor MUST change the downstream success_probability
        under the SAME base_seed — proving the per-path link is genuinely wired."""
        seed = 777
        r0 = run_composite(CompositeConfig.from_dict(_per_path_composite(0.0)), base_seed=seed)
        rbig = run_composite(CompositeConfig.from_dict(_per_path_composite(50.0)), base_seed=seed)

        biz0 = next(n for n in r0["nodes"] if n["node_id"] == "business")["results"]
        bizbig = next(n for n in rbig["nodes"] if n["node_id"] == "business")["results"]
        # Same base_seed: any difference is signal from the link, not MC noise.
        assert biz0["success_probability"] != bizbig["success_probability"]
        # A factor of 0 injects conversion_rate=0 -> business cannot succeed.
        assert biz0["success_probability"] < bizbig["success_probability"]

    def test_deterministic_same_seed(self):
        a = run_composite(CompositeConfig.from_dict(_per_path_composite(10.0)), base_seed=5)
        b = run_composite(CompositeConfig.from_dict(_per_path_composite(10.0)), base_seed=5)
        assert a["composite_outcome"] == b["composite_outcome"]

    def test_links_applied_mean_injected(self):
        resp = run_composite(CompositeConfig.from_dict(_per_path_composite(50.0)), base_seed=9)
        assert len(resp["links_applied"]) == 1
        la = resp["links_applied"][0]
        assert la["from_node"] == "biology" and la["to_node"] == "business"
        assert la["from_metric"] == "final_market_share"
        assert la["to_variable"] == "conversion_rate"
        # Non-trivial mean injected value (final_market_share * 50, averaged).
        assert la["mean_injected_value"] > 0

    def test_response_shape(self):
        resp = run_composite(CompositeConfig.from_dict(_per_path_composite(10.0)), base_seed=1)
        for key in ("order", "base_seed", "nodes", "links_applied",
                    "composite_outcome", "contribution", "summary"):
            assert key in resp
        assert resp["base_seed"] == 1
        assert len(resp["nodes"]) == 2
        assert len(resp["contribution"]) == 2
        # composite_outcome surfaces the terminal node's headline.
        biz = next(n for n in resp["nodes"] if n["node_id"] == "business")["results"]
        assert resp["composite_outcome"]["success_probability"] == biz["success_probability"]
        assert resp["composite_outcome"]["avg_revenue"] == biz["avg_revenue"]
        # Each node payload carries category + a SimulationResults-shaped dict.
        for n in resp["nodes"]:
            assert "category" in n
            assert "success_probability" in n["results"]
            assert "confidence_interval" in n["results"]

    def test_aggregate_link_path(self):
        """Aggregate from_metric (avg_market_share) injects a constant override."""
        resp = run_composite(CompositeConfig.from_dict(_aggregate_composite()), base_seed=3)
        assert resp["order"] == ["biology", "business"]
        la = resp["links_applied"][0]
        assert la["from_metric"] == "avg_market_share"
        assert la["transform"] == "scale"
        # Mean injected equals avg_market_share * 2.0 (constant across paths).
        bio = next(n for n in resp["nodes"] if n["node_id"] == "biology")["results"]
        assert la["mean_injected_value"] == pytest.approx(bio["avg_market_share"] * 2.0, rel=1e-3)

    def test_no_nodes_raises(self):
        with pytest.raises(CompositeValidationError):
            run_composite(CompositeConfig.from_dict({"name": "empty", "nodes": [], "links": []}))


# ===========================================================================
# C. Endpoints — create / get / list / delete / run
# ===========================================================================

class TestCompositeEndpoints:
    def test_create_get_list_delete_roundtrip(self, mock_firebase):
        client = TestClient(app)
        # Create
        res = client.post("/api/composites", headers=AUTH_HEADER,
                          json=_per_path_composite(10.0))
        assert res.status_code == 201, res.text
        body = res.json()
        cid = body["composite_id"]
        assert body["status"] == "created"

        # Get — nodes/links/num_runs must be lifted to the TOP level (the
        # detail page reads them there; they're stored nested under config).
        got = client.get(f"/api/composites/{cid}", headers=AUTH_HEADER)
        assert got.status_code == 200
        gj = got.json()
        assert gj["name"] == "Bio to Biz"
        assert gj["node_count"] == 2
        assert isinstance(gj.get("nodes"), list) and len(gj["nodes"]) == 2
        assert isinstance(gj.get("links"), list) and len(gj["links"]) >= 1
        assert isinstance(gj.get("num_runs"), int)

        # List
        listed = client.get("/api/composites", headers=AUTH_HEADER)
        assert listed.status_code == 200
        comps = listed.json()["composites"]
        assert any(c["composite_id"] == cid and c["node_count"] == 2 for c in comps)

        # Delete
        deleted = client.delete(f"/api/composites/{cid}", headers=AUTH_HEADER)
        assert deleted.status_code == 204
        assert client.get(f"/api/composites/{cid}", headers=AUTH_HEADER).status_code == 404

    def test_create_422_cycle(self, mock_firebase):
        client = TestClient(app)
        cfg = _per_path_composite(1.0)
        cfg["links"].append({
            "from_node": "business", "from_metric": "avg_revenue",
            "to_node": "biology", "to_variable": "binding_affinity", "transform": "direct",
        })
        res = client.post("/api/composites", headers=AUTH_HEADER, json=cfg)
        assert res.status_code == 422

    def test_create_422_non_finite_factor(self, mock_firebase):
        """A NaN/inf link factor must be rejected at create (it would otherwise
        crash the run with an unhandled 500 deep in the engine)."""
        import json as _json
        client = TestClient(app)
        cfg = _per_path_composite(1.0)
        cfg["links"][0]["factor"] = float("inf")
        res = client.post("/api/composites", headers=AUTH_HEADER,
                          content=_json.dumps(cfg))
        assert res.status_code == 422

    def test_create_422_unknown_to_variable(self, mock_firebase):
        client = TestClient(app)
        cfg = _per_path_composite(1.0)
        cfg["links"][0]["to_variable"] = "does_not_exist"
        res = client.post("/api/composites", headers=AUTH_HEADER, json=cfg)
        assert res.status_code == 422

    def test_create_422_unknown_node(self, mock_firebase):
        client = TestClient(app)
        cfg = _per_path_composite(1.0)
        cfg["links"][0]["to_node"] = "ghost"
        res = client.post("/api/composites", headers=AUTH_HEADER, json=cfg)
        assert res.status_code == 422

    def test_create_422_too_many_nodes(self, mock_firebase):
        client = TestClient(app)
        nodes = []
        for i in range(7):  # > MAX_NODES (6)
            n = _business_node()
            n["node_id"] = f"n{i}"
            nodes.append(n)
        cfg = {"name": "big", "nodes": nodes, "links": []}
        res = client.post("/api/composites", headers=AUTH_HEADER, json=cfg)
        assert res.status_code == 422

    def test_create_422_num_runs_cap(self, mock_firebase):
        client = TestClient(app)
        cfg = _per_path_composite(1.0)
        cfg["num_runs"] = 999999  # > MAX_NUM_RUNS
        res = client.post("/api/composites", headers=AUTH_HEADER, json=cfg)
        assert res.status_code == 422

    def test_get_403_cross_user(self, mock_firebase):
        client = TestClient(app)
        res = client.post("/api/composites", headers=USER2_HEADER, json=_per_path_composite(1.0))
        cid = res.json()["composite_id"]
        assert client.get(f"/api/composites/{cid}", headers=AUTH_HEADER).status_code == 403

    def test_delete_403_cross_user(self, mock_firebase):
        client = TestClient(app)
        res = client.post("/api/composites", headers=USER2_HEADER, json=_per_path_composite(1.0))
        cid = res.json()["composite_id"]
        assert client.delete(f"/api/composites/{cid}", headers=AUTH_HEADER).status_code == 403

    def test_get_404(self, mock_firebase):
        client = TestClient(app)
        assert client.get("/api/composites/missing", headers=AUTH_HEADER).status_code == 404

    def test_list_owner_scoped(self, mock_firebase):
        client = TestClient(app)
        client.post("/api/composites", headers=AUTH_HEADER, json=_per_path_composite(1.0))
        client.post("/api/composites", headers=USER2_HEADER, json=_per_path_composite(1.0))
        mine = client.get("/api/composites", headers=AUTH_HEADER).json()["composites"]
        # Only my own composite(s) are listed.
        assert len(mine) == 1

    def test_run_shape_and_persist(self, mock_firebase):
        client = TestClient(app)
        cid = client.post("/api/composites", headers=AUTH_HEADER,
                          json=_per_path_composite(10.0, num_runs=30)).json()["composite_id"]
        with patch("app.services.composite.llm_client.chat", new=_NARRATIVE):
            res = client.post(f"/api/composites/{cid}/run", headers=AUTH_HEADER,
                              json={"num_runs": 30})
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["composite_id"] == cid
        assert body["order"] == ["biology", "business"]
        assert body["composite_outcome"]["terminal_node"] == "business"
        assert len(body["links_applied"]) == 1
        assert "mean_injected_value" in body["links_applied"][0]
        assert body["summary"] == "Domains fed each other."
        # Results persisted + status flipped to completed.
        stored = client.get(f"/api/composites/{cid}", headers=AUTH_HEADER).json()
        assert stored["status"] == "completed"
        assert stored["results"]["composite_outcome"]["terminal_node"] == "business"

    def test_run_summary_template_fallback(self, mock_firebase):
        client = TestClient(app)
        cid = client.post("/api/composites", headers=AUTH_HEADER,
                          json=_per_path_composite(10.0, num_runs=20)).json()["composite_id"]
        with patch("app.services.composite.llm_client.chat",
                   new=AsyncMock(side_effect=Exception("LLM down"))):
            res = client.post(f"/api/composites/{cid}/run", headers=AUTH_HEADER,
                              json={"num_runs": 20})
        assert res.status_code == 200
        # Falls back to the deterministic template narrative.
        assert "Composite 'Bio to Biz'" in res.json()["summary"]

    def test_run_num_runs_cap(self, mock_firebase):
        client = TestClient(app)
        cid = client.post("/api/composites", headers=AUTH_HEADER,
                          json=_per_path_composite(1.0)).json()["composite_id"]
        # num_runs above MAX_NUM_RUNS is rejected by the request model (422).
        res = client.post(f"/api/composites/{cid}/run", headers=AUTH_HEADER,
                          json={"num_runs": 99999})
        assert res.status_code == 422

    def test_run_404(self, mock_firebase):
        client = TestClient(app)
        res = client.post("/api/composites/missing/run", headers=AUTH_HEADER, json={})
        assert res.status_code == 404

    def test_run_403_cross_user(self, mock_firebase):
        client = TestClient(app)
        cid = client.post("/api/composites", headers=USER2_HEADER,
                          json=_per_path_composite(1.0)).json()["composite_id"]
        res = client.post(f"/api/composites/{cid}/run", headers=AUTH_HEADER, json={})
        assert res.status_code == 403
