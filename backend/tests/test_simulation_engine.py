"""Tests for the simulation engine and agent types."""
import pytest
import random
from app.models.simulation import (
    SimulationConfig, SimulationVariable, AgentConfig, SimulationCategory,
)
from app.services.simulation_engine import (
    CustomerAgent, CompetitorAgent, InvestorAgent, MarketForceAgent,
    TraderAgent, MarketMakerAgent, MoleculeAgent, EnzymeAgent,
    DataStreamAgent, SupplyChainAgent, EmployeeAgent, SimulationEngine,
)


# ── Agent unit tests ─────────────────────────────────────────────────────────

class TestCustomerAgent:
    def test_react_returns_expected_keys(self):
        agent = CustomerAgent(count=100, sensitivity=0.7, price=99, market_size=1_000_000)
        result = agent.react({"month": 1}, {"price_per_unit": 99, "conversion_rate": 5, "churn_rate": 3})
        assert "new_customers" in result
        assert "churned" in result
        assert "total" in result

    def test_customers_accumulate(self):
        random.seed(42)
        agent = CustomerAgent(count=100, sensitivity=0.7, price=99, market_size=1_000_000)
        for month in range(1, 6):
            result = agent.react({"month": month}, {"conversion_rate": 10, "churn_rate": 1})
        assert result["total"] > 0


class TestCompetitorAgent:
    def test_observing_during_delay(self):
        random.seed(42)
        agent = CompetitorAgent(count=1, sensitivity=0.7)
        result = agent.react({"month": 1, "month_growth": 0.2}, {})
        assert result["action"] == "observing"

    def test_reacts_after_delay(self):
        random.seed(42)
        agent = CompetitorAgent(count=1, sensitivity=0.7)
        agent.state["reaction_delay"] = 1  # Force immediate reaction
        result = agent.react({"month": 2, "month_growth": 0.2}, {})
        assert result["action"] in ("price_cut", "feature_launch", "marketing_surge")


class TestInvestorAgent:
    def test_interest_increases_with_growth(self):
        agent = InvestorAgent(count=1, sensitivity=0.8)
        initial_interest = agent.state["interest"]
        agent.react({"revenue_growth": 0.2, "total_customers": 100}, {})
        assert agent.state["interest"] > initial_interest


class TestMarketForceAgent:
    def test_returns_multiplier(self):
        agent = MarketForceAgent(sensitivity=0.7)
        result = agent.react({}, {})
        assert "trend_multiplier" in result
        assert "recession" in result
        assert isinstance(result["trend_multiplier"], float)


class TestTraderAgent:
    def test_momentum_strategy(self):
        agent = TraderAgent(count=1, sensitivity=0.7)
        agent.state["strategy"] = "momentum"
        result = agent.react({"price": 110, "prev_price": 100, "moving_avg": 105}, {"volatility": 20})
        assert result["action"] in ("buy", "sell", "hold")
        assert "pnl" in result

    def test_mean_reversion_strategy(self):
        agent = TraderAgent(count=1, sensitivity=0.7)
        agent.state["strategy"] = "mean_reversion"
        result = agent.react({"price": 90, "prev_price": 100, "moving_avg": 105}, {"volatility": 20})
        assert result["action"] in ("buy", "sell", "hold")


class TestMarketMakerAgent:
    def test_spread_widens_with_volatility(self):
        agent = MarketMakerAgent(count=1, sensitivity=0.9)
        result = agent.react({}, {"volatility": 50})  # High volatility
        assert result["spread"] > 0.5


class TestMoleculeAgent:
    def test_returns_binding_state(self):
        agent = MoleculeAgent(count=1, sensitivity=0.7)
        result = agent.react({}, {"temperature": 310, "binding_affinity": 10, "concentration": 100, "ph_level": 7.4})
        assert "bound" in result
        assert "energy" in result
        assert "conformation" in result


class TestEnzymeAgent:
    def test_activity_at_optimal_conditions(self):
        random.seed(42)
        agent = EnzymeAgent(count=1, sensitivity=0.7)
        result = agent.react({}, {"temperature": 310, "ph_level": 7.4})
        assert result["active"] is True
        assert result["rate"] > 0

    def test_denaturation_at_extreme_temp(self):
        random.seed(1)
        agent = EnzymeAgent(count=1, sensitivity=0.7)
        # Run many steps at extreme temp to trigger denaturation
        denatured = False
        for _ in range(100):
            result = agent.react({}, {"temperature": 360, "ph_level": 7.4})
            if not result["active"]:
                denatured = True
                break
        assert denatured


class TestDataStreamAgent:
    def test_signal_generation(self):
        agent = DataStreamAgent(count=1, sensitivity=0.7)
        result = agent.react({"step": 10}, {"seasonality_period": 12, "trend_strength": 50, "noise_level": 15})
        assert "signal" in result
        assert "trend_component" in result
        assert "seasonal_component" in result
        assert "pattern_detected" in result


class TestSupplyChainAgent:
    def test_returns_expected_keys(self):
        agent = SupplyChainAgent(count=1, sensitivity=0.7)
        result = agent.react({"month": 1, "month_growth": 0.05}, {})
        assert "reliability" in result
        assert "lead_time" in result
        assert "cost_impact" in result
        assert "disrupted" in result

    def test_stress_under_high_demand(self):
        random.seed(42)
        agent = SupplyChainAgent(count=1, sensitivity=0.9)
        initial_reliability = agent.state["reliability"]
        # Apply high demand growth repeatedly
        for _ in range(10):
            agent.react({"month": 1, "month_growth": 0.3}, {})
        assert agent.state["reliability"] < initial_reliability


class TestEmployeeAgent:
    def test_returns_expected_keys(self):
        agent = EmployeeAgent(count=10, sensitivity=0.7)
        result = agent.react({"revenue": 100000, "total_customers": 500, "month": 1}, {})
        assert "headcount" in result
        assert "productivity" in result
        assert "morale" in result
        assert "attrition" in result
        assert "new_hires" in result
        assert "productivity_multiplier" in result

    def test_hiring_scales_with_customers(self):
        random.seed(42)
        agent = EmployeeAgent(count=5, sensitivity=0.7)
        agent.react({"revenue": 100000, "total_customers": 1000, "month": 1}, {})
        assert agent.state["headcount"] >= 5  # Should try to hire more


# ── SimulationEngine unit tests ──────────────────────────────────────────────

def _make_config(category="startup", variables=None, agents=None, num_runs=20, time_horizon=6):
    return SimulationConfig(
        name="Test Simulation",
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


class TestSimulationEngineFindVar:
    def test_exact_match(self):
        engine = SimulationEngine(_make_config())
        assert engine._find_var({"budget": 50000}, "budget", default=0) == 50000

    def test_partial_match(self):
        engine = SimulationEngine(_make_config())
        assert engine._find_var({"monthly_budget": 30000}, "budget", default=0) == 30000

    def test_multiple_keys(self):
        engine = SimulationEngine(_make_config())
        result = engine._find_var({"burn_rate": 40000}, "budget", "burn_rate", default=0)
        assert result == 40000

    def test_default_fallback(self):
        engine = SimulationEngine(_make_config())
        assert engine._find_var({}, "nonexistent", default=999) == 999


class TestSimulationEngineRunSingle:
    def test_business_run_structure(self):
        random.seed(42)
        engine = SimulationEngine(_make_config())
        result = engine._run_single()
        assert "success" in result
        assert "final_revenue" in result
        assert "final_customers" in result
        assert "final_market_share" in result
        assert "months_survived" in result
        assert "timeline" in result
        assert isinstance(result["timeline"], list)

    def test_finance_run_structure(self):
        random.seed(42)
        config = _make_config(
            category="finance",
            variables=[
                SimulationVariable(name="portfolio_value", label="Capital", value=100000),
                SimulationVariable(name="volatility", label="Volatility", value=20),
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

    def test_biology_run_structure(self):
        random.seed(42)
        config = _make_config(
            category="biology",
            variables=[
                SimulationVariable(name="num_molecules", label="Molecules", value=50),
                SimulationVariable(name="sim_steps", label="Steps", value=100),
                SimulationVariable(name="temperature", label="Temp", value=310),
                SimulationVariable(name="ph_level", label="pH", value=7.4),
                SimulationVariable(name="binding_affinity", label="Kd", value=10),
                SimulationVariable(name="concentration", label="Conc", value=100),
            ],
            agents=[
                AgentConfig(type="molecule", name="Ligand", count=50, sensitivity=0.7),
                AgentConfig(type="enzyme", name="Kinase", count=5, sensitivity=0.6),
            ],
        )
        engine = SimulationEngine(config)
        result = engine._run_single()
        assert "success" in result
        assert "timeline" in result

    def test_trend_run_structure(self):
        random.seed(42)
        config = _make_config(
            category="trend",
            variables=[
                SimulationVariable(name="forecast_periods", label="Periods", value=24),
                SimulationVariable(name="confidence_level", label="Confidence", value=95),
                SimulationVariable(name="trend_strength", label="Trend", value=50),
                SimulationVariable(name="seasonality_period", label="Season", value=12),
                SimulationVariable(name="noise_level", label="Noise", value=15),
            ],
            agents=[
                AgentConfig(type="data_stream", name="Signal", count=3, sensitivity=0.7),
            ],
        )
        engine = SimulationEngine(config)
        result = engine._run_single()
        assert "success" in result
        assert "timeline" in result

    def test_business_with_supply_chain_and_employee(self):
        random.seed(42)
        config = _make_config(
            agents=[
                AgentConfig(type="customer", name="Users", count=100, sensitivity=0.7),
                AgentConfig(type="supply_chain", name="Supplier", count=1, sensitivity=0.6),
                AgentConfig(type="employee", name="Team", count=10, sensitivity=0.7),
            ],
        )
        engine = SimulationEngine(config)
        result = engine._run_single()
        assert "success" in result
        assert result["months_survived"] > 0


class TestSimulationEngineFullRun:
    @pytest.mark.asyncio
    async def test_full_monte_carlo(self):
        config = _make_config(num_runs=20, time_horizon=6)
        engine = SimulationEngine(config)
        # Deterministic seeding replaces the old global random.seed(42).
        results = await engine.run(base_seed=42)

        assert 0 <= results.success_probability <= 100
        assert results.confidence_interval[0] <= results.confidence_interval[1]
        assert len(results.timeline_aggregated) > 0
        assert len(results.outcome_distribution) > 0
        assert len(results.risk_factors) > 0
        assert len(results.key_insights) > 0
        assert results.success_explanation
        assert results.failure_explanation
        assert results.domain_metadata is not None

    @pytest.mark.asyncio
    async def test_variable_overrides(self):
        config = _make_config(num_runs=20, time_horizon=6)
        engine = SimulationEngine(config)
        results = await engine.run(variable_overrides={"budget": 200000}, base_seed=42)
        # Should still produce valid results
        assert 0 <= results.success_probability <= 100

    @pytest.mark.asyncio
    async def test_finance_domain_metadata(self):
        config = _make_config(
            category="finance",
            variables=[
                SimulationVariable(name="portfolio_value", label="Capital", value=100000),
                SimulationVariable(name="volatility", label="Volatility", value=20),
            ],
            agents=[AgentConfig(type="trader", name="T", count=2, sensitivity=0.7)],
            num_runs=20,
            time_horizon=3,
        )
        engine = SimulationEngine(config)
        results = await engine.run()
        assert results.domain_metadata.primary_metric_label == "Portfolio PnL"

    @pytest.mark.asyncio
    async def test_biology_domain_metadata(self):
        config = _make_config(
            category="biology",
            variables=[
                SimulationVariable(name="num_molecules", label="Molecules", value=20),
                SimulationVariable(name="sim_steps", label="Steps", value=50),
                SimulationVariable(name="temperature", label="Temp", value=310),
                SimulationVariable(name="ph_level", label="pH", value=7.4),
                SimulationVariable(name="binding_affinity", label="Kd", value=10),
                SimulationVariable(name="concentration", label="Conc", value=100),
            ],
            agents=[AgentConfig(type="molecule", name="M", count=20, sensitivity=0.7)],
            num_runs=20,
            time_horizon=3,
        )
        engine = SimulationEngine(config)
        results = await engine.run()
        assert results.domain_metadata.primary_metric_label == "Binding Rate"


class TestRiskFactorGeneration:
    @pytest.mark.asyncio
    async def test_business_risks_generated(self):
        config = _make_config(num_runs=50)
        engine = SimulationEngine(config)
        results = await engine.run()
        risk_names = [r.name for r in results.risk_factors]
        # Should always have competitive pressure and macro risks for business
        assert any("Competitive" in n for n in risk_names) or any("Market" in n or "Macro" in n for n in risk_names)

    @pytest.mark.asyncio
    async def test_finance_risks_generated(self):
        config = _make_config(
            category="finance",
            variables=[
                SimulationVariable(name="portfolio_value", label="Capital", value=100000),
                SimulationVariable(name="volatility", label="Volatility", value=20),
            ],
            agents=[AgentConfig(type="trader", name="T", count=2, sensitivity=0.7)],
            num_runs=50,
            time_horizon=3,
        )
        engine = SimulationEngine(config)
        results = await engine.run()
        risk_names = [r.name for r in results.risk_factors]
        assert any("Correlation" in n or "Liquidity" in n for n in risk_names)
