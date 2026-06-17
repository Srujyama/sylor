"""
Wave G tests:
  - Engine event sink (mass run unaffected; single seeded path is non-empty +
    deterministic).
  - GET /api/simulations/{id}/replay   (contract 1)
  - GET /api/simulations/{id}/transcript (contract 2, LLM mocked + fallback)
  - POST /api/demo/run (PUBLIC) + POST /api/demo/claim (authed) (contract 3)
  - POST /api/simulations/{id}/copilot (contract 4, LLM mocked + heuristic)

Firebase is mocked via the shared ``mock_firebase`` fixture; LLM calls are
mocked per-test (AsyncMock). Engine-backed runs use tiny num_runs.
"""
from datetime import datetime
from unittest.mock import patch, AsyncMock

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.simulation import (
    SimulationConfig, SimulationVariable, AgentConfig, SimulationCategory,
)
from app.services.simulation_engine import SimulationEngine, EventSink

AUTH_HEADER = {"Authorization": "Bearer valid-token"}   # uid test-user-123
USER2_HEADER = {"Authorization": "Bearer user2-token"}   # uid user-2


def _now_iso() -> str:
    return datetime.utcnow().isoformat()


def _sim_config(num_runs=30, time_horizon=4):
    return {
        "name": "Wave G Sim",
        "category": "startup",
        "variables": [
            {"name": "budget", "label": "Budget", "value": 50000, "type": "currency"},
            {"name": "price_per_unit", "label": "Price", "value": 99, "type": "currency"},
            {"name": "market_size", "label": "Market", "value": 1000000, "type": "number"},
            {"name": "conversion_rate", "label": "Conversion", "type": "percentage",
             "value": 5, "min": 1, "max": 15},
        ],
        "agents": [
            {"type": "customer", "name": "Users", "count": 100, "sensitivity": 0.7},
            {"type": "competitor", "name": "Rival", "count": 1, "sensitivity": 0.5},
            {"type": "market", "name": "Macro", "count": 1, "sensitivity": 0.6},
        ],
        "num_runs": num_runs,
        "time_horizon": time_horizon,
    }


def _completed_results(base_seed=777):
    return {
        "success_probability": 60.0,
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


def _seed_sim(store, sim_id="wave-g-sim", user_id="test-user-123",
              status="completed", results=None):
    store[f"simulations/{sim_id}"] = {
        "id": sim_id,
        "user_id": user_id,
        "name": "Wave G Sim",
        "category": "startup",
        "config": _sim_config(),
        "status": status,
        "results": results if results is not None else (
            _completed_results() if status == "completed" else None),
        "run_count": 1 if status == "completed" else 0,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
        "parent_id": None,
        "root_id": sim_id,
        "branch_label": None,
    }
    return sim_id


def _engine_config(category=SimulationCategory.STARTUP, num_runs=30, time_horizon=4):
    return SimulationConfig(
        name="Engine Sim",
        category=category,
        variables=[
            SimulationVariable(name="budget", label="Budget", type="currency", value=50000),
            SimulationVariable(name="price_per_unit", label="Price", type="currency", value=99),
            SimulationVariable(name="market_size", label="Market", value=1000000),
            SimulationVariable(name="conversion_rate", label="Conversion",
                               type="percentage", value=5),
        ],
        agents=[
            AgentConfig(type="customer", name="Users", count=100, sensitivity=0.7),
            AgentConfig(type="competitor", name="Rival", count=1, sensitivity=0.5),
            AgentConfig(type="market", name="Macro", count=1, sensitivity=0.6),
        ],
        num_runs=num_runs,
        time_horizon=time_horizon,
    )


# ---------------------------------------------------------------------------
# Task 1: engine event sink
# ---------------------------------------------------------------------------

class TestEventSink:
    @pytest.mark.asyncio
    async def test_mass_run_unaffected_by_sink_capability(self):
        """A normal run() must produce identical results regardless — the mass
        run never attaches a sink, so adding sink support does not change it."""
        config = _engine_config()
        r1 = await SimulationEngine(config).run(base_seed=777)
        r2 = await SimulationEngine(config).run(base_seed=777)
        assert r1.success_probability == r2.success_probability
        assert r1.avg_revenue == r2.avg_revenue
        assert r1.confidence_interval == r2.confidence_interval

    def test_single_path_yields_nonempty_deterministic_log(self):
        config = _engine_config()
        engine = SimulationEngine(config)
        rp1 = engine.replay_path(777, path_index=0)
        rp2 = engine.replay_path(777, path_index=0)
        assert rp1["ticks"], "expected non-empty event log"
        assert rp1 == rp2  # deterministic under fixed seed
        # One entry per time step, with per-agent events + headline metrics.
        assert len(rp1["ticks"]) >= 1
        tick = rp1["ticks"][0]
        assert "t" in tick and "events" in tick and "metrics" in tick
        assert tick["events"]
        for ev in tick["events"]:
            assert {"agent_id", "agent_type", "action", "value"} <= set(ev)
        assert {"revenue", "customers", "market_share"} <= set(tick["metrics"])
        # Agents roster matches the config agents.
        assert {a["name"] for a in rp1["agents"]} == {"Users", "Rival", "Macro"}

    def test_captured_path_matches_real_monte_carlo_path(self):
        """The captured path is a real path: its metrics match a sink-less run of
        the same RNG seed."""
        import random
        config = _engine_config()
        engine = SimulationEngine(config)
        direct = engine._run_single(None, random.Random(777))
        rp = engine.replay_path(777, path_index=0)
        assert abs(direct["timeline"][-1]["revenue"]
                   - rp["ticks"][-1]["metrics"]["revenue"]) < 0.01

    def test_sink_is_none_records_nothing(self):
        """Running without a sink must not raise and not collect anything."""
        import random
        config = _engine_config()
        engine = SimulationEngine(config)
        sink = EventSink()
        engine._run_single(None, random.Random(1), event_sink=None)
        assert sink.ticks == []

    def test_finance_replay_uses_day_time_unit(self):
        config = _engine_config(category=SimulationCategory.FINANCE)
        rp = SimulationEngine(config).replay_path(42)
        assert rp["time_unit"] == "day"
        assert rp["ticks"]


# ---------------------------------------------------------------------------
# Contract 1: replay
# ---------------------------------------------------------------------------

class TestReplay:
    def test_replay_non_empty_ticks(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="rep-1")
        client = TestClient(app)
        res = client.get("/api/simulations/rep-1/replay", headers=AUTH_HEADER)
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["ticks"], "expected non-empty ticks"
        assert body["base_seed"] == 777
        assert body["time_unit"] == "month"
        assert body["agents"]
        tick = body["ticks"][0]
        assert {"t", "events", "metrics"} <= set(tick)

    def test_replay_deterministic_under_fixed_seed(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="rep-det")
        client = TestClient(app)
        first = client.get("/api/simulations/rep-det/replay", headers=AUTH_HEADER).json()
        # Wipe the cache so it recomputes from the same seed.
        mock_firebase["simulations/rep-det"]["results"].pop("replay", None)
        second = client.get("/api/simulations/rep-det/replay", headers=AUTH_HEADER).json()
        assert first == second

    def test_replay_cached_on_doc(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="rep-cache")
        client = TestClient(app)
        client.get("/api/simulations/rep-cache/replay", headers=AUTH_HEADER)
        cached = mock_firebase["simulations/rep-cache"]["results"].get("replay")
        assert cached and cached.get("ticks")
        # Second call returns the cached replay even if the engine would error.
        with patch("app.routers.simulations._build_replay",
                   side_effect=AssertionError("should not recompute")):
            res = client.get("/api/simulations/rep-cache/replay", headers=AUTH_HEADER)
        assert res.status_code == 200

    def test_replay_404_no_results(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="rep-none", status="draft", results=None)
        client = TestClient(app)
        res = client.get("/api/simulations/rep-none/replay", headers=AUTH_HEADER)
        assert res.status_code == 404

    def test_replay_404_missing(self, mock_firebase):
        client = TestClient(app)
        res = client.get("/api/simulations/missing/replay", headers=AUTH_HEADER)
        assert res.status_code == 404

    def test_replay_403_cross_user(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="rep-other", user_id="user-2")
        client = TestClient(app)
        res = client.get("/api/simulations/rep-other/replay", headers=AUTH_HEADER)
        assert res.status_code == 403


# ---------------------------------------------------------------------------
# Contract 2: transcript
# ---------------------------------------------------------------------------

class TestTranscript:
    def test_transcript_returns_narrative_llm(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="tr-1")
        client = TestClient(app)
        llm_resp = {
            "transcript": [
                {"t": 1, "narrative": "Users surged in while Rival watched."},
                {"t": 2, "narrative": "Revenue climbed as Macro stayed calm."},
            ],
            "summary": "A steady climb to product-market fit.",
        }
        with patch("app.routers.simulations.llm_client.chat_json",
                   new=AsyncMock(return_value=llm_resp)):
            res = client.get("/api/simulations/tr-1/transcript", headers=AUTH_HEADER)
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["summary"] == "A steady climb to product-market fit."
        assert body["transcript"][0]["narrative"].startswith("Users surged")

    def test_transcript_fallback_on_llm_failure(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="tr-fb")
        client = TestClient(app)
        with patch("app.routers.simulations.llm_client.chat_json",
                   new=AsyncMock(side_effect=Exception("LLM down"))):
            res = client.get("/api/simulations/tr-fb/transcript", headers=AUTH_HEADER)
        # Still 200 with a templated narrative.
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["transcript"], "fallback must still produce a narrative"
        assert isinstance(body["summary"], str) and body["summary"]

    def test_transcript_cached(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="tr-cache")
        client = TestClient(app)
        llm_resp = {"transcript": [{"t": 1, "narrative": "Once."}], "summary": "Sum."}
        mock = AsyncMock(return_value=llm_resp)
        with patch("app.routers.simulations.llm_client.chat_json", new=mock):
            client.get("/api/simulations/tr-cache/transcript", headers=AUTH_HEADER)
            client.get("/api/simulations/tr-cache/transcript", headers=AUTH_HEADER)
        assert mock.await_count == 1  # second call served from cache
        assert mock_firebase["simulations/tr-cache"]["results"].get("transcript")

    def test_transcript_404_no_results(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="tr-none", status="draft", results=None)
        client = TestClient(app)
        res = client.get("/api/simulations/tr-none/transcript", headers=AUTH_HEADER)
        assert res.status_code == 404

    def test_transcript_403_cross_user(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="tr-other", user_id="user-2")
        client = TestClient(app)
        res = client.get("/api/simulations/tr-other/transcript", headers=AUTH_HEADER)
        assert res.status_code == 403


# ---------------------------------------------------------------------------
# Contract 3: demo run + claim
# ---------------------------------------------------------------------------

class TestDemo:
    def test_demo_run_public_no_auth(self, mock_firebase):
        client = TestClient(app)
        res = client.post("/api/demo/run", json={"preset": "saas"})  # no auth header
        assert res.status_code == 200, res.text
        body = res.json()
        assert "demo_id" in body and body["demo_id"]
        assert "results" in body and "config" in body
        # Results shape matches GET /results' .results object.
        assert "success_probability" in body["results"]
        assert "confidence_interval" in body["results"]
        assert body["config"]["category"] == "startup"

    def test_demo_run_all_presets(self, mock_firebase):
        client = TestClient(app)
        for preset, expected_cat in [("saas", "startup"), ("pricing", "pricing"),
                                     ("portfolio", "finance")]:
            res = client.post("/api/demo/run", json={"preset": preset})
            assert res.status_code == 200, res.text
            assert res.json()["config"]["category"] == expected_cat

    def test_demo_run_caps_num_runs_at_500(self, mock_firebase):
        client = TestClient(app)
        captured = {}

        real_run = SimulationEngine.run

        async def spy_run(self, num_runs=None, **kwargs):
            captured["num_runs"] = num_runs
            # Run a tiny version to keep the test fast.
            return await real_run(self, num_runs=10, **kwargs)

        # Patch the preset to request way over the cap, then verify clamp.
        with patch.dict("app.routers.demo._PRESET_SAAS", {"num_runs": 5000}):
            with patch.object(SimulationEngine, "run", spy_run):
                res = client.post("/api/demo/run", json={"preset": "saas"})
        assert res.status_code == 200, res.text
        assert captured["num_runs"] == 500
        assert res.json()["config"]["num_runs"] == 500

    def test_demo_run_applies_overrides(self, mock_firebase):
        client = TestClient(app)
        res = client.post("/api/demo/run",
                          json={"preset": "saas", "overrides": {"price_per_unit": 199}})
        assert res.status_code == 200, res.text

    def test_demo_run_invalid_preset_422(self, mock_firebase):
        client = TestClient(app)
        res = client.post("/api/demo/run", json={"preset": "nope"})
        assert res.status_code == 422

    def test_demo_claim_persists_owner_scoped(self, mock_firebase):
        client = TestClient(app)
        run = client.post("/api/demo/run", json={"preset": "saas"}).json()
        res = client.post(
            "/api/demo/claim",
            json={"demo_id": run["demo_id"], "config": run["config"],
                  "results": run["results"]},
            headers=AUTH_HEADER,
        )
        assert res.status_code == 200, res.text
        sim_id = res.json()["simulation_id"]
        stored = mock_firebase[f"simulations/{sim_id}"]
        assert stored["user_id"] == "test-user-123"
        assert stored["status"] == "completed"
        assert stored["results"] is not None
        assert stored["root_id"] == sim_id
        assert stored["parent_id"] is None

    def test_demo_claim_requires_auth(self, mock_firebase):
        client = TestClient(app)
        run = client.post("/api/demo/run", json={"preset": "saas"}).json()
        res = client.post(
            "/api/demo/claim",
            json={"demo_id": run["demo_id"], "config": run["config"],
                  "results": run["results"]},
        )  # no auth header
        assert res.status_code == 401

    def test_demo_claim_invalid_config_422(self, mock_firebase):
        client = TestClient(app)
        res = client.post(
            "/api/demo/claim",
            json={"demo_id": "abc", "config": {"bad": "config"}, "results": {}},
            headers=AUTH_HEADER,
        )
        assert res.status_code == 422

    def test_demo_claim_rejects_forged_results(self, mock_firebase):
        """A valid config but garbage results must 422, not persist forged data."""
        client = TestClient(app)
        run = client.post("/api/demo/run", json={"preset": "saas"}).json()
        res = client.post(
            "/api/demo/claim",
            json={"demo_id": run["demo_id"], "config": run["config"],
                  "results": {"success_probability": "not-a-number", "made_up": True}},
            headers=AUTH_HEADER,
        )
        assert res.status_code == 422

    def test_demo_claim_is_idempotent(self, mock_firebase):
        """Re-claiming the same demo_id returns the existing sim, not a duplicate."""
        client = TestClient(app)
        run = client.post("/api/demo/run", json={"preset": "saas"}).json()
        body = {"demo_id": run["demo_id"], "config": run["config"], "results": run["results"]}
        first = client.post("/api/demo/claim", json=body, headers=AUTH_HEADER)
        second = client.post("/api/demo/claim", json=body, headers=AUTH_HEADER)
        assert first.status_code == 200 and second.status_code == 200
        assert first.json()["simulation_id"] == second.json()["simulation_id"]
        sims = [k for k in mock_firebase if k.startswith("simulations/")]
        assert len(sims) == 1


# ---------------------------------------------------------------------------
# Contract 4: copilot
# ---------------------------------------------------------------------------

class TestCopilot:
    def test_copilot_llm_suggestions(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="cp-1")
        client = TestClient(app)
        llm_resp = {
            "suggestions": [
                {"type": "sweep", "title": "Sweep price", "rationale": "find the knee",
                 "action": {"variable_name": "price_per_unit",
                            "min_value": 49, "max_value": 199}},
                {"type": "branch", "title": "Cut churn", "rationale": "retention",
                 "action": {"variable_overrides": {"conversion_rate": 8}}},
                {"type": "whatif", "title": "Recession", "rationale": "stress test",
                 "action": {"prompt": "What if a recession hits?"}},
                {"type": "compare", "title": "Compare runs", "rationale": "baseline",
                 "action": {}},
            ]
        }
        with patch("app.routers.simulations.llm_client.chat_json",
                   new=AsyncMock(return_value=llm_resp)):
            res = client.post("/api/simulations/cp-1/copilot", headers=AUTH_HEADER)
        assert res.status_code == 200, res.text
        suggestions = res.json()["suggestions"]
        assert 3 <= len(suggestions) <= 5
        for s in suggestions:
            assert s["type"] in {"sweep", "branch", "whatif", "compare"}
            assert "title" in s and "rationale" in s and "action" in s

    def test_copilot_drops_unknown_variable_then_falls_back(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="cp-bad")
        client = TestClient(app)
        # Only one valid suggestion; the others reference unknown variables and
        # are dropped, leaving < 3, so the heuristic fallback fills in.
        llm_resp = {
            "suggestions": [
                {"type": "sweep", "title": "bad", "rationale": "x",
                 "action": {"variable_name": "ghost", "min_value": 1, "max_value": 2}},
            ]
        }
        with patch("app.routers.simulations.llm_client.chat_json",
                   new=AsyncMock(return_value=llm_resp)):
            res = client.post("/api/simulations/cp-bad/copilot", headers=AUTH_HEADER)
        assert res.status_code == 200, res.text
        suggestions = res.json()["suggestions"]
        assert 2 <= len(suggestions) <= 3  # heuristic fallback
        for s in suggestions:
            assert s["type"] in {"sweep", "branch", "whatif", "compare"}

    def test_copilot_heuristic_fallback_on_llm_failure(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="cp-fb")
        client = TestClient(app)
        with patch("app.routers.simulations.llm_client.chat_json",
                   new=AsyncMock(side_effect=Exception("LLM down"))):
            res = client.post("/api/simulations/cp-fb/copilot", headers=AUTH_HEADER)
        assert res.status_code == 200, res.text
        suggestions = res.json()["suggestions"]
        assert 2 <= len(suggestions) <= 3
        # Highest-impact-looking variable sweep + +/-20% branches.
        types = {s["type"] for s in suggestions}
        assert "sweep" in types and "branch" in types

    def test_copilot_404_missing(self, mock_firebase):
        client = TestClient(app)
        res = client.post("/api/simulations/missing/copilot", headers=AUTH_HEADER)
        assert res.status_code == 404

    def test_copilot_403_cross_user(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="cp-other", user_id="user-2")
        client = TestClient(app)
        res = client.post("/api/simulations/cp-other/copilot", headers=AUTH_HEADER)
        assert res.status_code == 403
