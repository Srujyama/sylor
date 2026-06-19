"""
Wave Q tests: LLM-driven agents in the loop (hero runs).

Covers POST /api/simulations/{sim_id}/hero-run:
  - Full response shape per contract (with chat_json mocked to a valid choice).
  - HARD budget cap: decisions_used <= max_decisions even with a long horizon
    that has more key ticks than the budget (max_decisions=2, horizon=12).
  - Every decision's applied_effect + the outcome are finite (no NaN/inf).
  - 404 missing sim, 403 cross-user, 409 when the sim has no config.
  - chat_json raises -> still 200 with formula fallback + decisions_used reflects
    the failures gracefully (0 applied), and the wrap-up narrative falls back to
    the template.

Firebase is mocked via the shared ``mock_firebase`` fixture. NO real Anthropic
calls — chat_json is always an AsyncMock. Horizons are kept small.
"""
import math
from datetime import datetime
from unittest.mock import patch, AsyncMock

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.simulation import (
    SimulationConfig, SimulationVariable, AgentConfig, SimulationCategory,
)
from app.services.hero_run import HeroRunner, MIN_DECISIONS, MAX_DECISIONS

AUTH_HEADER = {"Authorization": "Bearer valid-token"}    # uid test-user-123
USER2_HEADER = {"Authorization": "Bearer user2-token"}   # uid user-2


def _now_iso() -> str:
    return datetime.utcnow().isoformat()


def _sim_config(num_runs=30, time_horizon=4):
    return {
        "name": "Wave Q Sim",
        "category": "startup",
        "variables": [
            {"name": "budget", "label": "Budget", "value": 50000, "type": "currency"},
            {"name": "price_per_unit", "label": "Price", "value": 99, "type": "currency"},
            {"name": "market_size", "label": "Market", "value": 1000000, "type": "number"},
            {"name": "conversion_rate", "label": "Conversion", "type": "percentage",
             "value": 5, "min": 1, "max": 15},
        ],
        "agents": [
            # The customer agent has the highest influence_weight, so it is the
            # one the hero run hands the LLM decision to.
            {"type": "customer", "name": "Users", "count": 100, "sensitivity": 0.7,
             "influence_weight": 0.9, "decision_style": "aggressive",
             "behavior_rules": ["Chase growth", "Watch churn"]},
            {"type": "competitor", "name": "Rival", "count": 1, "sensitivity": 0.5},
            {"type": "market", "name": "Macro", "count": 1, "sensitivity": 0.6},
        ],
        "num_runs": num_runs,
        "time_horizon": time_horizon,
    }


def _seed_sim(store, sim_id="wave-q-sim", user_id="test-user-123",
              config=None, base_seed=777):
    store[f"simulations/{sim_id}"] = {
        "id": sim_id,
        "user_id": user_id,
        "name": "Wave Q Sim",
        "category": "startup",
        "config": config if config is not None else _sim_config(),
        "status": "completed",
        "results": {"base_seed": base_seed, "success_probability": 60.0},
        "run_count": 1,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
        "parent_id": None,
        "root_id": sim_id,
        "branch_label": None,
    }
    return sim_id


def _valid_choice():
    return AsyncMock(return_value={
        "decision": "expand",
        "rationale": "Growth momentum is strong; lean in this step.",
    })


def _decision_then_narrative(decision_resp):
    """chat_json mock that returns a per-step decision N times, then a narrative.

    The hero run makes one chat_json call per LLM decision plus ONE wrap-up
    narrative call. A single AsyncMock with a dict return value satisfies both
    (decision validation + narrative.get('narrative') -> falls back to template),
    so most tests just use _valid_choice(). This helper is used where we want to
    assert the narrative came from the LLM.
    """
    async def _side_effect(*args, **kwargs):
        system = kwargs.get("system", "")
        if "narrator" in system or "wrapping up" in system.lower():
            return {"narrative": "An illustrative climb driven by bold expansion calls."}
        return decision_resp
    return AsyncMock(side_effect=_side_effect)


# ---------------------------------------------------------------------------
# Service-level: HeroRunner hard cap + finiteness + determinism
# ---------------------------------------------------------------------------

class TestHeroRunnerService:
    def _engine_config(self, time_horizon=12):
        return SimulationConfig(
            name="Engine Hero",
            category=SimulationCategory.STARTUP,
            variables=[
                SimulationVariable(name="budget", label="Budget", type="currency", value=50000),
                SimulationVariable(name="price_per_unit", label="Price", type="currency", value=99),
                SimulationVariable(name="market_size", label="Market", value=1000000),
            ],
            agents=[
                AgentConfig(type="customer", name="Users", count=100, sensitivity=0.7,
                            influence_weight=0.9, decision_style="aggressive"),
                AgentConfig(type="market", name="Macro", count=1, sensitivity=0.6),
            ],
            num_runs=30,
            time_horizon=time_horizon,
        )

    @pytest.mark.asyncio
    async def test_hard_cap_with_long_horizon(self):
        """With max_decisions=2 and a 12-step horizon (more key ticks than the
        budget), the runner spends AT MOST 2 LLM decisions and stops calling."""
        llm = AsyncMock()
        llm.chat_json = _valid_choice()
        payload = await HeroRunner(self._engine_config(12), llm).run(
            base_seed=123, max_decisions=2,
        )
        assert payload["decisions_used"] <= 2
        assert payload["decisions_budget"] == 2
        # Hard cap holds at the call level too (no calls beyond the budget).
        assert llm.chat_json.await_count <= 2
        assert len(payload["timeline"]) <= 12

    @pytest.mark.asyncio
    async def test_all_effects_and_outcome_finite(self):
        llm = AsyncMock()
        llm.chat_json = _valid_choice()
        payload = await HeroRunner(self._engine_config(8), llm).run(
            base_seed=99, max_decisions=6,
        )
        assert math.isfinite(payload["outcome"]["final_revenue"])
        for t in payload["timeline"]:
            assert math.isfinite(t["revenue"])
            assert math.isfinite(t["market_share"])
        for d in payload["decisions"]:
            assert math.isfinite(d["applied_effect"])

    @pytest.mark.asyncio
    async def test_formula_parts_deterministic_on_llm_failure(self):
        """When every LLM call fails, the path is pure formula and reproduces
        exactly across runs with the same base_seed."""
        llm1 = AsyncMock(); llm1.chat_json = AsyncMock(side_effect=Exception("down"))
        llm2 = AsyncMock(); llm2.chat_json = AsyncMock(side_effect=Exception("down"))
        p1 = await HeroRunner(self._engine_config(6), llm1).run(base_seed=55, max_decisions=4)
        p2 = await HeroRunner(self._engine_config(6), llm2).run(base_seed=55, max_decisions=4)
        assert p1["decisions_used"] == 0
        assert p1["timeline"] == p2["timeline"]
        assert p1["outcome"] == p2["outcome"]

    @pytest.mark.asyncio
    async def test_call_budget_is_hard_cap_even_when_llm_fails(self):
        """Regression: max_decisions caps LLM CALLS, not just successful
        decisions. A persistently-failing LLM over a long horizon must not call
        chat_json more than max_decisions times."""
        llm = AsyncMock()
        llm.chat_json = AsyncMock(side_effect=Exception("down"))
        payload = await HeroRunner(self._engine_config(12), llm).run(
            base_seed=42, max_decisions=2,
        )
        assert payload["decisions_used"] == 0
        # The hard cap is on attempts: never more than the budget of calls.
        assert llm.chat_json.await_count <= 2


# ---------------------------------------------------------------------------
# Endpoint: POST /{sim_id}/hero-run
# ---------------------------------------------------------------------------

class TestHeroRunEndpoint:
    def test_full_shape(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="hr-shape")
        client = TestClient(app)
        with patch("app.routers.simulations.llm_client.chat_json",
                   new=_decision_then_narrative({
                       "decision": "expand",
                       "rationale": "Strong funnel; push growth.",
                   })):
            res = client.post("/api/simulations/hr-shape/hero-run",
                              json={"max_decisions": 4}, headers=AUTH_HEADER)
        assert res.status_code == 200, res.text
        body = res.json()
        # Top-level contract fields.
        for key in ("base_seed", "time_unit", "timeline", "decisions", "outcome",
                    "narrative", "decisions_used", "decisions_budget"):
            assert key in body, f"missing {key}"
        assert body["base_seed"] == 777  # reused from results.base_seed
        assert body["decisions_budget"] == 4
        assert isinstance(body["narrative"], str) and body["narrative"]
        # Timeline point shape.
        assert body["timeline"], "timeline must be non-empty"
        pt = body["timeline"][0]
        for key in ("t", "revenue", "customers", "market_share"):
            assert key in pt
        # Outcome shape.
        assert set(body["outcome"]) == {"success", "final_revenue"}
        assert isinstance(body["outcome"]["success"], bool)
        # Decision shape (at least one decision should have been made).
        assert body["decisions_used"] >= 1
        d = body["decisions"][0]
        for key in ("t", "agent_id", "agent_type", "agent_name", "persona_summary",
                    "market_snapshot", "decision", "rationale", "applied_effect"):
            assert key in d, f"decision missing {key}"
        # The most influential agent (customer) made the call.
        assert d["agent_type"] == "customer"
        assert d["decision"] in (
            "aggressive_expand", "expand", "hold", "defend", "retreat"
        )

    def test_hard_cap_endpoint(self, mock_firebase):
        """max_decisions=2 + horizon=12 -> decisions_used <= 2 (hard cap)."""
        cfg = _sim_config(time_horizon=12)
        _seed_sim(mock_firebase, sim_id="hr-cap", config=cfg)
        client = TestClient(app)
        with patch("app.routers.simulations.llm_client.chat_json",
                   new=_decision_then_narrative({
                       "decision": "aggressive_expand", "rationale": "Seize it.",
                   })):
            res = client.post("/api/simulations/hr-cap/hero-run",
                              json={"max_decisions": 2}, headers=AUTH_HEADER)
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["decisions_budget"] == 2
        assert body["decisions_used"] <= 2
        assert len(body["decisions"]) <= 2

    def test_outcome_and_effects_finite_endpoint(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="hr-finite")
        client = TestClient(app)
        with patch("app.routers.simulations.llm_client.chat_json",
                   new=_valid_choice()):
            res = client.post("/api/simulations/hr-finite/hero-run",
                              json={"max_decisions": 3}, headers=AUTH_HEADER)
        assert res.status_code == 200, res.text
        body = res.json()
        assert math.isfinite(body["outcome"]["final_revenue"])
        for d in body["decisions"]:
            assert math.isfinite(d["applied_effect"])
        for t in body["timeline"]:
            assert math.isfinite(t["revenue"]) and math.isfinite(t["market_share"])

    def test_base_seed_override_echoed(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="hr-seed")
        client = TestClient(app)
        with patch("app.routers.simulations.llm_client.chat_json",
                   new=_valid_choice()):
            res = client.post("/api/simulations/hr-seed/hero-run",
                              json={"max_decisions": 2, "base_seed": 4242},
                              headers=AUTH_HEADER)
        assert res.status_code == 200, res.text
        assert res.json()["base_seed"] == 4242

    def test_default_budget_when_omitted(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="hr-default")
        client = TestClient(app)
        with patch("app.routers.simulations.llm_client.chat_json",
                   new=_valid_choice()):
            res = client.post("/api/simulations/hr-default/hero-run",
                              json={}, headers=AUTH_HEADER)
        assert res.status_code == 200, res.text
        assert res.json()["decisions_budget"] == 6  # DEFAULT_DECISIONS

    @pytest.mark.parametrize("bad", [0, 13, -1, 100])
    def test_max_decisions_out_of_range_422(self, mock_firebase, bad):
        _seed_sim(mock_firebase, sim_id="hr-range")
        client = TestClient(app)
        with patch("app.routers.simulations.llm_client.chat_json",
                   new=_valid_choice()):
            res = client.post("/api/simulations/hr-range/hero-run",
                              json={"max_decisions": bad}, headers=AUTH_HEADER)
        assert res.status_code == 422, res.text

    def test_llm_failure_falls_back_still_200(self, mock_firebase):
        """chat_json raises for BOTH the decisions and the narrative -> still 200,
        decisions_used reflects the failures gracefully (0 applied), and the
        narrative falls back to the template."""
        _seed_sim(mock_firebase, sim_id="hr-fail")
        client = TestClient(app)
        with patch("app.routers.simulations.llm_client.chat_json",
                   new=AsyncMock(side_effect=Exception("LLM down"))):
            res = client.post("/api/simulations/hr-fail/hero-run",
                              json={"max_decisions": 4}, headers=AUTH_HEADER)
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["decisions_used"] == 0
        assert body["decisions"] == []
        # Template fallback narrative still present + honest framing.
        assert isinstance(body["narrative"], str) and body["narrative"]
        assert "illustrative" in body["narrative"].lower()
        assert math.isfinite(body["outcome"]["final_revenue"])

    def test_404_missing_sim(self, mock_firebase):
        client = TestClient(app)
        with patch("app.routers.simulations.llm_client.chat_json",
                   new=_valid_choice()):
            res = client.post("/api/simulations/nope/hero-run",
                              json={"max_decisions": 2}, headers=AUTH_HEADER)
        assert res.status_code == 404

    def test_403_cross_user(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="hr-other", user_id="user-2")
        client = TestClient(app)
        with patch("app.routers.simulations.llm_client.chat_json",
                   new=_valid_choice()):
            res = client.post("/api/simulations/hr-other/hero-run",
                              json={"max_decisions": 2}, headers=AUTH_HEADER)
        assert res.status_code == 403

    def test_409_no_config(self, mock_firebase):
        """A sim with an empty/missing config -> 409."""
        sid = _seed_sim(mock_firebase, sim_id="hr-noconfig")
        mock_firebase["simulations/hr-noconfig"]["config"] = {}
        client = TestClient(app)
        with patch("app.routers.simulations.llm_client.chat_json",
                   new=_valid_choice()):
            res = client.post("/api/simulations/hr-noconfig/hero-run",
                              json={"max_decisions": 2}, headers=AUTH_HEADER)
        assert res.status_code == 409
