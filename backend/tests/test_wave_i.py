"""
Wave I tests:
  - POST /api/simulations/{id}/diff       (contract 1: counterfactual diff)
  - GET  /api/simulations/{id}/explain    (contract 2: per-run explainer)
  - POST /api/insights/digest             (contract 3: narrative dashboard digest)
  - lexical graph search over >50 entities (contract 4: truncation removed)

Firebase is mocked via the shared ``mock_firebase`` fixture; LLM calls are
mocked per-test (AsyncMock). Engine-backed runs use tiny num_runs (20-50).
"""
from datetime import datetime, timedelta
from unittest.mock import patch, AsyncMock

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.knowledge_graph import (
    KnowledgeGraphBuilder, KnowledgeGraph, GraphStatus, EntityNode,
)

AUTH_HEADER = {"Authorization": "Bearer valid-token"}   # uid test-user-123
USER2_HEADER = {"Authorization": "Bearer user2-token"}   # uid user-2


def _now_iso() -> str:
    return datetime.utcnow().isoformat()


def _sim_config(num_runs=30, time_horizon=4):
    return {
        "name": "Wave I Sim",
        "category": "startup",
        "variables": [
            {"name": "budget", "label": "Budget", "value": 50000, "type": "currency"},
            {"name": "price_per_unit", "label": "Price", "value": 99, "type": "currency"},
            {"name": "market_size", "label": "Market", "value": 1000000, "type": "number"},
            {"name": "conversion_rate", "label": "Conversion", "type": "percentage",
             "value": 5, "min": 0.1, "max": 15},
        ],
        "agents": [
            {"type": "customer", "name": "Users", "count": 100, "sensitivity": 0.7},
            {"type": "competitor", "name": "Rival", "count": 1, "sensitivity": 0.5},
            {"type": "market", "name": "Macro", "count": 1, "sensitivity": 0.6},
        ],
        "num_runs": num_runs,
        "time_horizon": time_horizon,
    }


def _completed_results(base_seed=777, success=60.0):
    return {
        "success_probability": success,
        "confidence_interval": [50.0, 70.0],
        "avg_revenue": 100000,
        "avg_market_share": 1.0,
        "avg_breakeven_month": 4.0,
        "risk_factors": [],
        "key_insights": ["Insight A"],
        "timeline_aggregated": [{"month": 1, "avg_revenue": 1000.0}],
        "outcome_distribution": [{"range": "$0-$1k", "probability": 40.0}],
        "competitor_reactions": [],
        "success_explanation": "Good retention.",
        "failure_explanation": "Weak funnel.",
        "base_seed": base_seed,
    }


def _seed_sim(store, sim_id="wave-i-sim", user_id="test-user-123",
              status="completed", results=None, updated_at=None, name="Wave I Sim"):
    store[f"simulations/{sim_id}"] = {
        "id": sim_id,
        "user_id": user_id,
        "name": name,
        "category": "startup",
        "config": _sim_config(),
        "status": status,
        "results": results if results is not None else (
            _completed_results() if status == "completed" else None),
        "run_count": 1 if status == "completed" else 0,
        "created_at": _now_iso(),
        "updated_at": updated_at or _now_iso(),
        "parent_id": None,
        "root_id": sim_id,
        "branch_label": None,
    }
    return sim_id


# ---------------------------------------------------------------------------
# Contract 1: counterfactual diff
# ---------------------------------------------------------------------------

class TestDiff:
    def test_diff_shape_with_llm(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="df-1")
        client = TestClient(app)
        with patch("app.routers.simulations.llm_client.chat",
                   new=AsyncMock(return_value=type("R", (), {"text": "Cutting conversion hurts."})())):
            res = client.post("/api/simulations/df-1/diff", headers=AUTH_HEADER,
                              json={"variable_overrides": {"conversion_rate": 0.1}})
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["base_seed"] == 777
        for block in ("baseline", "counterfactual"):
            for key in ("success_probability", "avg_revenue", "avg_market_share",
                        "avg_time_to_breakeven"):
                assert key in body[block]
        for key in ("success_probability_pp", "avg_revenue", "avg_market_share",
                    "avg_time_to_breakeven"):
            assert key in body["deltas"]
        # timeline_delta: one point per month with revenue deltas.
        assert body["timeline_delta"], "expected non-empty timeline_delta"
        pt = body["timeline_delta"][0]
        assert {"month", "baseline_revenue", "counterfactual_revenue", "delta"} <= set(pt)
        assert abs(pt["delta"] - (pt["counterfactual_revenue"] - pt["baseline_revenue"])) < 0.01
        # risk_changes: appeared/disappeared lists of {name, severity}.
        assert {"appeared", "disappeared"} <= set(body["risk_changes"])
        for bucket in ("appeared", "disappeared"):
            for r in body["risk_changes"][bucket]:
                assert {"name", "severity"} <= set(r)
        assert body["explanation"] == "Cutting conversion hurts."

    def test_diff_risk_changes_detect_appeared(self, mock_firebase):
        """Slashing conversion to its floor should surface a new risk factor."""
        _seed_sim(mock_firebase, sim_id="df-risk")
        client = TestClient(app)
        with patch("app.routers.simulations.llm_client.chat",
                   new=AsyncMock(side_effect=Exception("LLM down"))):
            res = client.post("/api/simulations/df-risk/diff", headers=AUTH_HEADER,
                              json={"variable_overrides": {"conversion_rate": 0.1}})
        assert res.status_code == 200, res.text
        body = res.json()
        appeared_names = {r["name"] for r in body["risk_changes"]["appeared"]}
        # Lower conversion lowers success -> "Market Fit Uncertainty" risk appears.
        assert "Market Fit Uncertainty" in appeared_names

    def test_diff_same_seed_determinism(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="df-det")
        client = TestClient(app)
        with patch("app.routers.simulations.llm_client.chat",
                   new=AsyncMock(side_effect=Exception("force fallback"))):
            a = client.post("/api/simulations/df-det/diff", headers=AUTH_HEADER,
                            json={"variable_overrides": {"price_per_unit": 120}}).json()
            b = client.post("/api/simulations/df-det/diff", headers=AUTH_HEADER,
                            json={"variable_overrides": {"price_per_unit": 120}}).json()
        assert a["base_seed"] == b["base_seed"] == 777
        assert a["baseline"] == b["baseline"]
        assert a["counterfactual"] == b["counterfactual"]
        assert a["timeline_delta"] == b["timeline_delta"]

    def test_diff_template_fallback_on_llm_failure(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="df-fb")
        client = TestClient(app)
        with patch("app.routers.simulations.llm_client.chat",
                   new=AsyncMock(side_effect=Exception("LLM down"))):
            res = client.post("/api/simulations/df-fb/diff", headers=AUTH_HEADER,
                              json={"variable_overrides": {"price_per_unit": 120}})
        assert res.status_code == 200, res.text
        explanation = res.json()["explanation"]
        assert isinstance(explanation, str) and explanation
        assert "success probability" in explanation.lower()

    def test_diff_422_unknown_key(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="df-bad")
        client = TestClient(app)
        res = client.post("/api/simulations/df-bad/diff", headers=AUTH_HEADER,
                          json={"variable_overrides": {"ghost_variable": 1}})
        assert res.status_code == 422

    def test_diff_422_empty_overrides(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="df-empty")
        client = TestClient(app)
        res = client.post("/api/simulations/df-empty/diff", headers=AUTH_HEADER,
                          json={"variable_overrides": {}})
        assert res.status_code == 422

    def test_diff_404_missing(self, mock_firebase):
        client = TestClient(app)
        res = client.post("/api/simulations/missing/diff", headers=AUTH_HEADER,
                          json={"variable_overrides": {"price_per_unit": 120}})
        assert res.status_code == 404

    def test_diff_403_cross_user(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="df-other", user_id="user-2")
        client = TestClient(app)
        res = client.post("/api/simulations/df-other/diff", headers=AUTH_HEADER,
                          json={"variable_overrides": {"price_per_unit": 120}})
        assert res.status_code == 403


# ---------------------------------------------------------------------------
# Contract 2: per-run explainer
# ---------------------------------------------------------------------------

class TestExplain:
    def test_explain_returns_pivotal_and_narrative_llm(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="ex-1")
        client = TestClient(app)
        llm_resp = {
            "narrative": "Users surged early, driving the p50 outcome.",
            "pivotal_events": [{"t": 1, "why": "Big acquisition spike."}],
        }
        with patch("app.routers.simulations.llm_client.chat_json",
                   new=AsyncMock(return_value=llm_resp)):
            res = client.get("/api/simulations/ex-1/explain?percentile=p50", headers=AUTH_HEADER)
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["percentile"] == "p50"
        assert body["seed_used"] == 777  # p50 == path 0 == base_seed + 0
        assert {"success", "final_revenue"} <= set(body["outcome"])
        assert body["pivotal_events"], "expected pivotal events"
        for ev in body["pivotal_events"]:
            assert {"t", "agent_type", "action", "value", "why"} <= set(ev)
        assert body["narrative"] == "Users surged early, driving the p50 outcome."
        # The LLM's why for index 0 should be applied.
        assert body["pivotal_events"][0]["why"] == "Big acquisition spike."

    def test_explain_default_percentile_is_p50(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="ex-def")
        client = TestClient(app)
        with patch("app.routers.simulations.llm_client.chat_json",
                   new=AsyncMock(side_effect=Exception("LLM down"))):
            res = client.get("/api/simulations/ex-def/explain", headers=AUTH_HEADER)
        assert res.status_code == 200, res.text
        assert res.json()["percentile"] == "p50"

    def test_explain_percentile_selection_deterministic(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="ex-det")
        client = TestClient(app)
        with patch("app.routers.simulations.llm_client.chat_json",
                   new=AsyncMock(side_effect=Exception("force fallback"))):
            a = client.get("/api/simulations/ex-det/explain?percentile=p90", headers=AUTH_HEADER).json()
            b = client.get("/api/simulations/ex-det/explain?percentile=p90", headers=AUTH_HEADER).json()
        # Same base_seed -> same chosen path index -> same seed_used + outcome.
        assert a["seed_used"] == b["seed_used"]
        assert a["outcome"] == b["outcome"]
        assert a["pivotal_events"] == b["pivotal_events"]

    def test_explain_p10_p90_differ(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="ex-spread")
        client = TestClient(app)
        with patch("app.routers.simulations.llm_client.chat_json",
                   new=AsyncMock(side_effect=Exception("force fallback"))):
            p10 = client.get("/api/simulations/ex-spread/explain?percentile=p10", headers=AUTH_HEADER).json()
            p90 = client.get("/api/simulations/ex-spread/explain?percentile=p90", headers=AUTH_HEADER).json()
        # The low-percentile path should end below the high-percentile path.
        assert p10["outcome"]["final_revenue"] <= p90["outcome"]["final_revenue"]

    def test_explain_template_fallback_on_llm_failure(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="ex-fb")
        client = TestClient(app)
        with patch("app.routers.simulations.llm_client.chat_json",
                   new=AsyncMock(side_effect=Exception("LLM down"))):
            res = client.get("/api/simulations/ex-fb/explain?percentile=p50", headers=AUTH_HEADER)
        assert res.status_code == 200, res.text
        body = res.json()
        assert isinstance(body["narrative"], str) and body["narrative"]
        assert body["pivotal_events"]

    def test_explain_invalid_percentile_422(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="ex-bad")
        client = TestClient(app)
        res = client.get("/api/simulations/ex-bad/explain?percentile=p42", headers=AUTH_HEADER)
        assert res.status_code == 422

    def test_explain_404_no_results(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="ex-none", status="draft", results=None)
        client = TestClient(app)
        res = client.get("/api/simulations/ex-none/explain", headers=AUTH_HEADER)
        assert res.status_code == 404

    def test_explain_404_missing(self, mock_firebase):
        client = TestClient(app)
        res = client.get("/api/simulations/missing/explain", headers=AUTH_HEADER)
        assert res.status_code == 404

    def test_explain_403_cross_user(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="ex-other", user_id="user-2")
        client = TestClient(app)
        res = client.get("/api/simulations/ex-other/explain", headers=AUTH_HEADER)
        assert res.status_code == 403

    def test_explain_final_revenue_matches_selection_metric_for_trend(self, mock_firebase):
        """Regression: for the trend domain the engine's final_revenue is a
        bounded accuracy % (0-100), while the replay's last-tick 'revenue' is an
        unbounded signal sum. outcome.final_revenue must report the SAME metric
        used to select the percentile path (the bounded one), not the tick sum."""
        trend_config = _sim_config()
        trend_config["category"] = "trend"
        trend_config["agents"] = [{"type": "data_stream", "name": "Signal",
                                    "count": 1, "sensitivity": 0.6}]
        store_doc = {
            "id": "ex-trend", "user_id": "test-user-123", "name": "Trend Sim",
            "category": "trend", "config": trend_config, "status": "completed",
            "results": _completed_results(), "run_count": 1,
            "created_at": _now_iso(), "updated_at": _now_iso(),
            "parent_id": None, "root_id": "ex-trend", "branch_label": None,
        }
        mock_firebase["simulations/ex-trend"] = store_doc
        client = TestClient(app)
        with patch("app.routers.simulations.llm_client.chat_json",
                   new=AsyncMock(side_effect=Exception("force template"))):
            res = client.get("/api/simulations/ex-trend/explain?percentile=p90",
                             headers=AUTH_HEADER)
        assert res.status_code == 200, res.text
        fr = res.json()["outcome"]["final_revenue"]
        # The accuracy metric is bounded to 0-100; an unbounded signal sum would
        # blow past this. This asserts we report the selection metric.
        assert 0.0 <= fr <= 100.0, f"final_revenue {fr} is not the bounded accuracy metric"


# ---------------------------------------------------------------------------
# Contract 3: narrative dashboard digest
# ---------------------------------------------------------------------------

class TestDigest:
    def test_digest_reflects_completed_and_stale(self, mock_firebase):
        now = datetime.utcnow()
        # Recently completed.
        _seed_sim(mock_firebase, sim_id="dg-done", status="completed",
                  updated_at=now.isoformat(), name="Fresh Run")
        # Stale (20 days old, completed long ago).
        old = (now - timedelta(days=20)).isoformat()
        _seed_sim(mock_firebase, sim_id="dg-stale", status="completed",
                  updated_at=old, name="Old Run")
        client = TestClient(app)
        last_seen = (now - timedelta(days=1)).isoformat()
        with patch("app.routers.insights.llm_client.chat",
                   new=AsyncMock(return_value=type("R", (), {"text": "Two updates!"})())):
            res = client.post("/api/insights/digest", headers=AUTH_HEADER,
                              json={"last_seen_at": last_seen})
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["headline"] == "Two updates!"
        types = [i["type"] for i in body["items"]]
        # Fresh run is completed-since-last-seen; old run is stale.
        assert "completed" in types
        assert "stale" in types
        completed = next(i for i in body["items"] if i["type"] == "completed")
        assert completed["sim_id"] == "dg-done"
        assert "%" in completed["text"]

    def test_digest_only_completed_since_last_seen(self, mock_firebase):
        now = datetime.utcnow()
        # Completed BEFORE last_seen — should not appear as a "completed" item.
        old_done = (now - timedelta(days=2)).isoformat()
        _seed_sim(mock_firebase, sim_id="dg-prior", status="completed",
                  updated_at=old_done, name="Prior Run")
        client = TestClient(app)
        last_seen = (now - timedelta(days=1)).isoformat()
        with patch("app.routers.insights.llm_client.chat",
                   new=AsyncMock(side_effect=Exception("force fallback"))):
            res = client.post("/api/insights/digest", headers=AUTH_HEADER,
                              json={"last_seen_at": last_seen})
        assert res.status_code == 200, res.text
        completed = [i for i in res.json()["items"] if i["type"] == "completed"]
        assert completed == []

    def test_digest_headline_present_template_fallback(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="dg-fb", status="completed",
                  updated_at=datetime.utcnow().isoformat())
        client = TestClient(app)
        with patch("app.routers.insights.llm_client.chat",
                   new=AsyncMock(side_effect=Exception("LLM down"))):
            res = client.post("/api/insights/digest", headers=AUTH_HEADER, json={})
        assert res.status_code == 200, res.text
        body = res.json()
        assert isinstance(body["headline"], str) and body["headline"]
        assert body["items"], "completed sim should produce an item"

    def test_digest_empty_state(self, mock_firebase):
        # No simulations for this user at all.
        client = TestClient(app)
        with patch("app.routers.insights.llm_client.chat",
                   new=AsyncMock(side_effect=Exception("LLM down"))):
            res = client.post("/api/insights/digest", headers=AUTH_HEADER, json={})
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["items"] == []
        assert isinstance(body["headline"], str) and body["headline"]

    def test_digest_caps_stale_at_three(self, mock_firebase):
        now = datetime.utcnow()
        for i in range(5):
            old = (now - timedelta(days=30 + i)).isoformat()
            _seed_sim(mock_firebase, sim_id=f"dg-old-{i}", status="completed",
                      updated_at=old, name=f"Old {i}")
        client = TestClient(app)
        with patch("app.routers.insights.llm_client.chat",
                   new=AsyncMock(side_effect=Exception("force fallback"))):
            res = client.post("/api/insights/digest", headers=AUTH_HEADER,
                              json={"last_seen_at": now.isoformat()})
        assert res.status_code == 200, res.text
        stale = [i for i in res.json()["items"] if i["type"] == "stale"]
        assert len(stale) <= 3

    def test_digest_scoped_to_owner(self, mock_firebase):
        now = datetime.utcnow()
        _seed_sim(mock_firebase, sim_id="dg-mine", status="completed",
                  updated_at=now.isoformat(), user_id="test-user-123")
        _seed_sim(mock_firebase, sim_id="dg-theirs", status="completed",
                  updated_at=now.isoformat(), user_id="user-2")
        client = TestClient(app)
        with patch("app.routers.insights.llm_client.chat",
                   new=AsyncMock(side_effect=Exception("force fallback"))):
            res = client.post("/api/insights/digest", headers=AUTH_HEADER, json={})
        assert res.status_code == 200, res.text
        sim_ids = {i.get("sim_id") for i in res.json()["items"]}
        assert "dg-theirs" not in sim_ids

    def test_digest_requires_auth(self, mock_firebase):
        client = TestClient(app)
        res = client.post("/api/insights/digest", json={})  # no auth header
        assert res.status_code == 401


# ---------------------------------------------------------------------------
# Contract 4: lexical graph search over >50 entities (truncation removed)
# ---------------------------------------------------------------------------

def _big_graph(builder, graph_id="big-graph", user_id=None):
    """Seed a graph with 60+ entities; the RELEVANT one sits past index 50."""
    graph = KnowledgeGraph(graph_id=graph_id, name="Big", status=GraphStatus.READY,
                           user_id=user_id)
    # 60 generic filler entities first (indices 0-59).
    for i in range(60):
        graph.nodes[f"filler-{i}"] = EntityNode(
            uuid=f"filler-{i}", name=f"Filler Entity {i}", entity_type="Misc",
            summary="An unrelated placeholder entity for padding.",
        )
    # The target entity lands AFTER 60 fillers — past the old [:50] cutoff.
    graph.nodes["target"] = EntityNode(
        uuid="target", name="Quantum Photonics Lab", entity_type="Organization",
        summary="A research lab specializing in quantum photonics and entanglement.",
    )
    builder._graphs[graph_id] = graph
    return graph_id


class TestLexicalSearch:
    @pytest.mark.asyncio
    async def test_finds_relevant_entity_beyond_index_50(self):
        """Proves the [:50] truncation is gone: a relevant entity at index 60
        is found via the TF-IDF candidate ranking (LLM failing -> lexical order)."""
        llm = type("M", (), {})()
        llm.chat_json = AsyncMock(side_effect=Exception("LLM down"))
        builder = KnowledgeGraphBuilder(client=llm)
        gid = _big_graph(builder)
        results = await builder.search_graph(gid, "quantum photonics", limit=5)
        assert results, "expected at least one result"
        assert any(n.uuid == "target" for n in results)
        # The strongly-matching target should rank at the top lexically.
        assert results[0].uuid == "target"

    @pytest.mark.asyncio
    async def test_lexical_candidates_then_llm_rerank(self):
        """LLM re-ranks only the lexical top-K candidates (not the first 50)."""
        captured = {}

        async def fake_chat_json(messages, **kwargs):
            captured["content"] = messages[0]["content"]
            return {"relevant_uuids": ["target"]}

        llm = type("M", (), {})()
        llm.chat_json = AsyncMock(side_effect=fake_chat_json)
        builder = KnowledgeGraphBuilder(client=llm)
        gid = _big_graph(builder)
        results = await builder.search_graph(gid, "quantum photonics", limit=5)
        assert [n.uuid for n in results] == ["target"]
        # The LLM prompt must contain the target (it was a lexical candidate),
        # proving candidate selection happened before the LLM, not a raw [:50].
        assert "target" in captured["content"]

    @pytest.mark.asyncio
    async def test_keyword_fallback_when_tfidf_empty(self):
        """A query whose terms never appear lexically falls back to keyword
        substring matching (which can still match against attributes)."""
        llm = type("M", (), {})()
        llm.chat_json = AsyncMock(side_effect=Exception("LLM down"))
        builder = KnowledgeGraphBuilder(client=llm)
        graph = KnowledgeGraph(graph_id="kw", name="kw", status=GraphStatus.READY)
        node = EntityNode(uuid="n1", name="Widget", entity_type="Product",
                          summary="A device", attributes={"tag": "zzqxwarbler"})
        graph.nodes["n1"] = node
        builder._graphs["kw"] = graph
        # "zzqxwarbler" only appears in attributes, which the TF-IDF index (built
        # over name+type+summary) does not see -> keyword fallback matches it.
        results = await builder.search_graph("kw", "zzqxwarbler")
        assert len(results) == 1 and results[0].uuid == "n1"

    @pytest.mark.asyncio
    async def test_empty_graph_returns_empty(self):
        llm = type("M", (), {})()
        llm.chat_json = AsyncMock(return_value={"relevant_uuids": []})
        builder = KnowledgeGraphBuilder(client=llm)
        graph = KnowledgeGraph(graph_id="empty", name="empty", status=GraphStatus.READY)
        builder._graphs["empty"] = graph
        results = await builder.search_graph("empty", "anything")
        assert results == []

    def test_search_endpoint_over_60_entities(self, mock_firebase):
        """End-to-end through the router: relevant entity beyond index 50 is
        returned, proving no truncation at the API layer."""
        from app.services.knowledge_graph import graph_builder
        gid = _big_graph(graph_builder, graph_id="api-big", user_id="test-user-123")
        client = TestClient(app)
        try:
            with patch.object(graph_builder.llm, "chat_json",
                              new=AsyncMock(side_effect=Exception("LLM down"))):
                res = client.post(f"/api/graphs/{gid}/search", headers=AUTH_HEADER,
                                  json={"query": "quantum photonics", "limit": 5})
            assert res.status_code == 200, res.text
            body = res.json()
            uuids = {r["uuid"] for r in body["results"]}
            assert "target" in uuids
        finally:
            graph_builder._graphs.pop(gid, None)
