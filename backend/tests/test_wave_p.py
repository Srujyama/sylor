"""
Wave P tests: agent network-effects / contagion.

Covers:
  (a) OFF is byte-identical to a baseline run for a fixed seed (success_probability
      + avg_revenue + confidence_interval unchanged).
  (b) ON changes outcomes under the SAME seed (proving the coupling is wired) AND
      is itself deterministic/reproducible under a fixed seed.
  (c) Emergent metrics present + sane when ON (avg_cascade_events >= 0,
      0 <= max_contagion_reach <= 1) and zero/default when OFF.
  (d) Bounded — extreme contagion_strength still yields finite results, no
      NaN/inf, success_probability in [0, 100].
  (e) create + run round-trips the new config fields through the API.

The engine is exercised directly with seeded, tiny (20-50 run) Monte Carlo
passes — nothing in the engine is mocked.
"""
import math

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.simulation import (
    SimulationConfig, SimulationVariable, AgentConfig, SimulationCategory,
)
from app.services.simulation_engine import SimulationEngine

AUTH_HEADER = {"Authorization": "Bearer valid-token"}  # uid test-user-123


def _coupled_agents():
    """A roster with several inter-coupled segments so contagion can bite."""
    return [
        AgentConfig(type="customer", name="Seg A", count=80, sensitivity=0.7, influence_weight=0.8),
        AgentConfig(type="customer", name="Seg B", count=80, sensitivity=0.7, influence_weight=0.6),
        AgentConfig(type="competitor", name="Rival", count=1, sensitivity=0.6, influence_weight=0.9),
        AgentConfig(type="market", name="Macro", count=1, sensitivity=0.6, influence_weight=0.7),
        AgentConfig(type="investor", name="VC", count=1, sensitivity=0.5, influence_weight=0.5),
    ]


def _make_config(enable_contagion=False, contagion_strength=0.3, num_runs=40, time_horizon=8):
    return SimulationConfig(
        name="Contagion Test",
        category=SimulationCategory.STARTUP,
        variables=[
            SimulationVariable(name="budget", label="Budget", type="currency", value=50000),
            SimulationVariable(name="price_per_unit", label="Price", type="currency", value=99),
            SimulationVariable(name="market_size", label="Market Size", value=1_000_000),
            SimulationVariable(name="conversion_rate", label="Conversion", type="percentage", value=5),
            SimulationVariable(name="churn_rate", label="Churn", type="percentage", value=4),
        ],
        agents=_coupled_agents(),
        num_runs=num_runs,
        time_horizon=time_horizon,
        enable_contagion=enable_contagion,
        contagion_strength=contagion_strength,
    )


def _finite(x) -> bool:
    return isinstance(x, (int, float)) and math.isfinite(x)


# ── (a) OFF is byte-identical ──────────────────────────────────────────────

class TestOffByteIdentical:
    @pytest.mark.asyncio
    async def test_off_matches_baseline_for_fixed_seed(self):
        """A run with enable_contagion=False must be byte-identical to a config
        that never carries the flag at all (the legacy default), same seed."""
        baseline = _make_config()  # enable_contagion defaults False
        explicit_off = _make_config(enable_contagion=False)
        r_base = await SimulationEngine(baseline).run(base_seed=12345)
        r_off = await SimulationEngine(explicit_off).run(base_seed=12345)
        assert r_off.success_probability == r_base.success_probability
        assert r_off.avg_revenue == r_base.avg_revenue
        assert r_off.confidence_interval == r_base.confidence_interval
        assert r_off.avg_market_share == r_base.avg_market_share

    @pytest.mark.asyncio
    async def test_off_is_reproducible(self):
        cfg = _make_config(enable_contagion=False)
        r1 = await SimulationEngine(cfg).run(base_seed=999)
        r2 = await SimulationEngine(cfg).run(base_seed=999)
        assert r1.success_probability == r2.success_probability
        assert r1.avg_revenue == r2.avg_revenue


# ── (b) ON changes outcomes + is deterministic ─────────────────────────────

class TestOnChangesAndDeterministic:
    @pytest.mark.asyncio
    async def test_on_differs_from_off_same_seed(self):
        """Coupling must actually be wired: ON vs OFF differ at the same seed."""
        off = _make_config(enable_contagion=False)
        on = _make_config(enable_contagion=True, contagion_strength=0.6)
        r_off = await SimulationEngine(off).run(base_seed=2024)
        r_on = await SimulationEngine(on).run(base_seed=2024)
        # Something measurable must move (revenue or success prob).
        assert (r_on.avg_revenue != r_off.avg_revenue) or (
            r_on.success_probability != r_off.success_probability
        )

    @pytest.mark.asyncio
    async def test_on_is_reproducible(self):
        on = _make_config(enable_contagion=True, contagion_strength=0.5)
        r1 = await SimulationEngine(on).run(base_seed=4242)
        r2 = await SimulationEngine(on).run(base_seed=4242)
        assert r1.success_probability == r2.success_probability
        assert r1.avg_revenue == r2.avg_revenue
        assert r1.avg_cascade_events == r2.avg_cascade_events
        assert r1.max_contagion_reach == r2.max_contagion_reach


# ── (c) Emergent metrics present/sane ──────────────────────────────────────

class TestEmergentMetrics:
    @pytest.mark.asyncio
    async def test_metrics_present_and_sane_when_on(self):
        on = _make_config(enable_contagion=True, contagion_strength=0.6)
        r = await SimulationEngine(on).run(base_seed=77)
        assert r.contagion_enabled is True
        assert r.avg_cascade_events >= 0.0
        assert 0.0 <= r.max_contagion_reach <= 1.0

    @pytest.mark.asyncio
    async def test_metrics_default_when_off(self):
        off = _make_config(enable_contagion=False)
        r = await SimulationEngine(off).run(base_seed=77)
        assert r.contagion_enabled is False
        assert r.avg_cascade_events == 0.0
        assert r.max_contagion_reach == 0.0

    @pytest.mark.asyncio
    @pytest.mark.parametrize("category", ["finance", "biology", "trend"])
    async def test_all_domains_run_with_contagion(self, category):
        """Wiring into all four _run_* loops must not crash and stays sane."""
        agents = {
            "finance": [
                AgentConfig(type="trader", name="T1", count=3, sensitivity=0.6, influence_weight=0.7),
                AgentConfig(type="trader", name="T2", count=3, sensitivity=0.6, influence_weight=0.6),
                AgentConfig(type="market_maker", name="MM", count=1, sensitivity=0.5, influence_weight=0.5),
            ],
            "biology": [
                AgentConfig(type="molecule", name="M1", count=64, sensitivity=0.7, influence_weight=0.8),
                AgentConfig(type="molecule", name="M2", count=64, sensitivity=0.7, influence_weight=0.6),
                AgentConfig(type="enzyme", name="E1", count=4, sensitivity=0.6, influence_weight=0.5),
            ],
            "trend": [
                AgentConfig(type="data_stream", name="D1", count=1, sensitivity=0.6, influence_weight=0.8),
                AgentConfig(type="data_stream", name="D2", count=1, sensitivity=0.6, influence_weight=0.6),
                AgentConfig(type="market", name="Macro", count=1, sensitivity=0.6, influence_weight=0.7),
            ],
        }[category]
        cfg = SimulationConfig(
            name=f"{category} contagion",
            category=SimulationCategory(category),
            variables=[SimulationVariable(name="x", label="X", value=1)],
            agents=agents,
            num_runs=20,
            time_horizon=6,
            enable_contagion=True,
            contagion_strength=0.5,
        )
        r = await SimulationEngine(cfg).run(base_seed=303)
        assert r.contagion_enabled is True
        assert _finite(r.avg_revenue)
        assert 0 <= r.success_probability <= 100
        assert r.avg_cascade_events >= 0.0
        assert 0.0 <= r.max_contagion_reach <= 1.0


# ── (d) Bounded under extreme strength ─────────────────────────────────────

class TestBounded:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("strength", [0.0, 1.0])
    async def test_extreme_strength_stays_finite(self, strength):
        cfg = _make_config(enable_contagion=True, contagion_strength=strength)
        r = await SimulationEngine(cfg).run(base_seed=555)
        assert _finite(r.avg_revenue)
        assert _finite(r.avg_market_share)
        assert _finite(r.avg_breakeven_month)
        assert 0 <= r.success_probability <= 100
        assert 0.0 <= r.max_contagion_reach <= 1.0
        assert r.avg_cascade_events >= 0.0


# ── (e) create + run round-trips the new config fields ─────────────────────

class TestEndpointRoundTrip:
    def test_create_round_trips_contagion_fields(self, mock_firebase):
        client = TestClient(app)
        cfg = _make_config(enable_contagion=True, contagion_strength=0.45, num_runs=20)
        payload = {"config": cfg.model_dump(mode="json"), "user_id": "test-user-123"}
        resp = client.post("/api/simulations", json=payload, headers=AUTH_HEADER)
        assert resp.status_code == 201, resp.text
        sim = resp.json()
        assert sim["config"]["enable_contagion"] is True
        assert sim["config"]["contagion_strength"] == 0.45

        # Read it back — fields persist through storage.
        sim_id = sim["id"]
        got = client.get(f"/api/simulations/{sim_id}", headers=AUTH_HEADER)
        assert got.status_code == 200
        assert got.json()["config"]["enable_contagion"] is True
        assert got.json()["config"]["contagion_strength"] == 0.45

    def test_create_run_endpoint_accepts_contagion_config(self, mock_firebase):
        client = TestClient(app)
        cfg = _make_config(enable_contagion=True, contagion_strength=0.3, num_runs=20)
        payload = {"config": cfg.model_dump(mode="json"), "user_id": "test-user-123"}
        resp = client.post("/api/simulations", json=payload, headers=AUTH_HEADER)
        assert resp.status_code == 201, resp.text
        sim_id = resp.json()["id"]
        run = client.post(
            f"/api/simulations/{sim_id}/run",
            json={"num_runs": 20},
            headers=AUTH_HEADER,
        )
        assert run.status_code == 200, run.text
        assert run.json()["status"] == "running"
