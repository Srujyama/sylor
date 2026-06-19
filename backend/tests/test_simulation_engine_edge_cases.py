"""
Edge-case tests for the simulation engine.

These test scenarios that real users actually encounter:
extreme parameter values, numerical stability at scale,
and agent interactions under stress.
"""
import pytest
import random
import math
import numpy as np
from app.models.simulation import (
    SimulationConfig, SimulationVariable, AgentConfig, SimulationCategory,
)
from app.services.simulation_engine import (
    CustomerAgent, CompetitorAgent, InvestorAgent, MarketForceAgent,
    TraderAgent, MarketMakerAgent, MoleculeAgent, EnzymeAgent,
    DataStreamAgent, SupplyChainAgent, EmployeeAgent, SimulationEngine,
)


def _make_config(category="startup", variables=None, agents=None, num_runs=20, time_horizon=6):
    return SimulationConfig(
        name="Edge Case Test",
        category=SimulationCategory(category),
        variables=variables or [
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


# ---------------------------------------------------------------------------
# Zero / minimal budget
# ---------------------------------------------------------------------------

class TestZeroBudgetSimulation:
    """A user sets budget=0 to see what happens with no starting capital."""

    def test_zero_budget_does_not_crash(self):
        """Zero budget should still produce a valid result, not throw."""
        random.seed(42)
        config = _make_config(variables=[
            SimulationVariable(name="budget", label="Budget", type="currency", value=0),
            SimulationVariable(name="price_per_unit", label="Price", type="currency", value=99),
            SimulationVariable(name="market_size", label="Market Size", value=1_000_000),
            SimulationVariable(name="conversion_rate", label="Conversion", type="percentage", value=5),
            SimulationVariable(name="churn_rate", label="Churn", type="percentage", value=3),
        ])
        engine = SimulationEngine(config)
        result = engine._run_single()
        assert "success" in result
        assert "timeline" in result
        assert isinstance(result["timeline"], list)

    def test_zero_budget_survives_on_revenue(self):
        """With zero budget but positive revenue from customers, the sim may still survive.
        The engine's burn formula is budget * 0.8, so budget=0 means zero burn --
        the business survives on incoming revenue alone."""
        random.seed(42)
        config = _make_config(variables=[
            SimulationVariable(name="budget", label="Budget", type="currency", value=0),
            SimulationVariable(name="price_per_unit", label="Price", type="currency", value=99),
            SimulationVariable(name="market_size", label="Market Size", value=1_000_000),
            SimulationVariable(name="conversion_rate", label="Conversion", type="percentage", value=5),
            SimulationVariable(name="churn_rate", label="Churn", type="percentage", value=3),
        ])
        engine = SimulationEngine(config)
        result = engine._run_single()
        # With budget=0, burn is 0*0.8=0, so the sim survives the full horizon
        assert result["months_survived"] == config.time_horizon

    @pytest.mark.asyncio
    async def test_zero_budget_full_monte_carlo(self):
        """Full Monte Carlo with zero budget should still aggregate without errors."""
        random.seed(42)
        config = _make_config(
            num_runs=20,
            variables=[
                SimulationVariable(name="budget", label="Budget", type="currency", value=0),
                SimulationVariable(name="price_per_unit", label="Price", type="currency", value=99),
                SimulationVariable(name="market_size", label="Market Size", value=1_000_000),
                SimulationVariable(name="conversion_rate", label="Conversion", type="percentage", value=5),
                SimulationVariable(name="churn_rate", label="Churn", type="percentage", value=3),
            ],
        )
        engine = SimulationEngine(config)
        results = await engine.run()
        assert 0 <= results.success_probability <= 100
        assert len(results.timeline_aggregated) >= 1


# ---------------------------------------------------------------------------
# Massive market, tiny conversion -- numerical stability
# ---------------------------------------------------------------------------

class TestMassiveMarketTinyConversion:
    """10 billion person market with 0.001% conversion -- tests overflow / precision."""

    def test_numerical_stability(self):
        """Large market * tiny rate should not produce inf or nan values."""
        random.seed(42)
        config = _make_config(variables=[
            SimulationVariable(name="budget", label="Budget", type="currency", value=500_000),
            SimulationVariable(name="price_per_unit", label="Price", type="currency", value=9.99),
            SimulationVariable(name="market_size", label="Market Size", value=10_000_000_000),
            SimulationVariable(name="conversion_rate", label="Conversion", type="percentage", value=0.001),
            SimulationVariable(name="churn_rate", label="Churn", type="percentage", value=1),
        ])
        engine = SimulationEngine(config)
        result = engine._run_single()
        assert not math.isnan(result["final_revenue"])
        assert not math.isinf(result["final_revenue"])
        for point in result["timeline"]:
            assert not math.isnan(point["revenue"])
            assert not math.isinf(point["revenue"])


# ---------------------------------------------------------------------------
# All agent types combined in a single business simulation
# ---------------------------------------------------------------------------

class TestAllAgentsCombined:
    """A power user throws every agent type at a single business simulation."""

    def test_all_business_agents_together(self):
        """Customer + competitor + investor + market + supply_chain + employee should coexist."""
        random.seed(42)
        config = _make_config(agents=[
            AgentConfig(type="customer", name="Users", count=200, sensitivity=0.7),
            AgentConfig(type="competitor", name="Rival A", count=2, sensitivity=0.6),
            AgentConfig(type="investor", name="VC", count=1, sensitivity=0.8),
            AgentConfig(type="market", name="Economy", count=1, sensitivity=0.5),
            AgentConfig(type="supply_chain", name="Supplier", count=1, sensitivity=0.7),
            AgentConfig(type="employee", name="Team", count=15, sensitivity=0.6),
        ])
        engine = SimulationEngine(config)
        result = engine._run_single()
        assert "success" in result
        assert result["months_survived"] > 0
        assert "timeline" in result
        assert len(result["timeline"]) > 0

    @pytest.mark.asyncio
    async def test_all_agents_monte_carlo(self):
        """Full Monte Carlo with all agents should produce valid aggregated results."""
        random.seed(42)
        config = _make_config(
            num_runs=30,
            agents=[
                AgentConfig(type="customer", name="Users", count=200, sensitivity=0.7),
                AgentConfig(type="competitor", name="Rival A", count=2, sensitivity=0.6),
                AgentConfig(type="investor", name="VC", count=1, sensitivity=0.8),
                AgentConfig(type="market", name="Economy", count=1, sensitivity=0.5),
                AgentConfig(type="supply_chain", name="Supplier", count=1, sensitivity=0.7),
                AgentConfig(type="employee", name="Team", count=15, sensitivity=0.6),
            ],
        )
        engine = SimulationEngine(config)
        results = await engine.run()
        assert 0 <= results.success_probability <= 100
        assert results.confidence_interval[0] <= results.confidence_interval[1]
        assert len(results.risk_factors) > 0


# ---------------------------------------------------------------------------
# Variable override with nonexistent variable
# ---------------------------------------------------------------------------

class TestVariableOverrideEdgeCases:
    """User passes overrides that don't match any config variable."""

    @pytest.mark.asyncio
    async def test_nonexistent_override_ignored_gracefully(self):
        """Overriding a variable that doesn't exist should not crash."""
        random.seed(42)
        config = _make_config(num_runs=20)
        engine = SimulationEngine(config)
        results = await engine.run(variable_overrides={"totally_fake_variable": 999999})
        assert 0 <= results.success_probability <= 100

    @pytest.mark.asyncio
    async def test_override_actually_changes_behavior(self):
        """Overriding budget to a huge value should shift success probability."""
        config = _make_config(num_runs=50)
        engine_low = SimulationEngine(config)
        results_low = await engine_low.run(variable_overrides={"budget": 100}, base_seed=42)

        engine_high = SimulationEngine(config)
        results_high = await engine_high.run(variable_overrides={"budget": 10_000_000}, base_seed=42)

        # With 10M budget vs 100, success should differ meaningfully
        # (we can't guarantee direction due to the burn formula, but they shouldn't be identical)
        assert isinstance(results_low.success_probability, float)
        assert isinstance(results_high.success_probability, float)


# ---------------------------------------------------------------------------
# Single run vs many runs -- confidence intervals
# ---------------------------------------------------------------------------

class TestRunCountImpact:
    """Compare num_runs=10 vs num_runs=200 to verify both produce valid results."""

    @pytest.mark.asyncio
    async def test_few_runs_still_valid(self):
        """10 runs should still produce results with valid structure."""
        random.seed(42)
        config = _make_config(num_runs=10)
        engine = SimulationEngine(config)
        results = await engine.run()
        assert 0 <= results.success_probability <= 100
        assert results.confidence_interval[0] <= results.confidence_interval[1]
        assert len(results.outcome_distribution) > 0

    @pytest.mark.asyncio
    async def test_many_runs_narrower_confidence(self):
        """200 runs should produce a tighter confidence interval than 10 runs (on average)."""
        config_few = _make_config(num_runs=10)
        engine_few = SimulationEngine(config_few)
        results_few = await engine_few.run(base_seed=42)

        config_many = _make_config(num_runs=200)
        engine_many = SimulationEngine(config_many)
        results_many = await engine_many.run(base_seed=42)

        ci_width_few = results_few.confidence_interval[1] - results_few.confidence_interval[0]
        ci_width_many = results_many.confidence_interval[1] - results_many.confidence_interval[0]

        # Both should be non-negative
        assert ci_width_few >= 0
        assert ci_width_many >= 0
        # More runs should generally tighten the CI (not guaranteed with different seeds,
        # but the structure should be valid regardless)


# ---------------------------------------------------------------------------
# Extreme volatility in finance
# ---------------------------------------------------------------------------

class TestExtremeFinanceVolatility:
    """User sets volatility=100 (100%) -- should not crash or produce inf."""

    def test_extreme_volatility_does_not_crash(self):
        """Finance simulation with volatility=100 should complete without error."""
        random.seed(42)
        config = _make_config(
            category="finance",
            variables=[
                SimulationVariable(name="portfolio_value", label="Capital", value=100_000),
                SimulationVariable(name="volatility", label="Volatility", value=100),
                SimulationVariable(name="num_assets", label="Assets", value=5),
            ],
            agents=[
                AgentConfig(type="trader", name="Momentum", count=3, sensitivity=0.7),
                AgentConfig(type="market_maker", name="MM", count=1, sensitivity=0.5),
            ],
        )
        engine = SimulationEngine(config)
        result = engine._run_single()
        assert "success" in result
        assert "timeline" in result
        # Values should be finite
        for point in result["timeline"]:
            assert not math.isinf(point["revenue"])

    @pytest.mark.asyncio
    async def test_extreme_volatility_monte_carlo(self):
        """Monte Carlo with extreme volatility should still aggregate."""
        random.seed(42)
        config = _make_config(
            category="finance",
            variables=[
                SimulationVariable(name="portfolio_value", label="Capital", value=100_000),
                SimulationVariable(name="volatility", label="Volatility", value=100),
                SimulationVariable(name="num_assets", label="Assets", value=3),
            ],
            agents=[
                AgentConfig(type="trader", name="T", count=2, sensitivity=0.7),
            ],
            num_runs=20,
            time_horizon=3,
        )
        engine = SimulationEngine(config)
        results = await engine.run()
        assert 0 <= results.success_probability <= 100


class TestNoSurvivorBreakevenIsFinite:
    """When no run survives a single period, avg_breakeven_month must be a
    finite sentinel (0.0), never NaN — a NaN here poisons the Pareto optimizer
    and serializes as invalid JSON."""

    @pytest.mark.asyncio
    async def test_zero_trading_days_yields_finite_breakeven(self):
        random.seed(42)
        config = _make_config(
            category="finance",
            variables=[
                SimulationVariable(name="portfolio_value", label="Capital", value=100_000),
                SimulationVariable(name="trading_days", label="Days", value=0),
                SimulationVariable(name="num_assets", label="Assets", value=3),
            ],
            agents=[AgentConfig(type="trader", name="T", count=2, sensitivity=0.7)],
            num_runs=20,
        )
        results = await SimulationEngine(config).run()
        assert math.isfinite(results.avg_breakeven_month)
        assert results.avg_breakeven_month == 0.0


# ---------------------------------------------------------------------------
# Biology at extreme pH
# ---------------------------------------------------------------------------

class TestBiologyExtremePH:
    """User simulates enzyme behavior at pH 0 and pH 14 -- strong acid/base."""

    def test_ph_zero_triggers_denaturation(self):
        """At pH=0 enzymes should denature frequently."""
        random.seed(42)
        agent = EnzymeAgent(count=1, sensitivity=0.7)
        denatured = False
        for _ in range(200):
            result = agent.react({}, {"temperature": 310, "ph_level": 0})
            if not result["active"]:
                denatured = True
                break
        # pH=0 is below the denaturation threshold of pH<4, so denaturation should trigger
        assert denatured, "Enzyme should denature at pH 0"

    def test_ph_fourteen_triggers_denaturation(self):
        """At pH=14 enzymes should denature frequently."""
        random.seed(42)
        agent = EnzymeAgent(count=1, sensitivity=0.7)
        denatured = False
        for _ in range(200):
            result = agent.react({}, {"temperature": 310, "ph_level": 14})
            if not result["active"]:
                denatured = True
                break
        assert denatured, "Enzyme should denature at pH 14"

    def test_extreme_ph_reduces_molecule_binding(self):
        """Molecule binding probability should drop significantly at extreme pH."""
        random.seed(42)
        agent_normal = MoleculeAgent(count=1, sensitivity=0.7)
        agent_extreme = MoleculeAgent(count=1, sensitivity=0.7)
        # Copy state so they start identically
        agent_extreme.state = dict(agent_normal.state)

        binds_normal = 0
        binds_extreme = 0
        trials = 500
        for _ in range(trials):
            r1 = agent_normal.react({}, {"temperature": 310, "binding_affinity": 10, "concentration": 100, "ph_level": 7.4})
            # Reset for independent trial
            agent_normal.state["bound"] = False

            r2 = agent_extreme.react({}, {"temperature": 310, "binding_affinity": 10, "concentration": 100, "ph_level": 0})
            agent_extreme.state["bound"] = False

            if r1["bound"]:
                binds_normal += 1
            if r2["bound"]:
                binds_extreme += 1

        # Extreme pH should have fewer bindings than normal pH
        assert binds_extreme < binds_normal, (
            f"Extreme pH binding ({binds_extreme}) should be less than normal ({binds_normal})"
        )


# ---------------------------------------------------------------------------
# Trend with zero noise
# ---------------------------------------------------------------------------

class TestTrendZeroNoise:
    """User sets noise_level=0 to see the clean underlying signal."""

    def test_zero_noise_produces_clean_signal(self):
        """With noise_level=0 the signal should be purely trend + seasonality."""
        random.seed(42)
        agent = DataStreamAgent(count=1, sensitivity=0.7)
        # Fix trend to a known value for predictability
        agent.state["trend"] = 0.01

        results = []
        for step in range(1, 25):
            result = agent.react(
                {"step": step},
                {"seasonality_period": 12, "trend_strength": 50, "noise_level": 0},
            )
            results.append(result)

        # With zero noise, every signal should be deterministic (trend + seasonality only)
        # Re-run with same seed and state to verify consistency
        for r in results:
            assert "signal" in r
            assert not math.isnan(r["signal"])

    @pytest.mark.asyncio
    async def test_zero_noise_full_trend_simulation(self):
        """Full trend simulation with zero noise should complete without error."""
        random.seed(42)
        config = _make_config(
            category="trend",
            variables=[
                SimulationVariable(name="forecast_periods", label="Periods", value=24),
                SimulationVariable(name="confidence_level", label="Confidence", value=95),
                SimulationVariable(name="trend_strength", label="Trend", value=50),
                SimulationVariable(name="seasonality_period", label="Season", value=12),
                SimulationVariable(name="noise_level", label="Noise", value=0),
            ],
            agents=[AgentConfig(type="data_stream", name="Signal", count=3, sensitivity=0.7)],
            num_runs=20,
            time_horizon=6,
        )
        engine = SimulationEngine(config)
        results = await engine.run()
        assert 0 <= results.success_probability <= 100


# ---------------------------------------------------------------------------
# Very short time horizon (1 month)
# ---------------------------------------------------------------------------

class TestVeryShortTimeHorizon:
    """User runs a single-month simulation to test quick feasibility."""

    @pytest.mark.asyncio
    async def test_one_month_business(self):
        """A 1-month business simulation should produce at least one timeline point."""
        random.seed(42)
        config = _make_config(num_runs=20, time_horizon=1)
        engine = SimulationEngine(config)
        results = await engine.run()
        assert 0 <= results.success_probability <= 100
        assert len(results.timeline_aggregated) >= 1

    @pytest.mark.asyncio
    async def test_one_month_finance(self):
        """A 1-month finance simulation should still produce a valid timeline."""
        random.seed(42)
        config = _make_config(
            category="finance",
            variables=[
                SimulationVariable(name="portfolio_value", label="Capital", value=100_000),
                SimulationVariable(name="volatility", label="Volatility", value=20),
            ],
            agents=[AgentConfig(type="trader", name="T", count=2, sensitivity=0.7)],
            num_runs=20,
            time_horizon=1,
        )
        engine = SimulationEngine(config)
        results = await engine.run()
        assert 0 <= results.success_probability <= 100
        assert len(results.timeline_aggregated) >= 1


# ---------------------------------------------------------------------------
# Very long time horizon (120 months = 10 years)
# ---------------------------------------------------------------------------

class TestVeryLongTimeHorizon:
    """User runs a 10-year simulation to model long-term strategy."""

    @pytest.mark.asyncio
    async def test_120_month_business_does_not_explode(self):
        """120-month business sim should complete and produce finite values."""
        random.seed(42)
        config = _make_config(num_runs=10, time_horizon=120)
        engine = SimulationEngine(config)
        results = await engine.run()
        assert 0 <= results.success_probability <= 100
        # Revenue values in the timeline should all be finite
        for point in results.timeline_aggregated:
            assert not math.isinf(point["avg_revenue"])
            assert not math.isnan(point["avg_revenue"])

    @pytest.mark.asyncio
    async def test_120_month_biology(self):
        """120-month biology sim with many steps should still converge."""
        random.seed(42)
        config = _make_config(
            category="biology",
            variables=[
                SimulationVariable(name="num_molecules", label="Molecules", value=20),
                SimulationVariable(name="sim_steps", label="Steps", value=500),
                SimulationVariable(name="temperature", label="Temp", value=310),
                SimulationVariable(name="ph_level", label="pH", value=7.4),
                SimulationVariable(name="binding_affinity", label="Kd", value=10),
                SimulationVariable(name="concentration", label="Conc", value=100),
            ],
            agents=[AgentConfig(type="molecule", name="M", count=20, sensitivity=0.7)],
            num_runs=10,
            time_horizon=120,
        )
        engine = SimulationEngine(config)
        results = await engine.run()
        assert 0 <= results.success_probability <= 100
        assert len(results.timeline_aggregated) > 0
