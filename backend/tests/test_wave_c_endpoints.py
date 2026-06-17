"""
Wave C endpoint tests: tornado, what-if, shares, run history, analytics,
and public stats.

Firebase is mocked via the shared mock_firebase fixture; LLM calls are mocked
per-test. Engine-backed tests use tiny num_runs for speed.
"""
import uuid
from datetime import datetime, timedelta
from unittest.mock import patch, AsyncMock

import pytest
from fastapi.testclient import TestClient

from app.main import app

AUTH_HEADER = {"Authorization": "Bearer valid-token"}
USER2_HEADER = {"Authorization": "Bearer user2-token"}


@pytest.fixture(autouse=True)
def _reset_public_stats_cache():
    """Public stats are cached at module level; isolate tests."""
    import app.routers.public as public_module
    public_module._stats_cache = None
    yield
    public_module._stats_cache = None


def _now_iso(minutes_ago: int = 0) -> str:
    return (datetime.utcnow() - timedelta(minutes=minutes_ago)).isoformat()


def _sim_config(num_runs=50):
    return {
        "name": "Wave C Sim",
        "category": "startup",
        "variables": [
            {"name": "budget", "label": "Budget", "value": 50000, "type": "currency"},
            {"name": "price_per_unit", "label": "Price", "value": 99, "type": "currency"},
            {"name": "conversion_rate", "label": "Conversion", "type": "percentage",
             "value": 5, "min": 4.5, "max": 5.5},
            {"name": "launch_mode", "label": "Mode", "type": "select", "value": 1},
        ],
        "agents": [
            {"type": "customer", "name": "Users", "count": 100, "sensitivity": 0.7},
        ],
        "num_runs": num_runs,
        "time_horizon": 3,
    }


def _completed_results(base_seed=1234):
    return {
        "success_probability": 64.0,
        "confidence_interval": [55.0, 73.0],
        "avg_revenue": 120000,
        "avg_market_share": 1.2,
        "avg_breakeven_month": 4.2,
        "risk_factors": [],
        "key_insights": ["Insight A", "Insight B"],
        "timeline_aggregated": [
            {"month": 1, "avg_revenue": 1000.0, "p10_revenue": 500.0,
             "p90_revenue": 1500.0, "avg_customers": 10, "avg_market_share": 0.1},
            {"month": 2, "avg_revenue": 2000.0, "p10_revenue": 900.0,
             "p90_revenue": 3100.0, "avg_customers": 20, "avg_market_share": 0.2},
        ],
        "outcome_distribution": [
            {"range": "$0 — $1,000", "probability": 40.0},
            {"range": "$1,000 — $5,000", "probability": 60.0},
        ],
        "competitor_reactions": [],
        "success_explanation": "ok",
        "failure_explanation": "not ok",
        "domain_metadata": {
            "primary_metric_label": "Revenue", "primary_metric_unit": "$",
            "secondary_metric_label": "Customers",
            "tertiary_metric_label": "Market Share %", "time_unit": "months",
        },
        "base_seed": base_seed,
    }


def _seed_sim(store, sim_id="wave-c-sim", user_id="test-user-123",
              status="draft", results=None, num_runs=50,
              created_at=None, updated_at=None, name="Wave C Sim",
              category="startup"):
    store[f"simulations/{sim_id}"] = {
        "user_id": user_id,
        "name": name,
        "category": category,
        "config": _sim_config(num_runs),
        "status": status,
        "results": results,
        "run_count": 1 if results else 0,
        "created_at": created_at or _now_iso(),
        "updated_at": updated_at or _now_iso(),
    }
    return sim_id


def _seed_run(store, sim_id, user_id="test-user-123", created_at=None,
              num_runs=100, success=50.0, overrides=None):
    run_id = str(uuid.uuid4())
    store[f"simulation_runs/{run_id}"] = {
        "id": run_id,
        "simulation_id": sim_id,
        "user_id": user_id,
        "created_at": created_at or _now_iso(),
        "num_runs": num_runs,
        "success_probability": success,
        "avg_revenue": 1000.0,
        "variable_overrides": overrides,
    }
    return run_id


# ---------------------------------------------------------------------------
# 1. Tornado
# ---------------------------------------------------------------------------

class TestTornadoEndpoint:
    def test_tornado_shape_sorting_and_clamping(self, mock_firebase):
        sim_id = _seed_sim(mock_firebase, status="completed",
                           results=_completed_results(base_seed=1234))
        client = TestClient(app)
        res = client.post(
            f"/api/simulations/{sim_id}/tornado",
            json={"delta_pct": 20, "num_runs": 50},
            headers=AUTH_HEADER,
        )
        assert res.status_code == 200
        data = res.json()

        # base_seed reused from stored results
        assert data["base_seed"] == 1234
        assert 0 <= data["baseline"]["success_probability"] <= 1
        assert "avg_revenue" in data["baseline"]

        bars = data["bars"]
        # select-type variable excluded; 3 numeric vars analyzed
        assert {b["variable"] for b in bars} == {"budget", "price_per_unit", "conversion_rate"}
        for bar in bars:
            for key in ("variable", "label", "low_value", "high_value",
                        "low_success", "high_success", "impact"):
                assert key in bar
            assert 0 <= bar["low_success"] <= 1
            assert 0 <= bar["high_success"] <= 1
            assert bar["impact"] == pytest.approx(
                abs(bar["high_success"] - bar["low_success"]), abs=1e-9
            )
        # sorted by impact descending
        impacts = [b["impact"] for b in bars]
        assert impacts == sorted(impacts, reverse=True)

        # clamping to min/max: conversion_rate 5 ± 20% would be 4.0/6.0,
        # clamped to [4.5, 5.5]
        conv = next(b for b in bars if b["variable"] == "conversion_rate")
        assert conv["low_value"] == 4.5
        assert conv["high_value"] == 5.5
        # unclamped variable spans the full ±20%
        budget = next(b for b in bars if b["variable"] == "budget")
        assert budget["low_value"] == pytest.approx(40000)
        assert budget["high_value"] == pytest.approx(60000)

    def test_tornado_same_seed_determinism(self, mock_firebase):
        sim_id = _seed_sim(mock_firebase, status="completed",
                           results=_completed_results(base_seed=42))
        client = TestClient(app)
        body = {"delta_pct": 10, "num_runs": 50}
        res1 = client.post(f"/api/simulations/{sim_id}/tornado", json=body,
                           headers=AUTH_HEADER)
        res2 = client.post(f"/api/simulations/{sim_id}/tornado", json=body,
                           headers=AUTH_HEADER)
        assert res1.status_code == 200
        assert res2.status_code == 200
        assert res1.json() == res2.json()

    def test_tornado_validation_bounds(self, mock_firebase):
        sim_id = _seed_sim(mock_firebase)
        client = TestClient(app)
        res = client.post(f"/api/simulations/{sim_id}/tornado",
                          json={"delta_pct": 60, "num_runs": 50},
                          headers=AUTH_HEADER)
        assert res.status_code == 422
        res = client.post(f"/api/simulations/{sim_id}/tornado",
                          json={"num_runs": 10},
                          headers=AUTH_HEADER)
        assert res.status_code == 422

    def test_tornado_404_and_403(self, mock_firebase):
        client = TestClient(app)
        res = client.post("/api/simulations/nope/tornado",
                          json={"num_runs": 50}, headers=AUTH_HEADER)
        assert res.status_code == 404

        sim_id = _seed_sim(mock_firebase)
        res = client.post(f"/api/simulations/{sim_id}/tornado",
                          json={"num_runs": 50}, headers=USER2_HEADER)
        assert res.status_code == 403


# ---------------------------------------------------------------------------
# 2. What-if
# ---------------------------------------------------------------------------

class TestWhatIfEndpoint:
    def test_whatif_422_when_no_overrides_parsed(self, mock_firebase):
        sim_id = _seed_sim(mock_firebase)
        client = TestClient(app)
        with patch(
            "app.routers.simulations.llm_client.chat_json",
            new=AsyncMock(return_value={
                "variable_overrides": {},
                "unparseable_parts": ["make it pop"],
            }),
        ):
            res = client.post(
                f"/api/simulations/{sim_id}/whatif",
                json={"prompt": "make it pop"},
                headers=AUTH_HEADER,
            )
        assert res.status_code == 422

    def test_whatif_unknown_variables_count_as_unparseable(self, mock_firebase):
        sim_id = _seed_sim(mock_firebase)
        client = TestClient(app)
        with patch(
            "app.routers.simulations.llm_client.chat_json",
            new=AsyncMock(return_value={
                "variable_overrides": {"warp_speed": 9},
                "unparseable_parts": [],
            }),
        ):
            res = client.post(
                f"/api/simulations/{sim_id}/whatif",
                json={"prompt": "engage warp speed nine"},
                headers=AUTH_HEADER,
            )
        assert res.status_code == 422

    def test_whatif_paired_runs_and_delta_arithmetic(self, mock_firebase):
        sim_id = _seed_sim(mock_firebase, status="completed",
                           results=_completed_results(base_seed=777))
        client = TestClient(app)
        with patch(
            "app.routers.simulations.llm_client.chat_json",
            new=AsyncMock(return_value={
                "variable_overrides": {"price_per_unit": 150},
                "unparseable_parts": ["and a free pony"],
            }),
        ), patch(
            "app.routers.simulations.llm_client.chat",
            new=AsyncMock(side_effect=Exception("LLM down")),
        ):
            res = client.post(
                f"/api/simulations/{sim_id}/whatif",
                json={"prompt": "raise the price to $150 and a free pony"},
                headers=AUTH_HEADER,
            )
        assert res.status_code == 200
        data = res.json()

        assert data["parsed"]["variable_overrides"] == {"price_per_unit": 150.0}
        assert "and a free pony" in data["parsed"]["unparseable_parts"]

        for section in ("baseline", "whatif"):
            for key in ("success_probability", "avg_revenue", "avg_time_to_breakeven"):
                assert key in data[section]

        # paired-run delta arithmetic
        assert data["deltas"]["success_probability_pp"] == pytest.approx(
            data["whatif"]["success_probability"] - data["baseline"]["success_probability"],
            abs=1e-6,
        )
        assert data["deltas"]["avg_revenue"] == pytest.approx(
            data["whatif"]["avg_revenue"] - data["baseline"]["avg_revenue"], abs=1e-6
        )
        assert data["deltas"]["avg_time_to_breakeven"] == pytest.approx(
            data["whatif"]["avg_time_to_breakeven"] - data["baseline"]["avg_time_to_breakeven"],
            abs=1e-6,
        )
        # template fallback verdict kicked in (LLM chat failed)
        assert isinstance(data["verdict"], str) and len(data["verdict"]) > 0

    def test_whatif_prompt_length_validated(self, mock_firebase):
        sim_id = _seed_sim(mock_firebase)
        client = TestClient(app)
        res = client.post(f"/api/simulations/{sim_id}/whatif",
                          json={"prompt": "ab"}, headers=AUTH_HEADER)
        assert res.status_code == 422
        res = client.post(f"/api/simulations/{sim_id}/whatif",
                          json={"prompt": "x" * 501}, headers=AUTH_HEADER)
        assert res.status_code == 422

    def test_whatif_502_when_llm_unavailable(self, mock_firebase):
        sim_id = _seed_sim(mock_firebase)
        client = TestClient(app)
        with patch(
            "app.routers.simulations.llm_client.chat_json",
            new=AsyncMock(side_effect=Exception("api down")),
        ):
            res = client.post(
                f"/api/simulations/{sim_id}/whatif",
                json={"prompt": "double the price"},
                headers=AUTH_HEADER,
            )
        assert res.status_code == 502


# ---------------------------------------------------------------------------
# 3. Shares
# ---------------------------------------------------------------------------

class TestShares:
    def test_share_roundtrip_create_public_get_revoke(self, mock_firebase):
        sim_id = _seed_sim(mock_firebase, status="completed",
                           results=_completed_results())
        client = TestClient(app)

        # Create
        res = client.post(f"/api/simulations/{sim_id}/share", headers=AUTH_HEADER)
        assert res.status_code == 201
        share_id = res.json()["share_id"]
        assert res.json()["path"] == f"/s/{share_id}"

        # Public GET — no auth header at all
        res = client.get(f"/api/shared/{share_id}")
        assert res.status_code == 200
        snap = res.json()
        assert snap["share_id"] == share_id
        assert snap["name"] == "Wave C Sim"
        assert snap["category"] == "startup"
        assert snap["success_probability"] == 64.0
        assert snap["confidence_interval"] == [55.0, 73.0]
        assert snap["avg_revenue"] == 120000
        assert snap["key_insights"] == ["Insight A", "Insight B"]
        assert snap["domain_metadata"] is not None
        # timeline mapped to camelCase
        assert snap["timeline"][0] == {
            "month": 1, "avgRevenue": 1000.0,
            "p10Revenue": 500.0, "p90Revenue": 1500.0,
        }
        # outcome buckets carry counts (derived from config num_runs=50)
        for bucket in snap["outcome_distribution"]:
            assert set(bucket.keys()) == {"range", "probability", "count"}
        assert snap["outcome_distribution"][0]["count"] == 20  # 40% of 50
        # frozen snapshot never leaks ownership info
        assert "user_id" not in snap
        assert "simulation_id" not in snap

        # Snapshot is FROZEN: changing the sim does not change the share
        mock_firebase[f"simulations/{sim_id}"]["results"]["success_probability"] = 99.0
        res = client.get(f"/api/shared/{share_id}")
        assert res.json()["success_probability"] == 64.0

        # Revoke
        res = client.delete(f"/api/simulations/{sim_id}/share", headers=AUTH_HEADER)
        assert res.status_code == 204

        # Revoked share is gone
        res = client.get(f"/api/shared/{share_id}")
        assert res.status_code == 404

    def test_share_requires_results(self, mock_firebase):
        sim_id = _seed_sim(mock_firebase, status="draft", results=None)
        client = TestClient(app)
        res = client.post(f"/api/simulations/{sim_id}/share", headers=AUTH_HEADER)
        assert res.status_code == 409

    def test_share_ownership_and_auth(self, mock_firebase):
        sim_id = _seed_sim(mock_firebase, status="completed",
                           results=_completed_results())
        client = TestClient(app)
        # cross-user create -> 403
        res = client.post(f"/api/simulations/{sim_id}/share", headers=USER2_HEADER)
        assert res.status_code == 403
        # unauthenticated create -> 401
        res = client.post(f"/api/simulations/{sim_id}/share")
        assert res.status_code == 401
        # unknown sim -> 404
        res = client.post("/api/simulations/nope/share", headers=AUTH_HEADER)
        assert res.status_code == 404

    def test_revoke_only_deletes_own_shares(self, mock_firebase):
        sim_id = _seed_sim(mock_firebase, status="completed",
                           results=_completed_results())
        client = TestClient(app)
        res = client.post(f"/api/simulations/{sim_id}/share", headers=AUTH_HEADER)
        share_id = res.json()["share_id"]

        # Another user's revoke is a no-op for this owner's shares
        res = client.delete(f"/api/simulations/{sim_id}/share", headers=USER2_HEADER)
        assert res.status_code == 204
        assert client.get(f"/api/shared/{share_id}").status_code == 200

    def test_unknown_share_returns_404(self, mock_firebase):
        client = TestClient(app)
        res = client.get("/api/shared/does-not-exist")
        assert res.status_code == 404


# ---------------------------------------------------------------------------
# 4. Run history
# ---------------------------------------------------------------------------

class TestRunHistory:
    def test_run_endpoint_records_history(self, mock_firebase):
        sim_id = _seed_sim(mock_firebase)
        client = TestClient(app)
        with patch(
            "app.routers.simulations.generate_ai_insights",
            new=AsyncMock(side_effect=Exception("skip insights")),
        ):
            res = client.post(
                f"/api/simulations/{sim_id}/run",
                json={"num_runs": 20, "variable_overrides": {"price_per_unit": 120}},
                headers=AUTH_HEADER,
            )
        assert res.status_code == 200

        run_docs = [v for k, v in mock_firebase.items()
                    if k.startswith("simulation_runs/")]
        assert len(run_docs) == 1
        run = run_docs[0]
        assert run["simulation_id"] == sim_id
        assert run["user_id"] == "test-user-123"
        assert run["num_runs"] == 20
        assert run["variable_overrides"] == {"price_per_unit": 120}
        assert run["success_probability"] is not None
        assert run["avg_revenue"] is not None

        # And the GET endpoint surfaces it
        res = client.get(f"/api/simulations/{sim_id}/runs", headers=AUTH_HEADER)
        assert res.status_code == 200
        runs = res.json()["runs"]
        assert len(runs) == 1
        assert runs[0]["run_id"] == run["id"]
        assert runs[0]["num_runs"] == 20
        assert runs[0]["variable_overrides"] == {"price_per_unit": 120}

    def test_stream_endpoint_records_history(self, mock_firebase):
        sim_id = _seed_sim(mock_firebase)
        client = TestClient(app)
        with patch(
            "app.routers.simulations.generate_ai_insights",
            new=AsyncMock(side_effect=Exception("skip insights")),
        ):
            res = client.post(
                f"/api/simulations/{sim_id}/run/stream",
                json={"num_runs": 20},
                headers=AUTH_HEADER,
            )
        assert res.status_code == 200
        run_docs = [v for k, v in mock_firebase.items()
                    if k.startswith("simulation_runs/")]
        assert len(run_docs) == 1
        assert run_docs[0]["simulation_id"] == sim_id
        assert run_docs[0]["num_runs"] == 20

    async def test_pipeline_worker_records_history(self, mock_firebase):
        from app.services.simulation_orchestrator import (
            SimulationOrchestrator, Project, Task,
        )
        from app.models.simulation import SimulationConfig

        sim_id = _seed_sim(mock_firebase, sim_id="pipeline-sim", status="running")
        orch = SimulationOrchestrator()
        project = Project(project_id="proj_wavec", name="P",
                          user_id="test-user-123")
        task = Task(task_id="task_wavec", task_type="project_simulation")
        config = SimulationConfig(**_sim_config(num_runs=20))

        with patch(
            "app.services.ai_insights.generate_ai_insights",
            new=AsyncMock(side_effect=Exception("skip insights")),
        ):
            await orch._run_simulation_pipeline_worker(
                project, task, sim_id, config,
                num_runs=20, variable_overrides=None,
            )

        run_docs = [v for k, v in mock_firebase.items()
                    if k.startswith("simulation_runs/")]
        assert len(run_docs) == 1
        assert run_docs[0]["simulation_id"] == sim_id
        assert run_docs[0]["user_id"] == "test-user-123"
        assert run_docs[0]["num_runs"] == 20

    def test_runs_listed_newest_first_with_limit_fields(self, mock_firebase):
        sim_id = _seed_sim(mock_firebase)
        _seed_run(mock_firebase, sim_id, created_at=_now_iso(minutes_ago=30),
                  success=40.0)
        newest = _seed_run(mock_firebase, sim_id, created_at=_now_iso(minutes_ago=1),
                           success=60.0, overrides={"budget": 99000})
        _seed_run(mock_firebase, sim_id, created_at=_now_iso(minutes_ago=10),
                  success=50.0)
        # a run for some OTHER sim must not appear
        _seed_run(mock_firebase, "other-sim", created_at=_now_iso())

        client = TestClient(app)
        res = client.get(f"/api/simulations/{sim_id}/runs", headers=AUTH_HEADER)
        assert res.status_code == 200
        runs = res.json()["runs"]
        assert len(runs) == 3
        assert runs[0]["run_id"] == newest
        assert [r["success_probability"] for r in runs] == [60.0, 50.0, 40.0]
        assert runs[0]["variable_overrides"] == {"budget": 99000}
        assert runs[1]["variable_overrides"] is None

    def test_runs_ownership(self, mock_firebase):
        sim_id = _seed_sim(mock_firebase)
        client = TestClient(app)
        res = client.get(f"/api/simulations/{sim_id}/runs", headers=USER2_HEADER)
        assert res.status_code == 403
        res = client.get("/api/simulations/nope/runs", headers=AUTH_HEADER)
        assert res.status_code == 404
        res = client.get(f"/api/simulations/{sim_id}/runs")
        assert res.status_code == 401


# ---------------------------------------------------------------------------
# 5. Analytics summary
# ---------------------------------------------------------------------------

class TestAnalyticsSummary:
    def _seed_dataset(self, store):
        r1 = _completed_results()
        r1["success_probability"] = 60.0
        _seed_sim(store, sim_id="sim-a", status="completed", results=r1,
                  name="A", updated_at=_now_iso(minutes_ago=60))
        r2 = _completed_results()
        r2["success_probability"] = 80.0
        _seed_sim(store, sim_id="sim-b", status="completed", results=r2,
                  name="B", category="finance", updated_at=_now_iso(minutes_ago=5))
        _seed_sim(store, sim_id="sim-c", status="draft", results=None,
                  name="C", updated_at=_now_iso(minutes_ago=1))
        # other user's sim should be invisible
        _seed_sim(store, sim_id="sim-theirs", user_id="user-2",
                  status="completed", results=_completed_results())
        # run history: 2 mine, 1 theirs
        _seed_run(store, "sim-a")
        _seed_run(store, "sim-b")
        _seed_run(store, "sim-theirs", user_id="user-2")

    def test_summary_shapes_and_aggregation(self, mock_firebase):
        self._seed_dataset(mock_firebase)
        client = TestClient(app)
        res = client.get("/api/analytics/summary", headers=AUTH_HEADER)
        assert res.status_code == 200
        data = res.json()

        assert data["totals"] == {
            "simulations": 3,
            "completed": 2,
            "total_runs": 2,
            "avg_success_rate": 70.0,
        }

        by_cat = {e["category"]: e for e in data["by_category"]}
        assert by_cat["startup"]["count"] == 2
        assert by_cat["startup"]["avg_success"] == 60.0
        assert by_cat["finance"]["count"] == 1
        assert by_cat["finance"]["avg_success"] == 80.0

        # trend covers today's completed sims
        assert len(data["success_trend"]) >= 1
        today_entry = data["success_trend"][-1]
        assert set(today_entry.keys()) == {"date", "avg_success", "count"}
        assert len(today_entry["date"]) == 10  # YYYY-MM-DD

        # recent: newest first, owner's sims only, max 10
        recent = data["recent"]
        assert len(recent) == 3
        assert [r["id"] for r in recent] == ["sim-c", "sim-b", "sim-a"]
        assert recent[0]["success_probability"] is None  # draft
        assert recent[1]["success_probability"] == 80.0
        for r in recent:
            assert set(r.keys()) == {
                "id", "name", "category", "status",
                "success_probability", "updated_at",
            }

    def test_summary_empty_state(self, mock_firebase):
        client = TestClient(app)
        res = client.get("/api/analytics/summary", headers=AUTH_HEADER)
        assert res.status_code == 200
        data = res.json()
        assert data["totals"] == {
            "simulations": 0, "completed": 0,
            "total_runs": 0, "avg_success_rate": 0.0,
        }
        assert data["by_category"] == []
        assert data["success_trend"] == []
        assert data["recent"] == []

    def test_summary_requires_auth(self, mock_firebase):
        client = TestClient(app)
        assert client.get("/api/analytics/summary").status_code == 401


# ---------------------------------------------------------------------------
# 6. Public stats
# ---------------------------------------------------------------------------

class TestPublicStats:
    def test_public_stats_no_auth_and_anonymized(self, mock_firebase):
        r = _completed_results()
        _seed_sim(mock_firebase, sim_id="pub-a", status="completed", results=r,
                  updated_at=_now_iso(minutes_ago=15))
        _seed_sim(mock_firebase, sim_id="pub-b", user_id="user-2",
                  status="completed", results=_completed_results(),
                  category="finance", updated_at=_now_iso(minutes_ago=3))
        _seed_sim(mock_firebase, sim_id="pub-c", status="draft", results=None)

        client = TestClient(app)
        res = client.get("/api/public/stats")  # NO auth header
        assert res.status_code == 200
        data = res.json()

        assert data["total_simulations"] == 3
        assert data["total_runs"] == 2  # run_count 1 + 1 + 0
        assert data["sims_this_week"] == 3
        assert len(data["recent"]) == 2
        # newest first
        assert data["recent"][0]["category"] == "finance"
        for entry in data["recent"]:
            # strictly anonymized — only these three keys, nothing else
            assert set(entry.keys()) == {
                "category", "success_probability", "minutes_ago",
            }
            assert entry["minutes_ago"] >= 0

    def test_public_stats_recent_capped_at_10(self, mock_firebase):
        for i in range(13):
            _seed_sim(mock_firebase, sim_id=f"cap-{i}", status="completed",
                      results=_completed_results(),
                      updated_at=_now_iso(minutes_ago=i))
        client = TestClient(app)
        res = client.get("/api/public/stats")
        assert res.status_code == 200
        assert len(res.json()["recent"]) == 10

    def test_public_stats_cached_in_process(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="cache-a")
        client = TestClient(app)
        first = client.get("/api/public/stats").json()
        assert first["total_simulations"] == 1

        # New data is invisible until the cache expires
        _seed_sim(mock_firebase, sim_id="cache-b")
        second = client.get("/api/public/stats").json()
        assert second["total_simulations"] == 1

        # Expire the cache manually -> fresh aggregation
        import app.routers.public as public_module
        payload, ts = public_module._stats_cache
        public_module._stats_cache = (payload, ts - 301)
        third = client.get("/api/public/stats").json()
        assert third["total_simulations"] == 2
