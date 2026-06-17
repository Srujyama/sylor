"""
Tests for deterministic seeding, persona-driven behavior, and confidence
diagnostics on the simulation engine.
"""
import pytest

from app.models.simulation import (
    SimulationConfig, SimulationVariable, AgentConfig, SimulationCategory,
)
from app.services.simulation_engine import SimulationEngine


def _make_config(agents=None, num_runs=60, time_horizon=6):
    return SimulationConfig(
        name="Seeding Test",
        category=SimulationCategory.STARTUP,
        variables=[
            SimulationVariable(name="budget", label="Budget", type="currency", value=50000),
            SimulationVariable(name="price_per_unit", label="Price", type="currency", value=99),
            SimulationVariable(name="market_size", label="Market Size", value=1_000_000),
            SimulationVariable(name="conversion_rate", label="Conversion", type="percentage", value=5),
            SimulationVariable(name="churn_rate", label="Churn", type="percentage", value=3),
        ],
        agents=agents or [
            AgentConfig(type="customer", name="Users", count=100, sensitivity=0.7),
            AgentConfig(type="competitor", name="Rival", count=1, sensitivity=0.5),
            AgentConfig(type="market", name="Macro", count=1, sensitivity=0.6),
        ],
        num_runs=num_runs,
        time_horizon=time_horizon,
    )


# ── Deterministic seeding ─────────────────────────────────────────────────────

class TestDeterministicSeeding:
    @pytest.mark.asyncio
    async def test_same_base_seed_is_reproducible(self):
        """Same base_seed -> identical success_probability and avg_revenue."""
        config = _make_config()
        r1 = await SimulationEngine(config).run(base_seed=777)
        r2 = await SimulationEngine(config).run(base_seed=777)
        assert r1.success_probability == r2.success_probability
        assert r1.avg_revenue == r2.avg_revenue
        assert r1.confidence_interval == r2.confidence_interval

    @pytest.mark.asyncio
    async def test_base_seed_recorded(self):
        """The base_seed used is recorded on the results."""
        config = _make_config()
        results = await SimulationEngine(config).run(base_seed=12321)
        assert results.base_seed == 12321

    @pytest.mark.asyncio
    async def test_auto_seed_is_recorded_and_nonnull(self):
        """When no base_seed is passed, one is generated and recorded."""
        config = _make_config()
        results = await SimulationEngine(config).run()
        assert results.base_seed is not None
        assert isinstance(results.base_seed, int)

    @pytest.mark.asyncio
    async def test_different_seeds_can_differ(self):
        """Different seeds generally produce different aggregate outcomes."""
        config = _make_config(num_runs=80)
        r1 = await SimulationEngine(config).run(base_seed=1)
        r2 = await SimulationEngine(config).run(base_seed=99999)
        # At least one aggregate should differ across distinct seeds.
        assert (r1.success_probability != r2.success_probability) or (r1.avg_revenue != r2.avg_revenue)


# ── Persona-driven behavior ───────────────────────────────────────────────────

class TestPersonasDriveMath:
    @pytest.mark.asyncio
    async def test_different_profiles_diverge_under_same_seed(self):
        """Two different persona parameter sets produce statistically different
        outcomes under the SAME base_seed (i.e. the personas, not the RNG, are
        responsible for the difference)."""
        seed = 24680

        eager = _make_config(agents=[
            AgentConfig(
                type="customer", name="Eager", count=100, sensitivity=0.7,
                activity_level=0.95, sentiment_bias=0.9, influence_weight=0.8, risk_tolerance=0.8,
            ),
            AgentConfig(
                type="market", name="Macro", count=1, sensitivity=0.6,
                influence_weight=0.9, sentiment_bias=0.5,
            ),
        ])
        reluctant = _make_config(agents=[
            AgentConfig(
                type="customer", name="Reluctant", count=100, sensitivity=0.7,
                activity_level=0.05, sentiment_bias=-0.9, influence_weight=0.2, risk_tolerance=0.2,
            ),
            AgentConfig(
                type="market", name="Macro", count=1, sensitivity=0.6,
                influence_weight=0.1, sentiment_bias=-0.5,
            ),
        ])

        r_eager = await SimulationEngine(eager).run(base_seed=seed)
        r_reluctant = await SimulationEngine(reluctant).run(base_seed=seed)

        # The eager cohort should acquire more customers / revenue than the
        # reluctant cohort, and the aggregates must differ.
        assert r_eager.avg_revenue != r_reluctant.avg_revenue
        assert r_eager.avg_revenue > r_reluctant.avg_revenue

    @pytest.mark.asyncio
    async def test_neutral_profiles_match_sensitivity_only(self):
        """Neutral persona defaults reproduce sensitivity-only behavior."""
        seed = 555
        neutral = _make_config(agents=[
            AgentConfig(type="customer", name="Users", count=100, sensitivity=0.7),
        ])
        explicit_neutral = _make_config(agents=[
            AgentConfig(
                type="customer", name="Users", count=100, sensitivity=0.7,
                activity_level=0.5, influence_weight=0.5, sentiment_bias=0.0, risk_tolerance=0.5,
            ),
        ])
        r1 = await SimulationEngine(neutral).run(base_seed=seed)
        r2 = await SimulationEngine(explicit_neutral).run(base_seed=seed)
        assert r1.avg_revenue == r2.avg_revenue
        assert r1.success_probability == r2.success_probability


# ── Confidence diagnostics ────────────────────────────────────────────────────

class TestConfidenceDiagnostics:
    @pytest.mark.asyncio
    async def test_diagnostic_fields_present(self):
        config = _make_config(num_runs=100)
        results = await SimulationEngine(config).run(base_seed=42)
        assert results.monte_carlo_standard_error is not None
        assert results.monte_carlo_standard_error >= 0
        assert results.convergence_delta is not None
        assert results.convergence_delta >= 0
        assert isinstance(results.converged, bool)
        assert results.forecast_confidence in ("high", "medium", "low")

    @pytest.mark.asyncio
    async def test_mcse_matches_formula(self):
        """MCSE == sqrt(p(1-p)/n) * 100 on the success probability."""
        import math
        config = _make_config(num_runs=100)
        results = await SimulationEngine(config).run(base_seed=42)
        p = results.success_probability / 100
        expected = round(math.sqrt(p * (1 - p) / 100) * 100, 3)
        assert results.monte_carlo_standard_error == expected


# ── decision_style modulation ──────────────────────────────────────────────────

class TestDecisionStyleEffect:
    @pytest.mark.asyncio
    async def test_decision_style_changes_outcomes_under_same_seed(self):
        """Two configs identical except for decision_style must diverge under
        the same base_seed — proving decision_style is not dead data."""
        def cfg(style):
            return _make_config(agents=[
                AgentConfig(
                    type="customer", name="Users", count=100, sensitivity=0.7,
                    activity_level=0.5, risk_tolerance=0.5, decision_style=style,
                ),
                AgentConfig(type="competitor", name="Rival", count=1, sensitivity=0.5),
                AgentConfig(type="market", name="Macro", count=1, sensitivity=0.6),
            ])

        aggressive = await SimulationEngine(cfg("aggressive")).run(base_seed=4242)
        conservative = await SimulationEngine(cfg("conservative")).run(base_seed=4242)

        # Same RNG seed, different persona style => different revenue.
        assert aggressive.avg_revenue != conservative.avg_revenue

    @pytest.mark.asyncio
    async def test_balanced_style_is_neutral(self):
        """'balanced' must not shift the numeric knobs (back-compat)."""
        from app.services.simulation_engine import CustomerAgent
        a = CustomerAgent(count=10, sensitivity=0.5, price=99, market_size=1000,
                          params={"activity_level": 0.5, "risk_tolerance": 0.5,
                                  "decision_style": "balanced"})
        assert a.activity_level == 0.5
        assert a.risk_tolerance == 0.5
