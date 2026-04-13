"""Tests for simulation models and validation."""
import pytest
from app.models.simulation import (
    AgentType, AgentConfig, SimulationConfig, SimulationVariable,
    SimulationCategory, SimulationStatus, RiskFactor, CompanyContext,
)


class TestAgentType:
    def test_direct_values(self):
        for at in AgentType:
            assert AgentType(at.value) == at

    def test_supply_chain_and_employee_exist(self):
        assert AgentType.SUPPLY_CHAIN == AgentType("supply_chain")
        assert AgentType.EMPLOYEE == AgentType("employee")


class TestAgentConfigCoercion:
    """Test that AI-generated agent type strings are properly coerced."""

    @pytest.mark.parametrize("input_type,expected", [
        ("customer", AgentType.CUSTOMER),
        ("competitor", AgentType.COMPETITOR),
        ("trader", AgentType.TRADER),
        ("supply_chain", AgentType.SUPPLY_CHAIN),
        ("employee", AgentType.EMPLOYEE),
        # Fallback map entries
        ("momentum_trader", AgentType.TRADER),
        ("value_investor", AgentType.INVESTOR),
        ("consumer", AgentType.CUSTOMER),
        ("buyer", AgentType.CUSTOMER),
        ("regulatory", AgentType.REGULATOR),
        ("government", AgentType.REGULATOR),
        ("ligand", AgentType.MOLECULE),
        ("catalyst", AgentType.ENZYME),
        ("supplier", AgentType.SUPPLY_CHAIN),
        ("vendor", AgentType.SUPPLY_CHAIN),
        ("logistics", AgentType.SUPPLY_CHAIN),
        ("worker", AgentType.EMPLOYEE),
        ("staff", AgentType.EMPLOYEE),
        ("talent", AgentType.EMPLOYEE),
        # Case/whitespace normalization
        ("CUSTOMER", AgentType.CUSTOMER),
        ("  trader  ", AgentType.TRADER),
        ("Market-Maker", AgentType.MARKET_MAKER),
    ])
    def test_coercion(self, input_type, expected):
        config = AgentConfig(type=input_type, name="test", count=1)
        assert config.type == expected

    def test_unknown_falls_back_to_market(self):
        config = AgentConfig(type="completely_unknown_xyz", name="test", count=1)
        assert config.type == AgentType.MARKET


class TestSimulationVariable:
    def test_basic_creation(self):
        v = SimulationVariable(name="budget", label="Budget", value=50000)
        assert v.name == "budget"
        assert v.type == "number"
        assert v.id  # auto-generated

    def test_all_types(self):
        for t in ["number", "percentage", "currency", "boolean", "select"]:
            v = SimulationVariable(name="x", label="X", type=t, value=1)
            assert v.type == t


class TestSimulationConfig:
    def test_valid_config(self):
        config = SimulationConfig(
            name="Test Sim",
            category=SimulationCategory.STARTUP,
            variables=[SimulationVariable(name="budget", label="Budget", value=50000)],
            agents=[AgentConfig(type="customer", name="Users", count=100)],
        )
        assert config.num_runs == 1000
        assert config.time_horizon == 12

    def test_name_constraints(self):
        with pytest.raises(Exception):
            SimulationConfig(
                name="",  # too short
                category=SimulationCategory.STARTUP,
                variables=[], agents=[],
            )

    def test_num_runs_bounds(self):
        with pytest.raises(Exception):
            SimulationConfig(
                name="Test",
                category=SimulationCategory.STARTUP,
                variables=[], agents=[],
                num_runs=5,  # below minimum of 10
            )

    def test_time_horizon_bounds(self):
        with pytest.raises(Exception):
            SimulationConfig(
                name="Test",
                category=SimulationCategory.STARTUP,
                variables=[], agents=[],
                time_horizon=200,  # above maximum of 120
            )

    def test_all_categories(self):
        for cat in SimulationCategory:
            config = SimulationConfig(
                name="Test", category=cat, variables=[], agents=[],
            )
            assert config.category == cat


class TestRiskFactor:
    def test_severities(self):
        for sev in ["low", "medium", "high", "critical"]:
            rf = RiskFactor(name="Test", severity=sev, probability=50, description="desc", mitigation="mit")
            assert rf.severity == sev


class TestSimulationStatus:
    def test_all_statuses(self):
        assert SimulationStatus.DRAFT.value == "draft"
        assert SimulationStatus.RUNNING.value == "running"
        assert SimulationStatus.COMPLETED.value == "completed"
        assert SimulationStatus.FAILED.value == "failed"
