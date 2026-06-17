from pydantic import BaseModel, Field, field_validator, model_validator
from typing import List, Optional, Dict, Any, Literal
from enum import Enum
import uuid
from datetime import datetime


class SimulationStatus(str, Enum):
    DRAFT = "draft"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class AgentType(str, Enum):
    CUSTOMER = "customer"
    COMPETITOR = "competitor"
    REGULATOR = "regulator"
    INVESTOR = "investor"
    MARKET = "market"
    TRADER = "trader"
    MARKET_MAKER = "market_maker"
    MOLECULE = "molecule"
    ENZYME = "enzyme"
    DATA_STREAM = "data_stream"
    SUPPLY_CHAIN = "supply_chain"
    EMPLOYEE = "employee"


class SimulationCategory(str, Enum):
    STARTUP = "startup"
    PRICING = "pricing"
    POLICY = "policy"
    MARKETING = "marketing"
    PRODUCT = "product"
    FINANCE = "finance"
    BIOLOGY = "biology"
    TREND = "trend"
    CUSTOM = "custom"


class SimulationVariable(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    name: str
    label: str
    type: Literal["number", "percentage", "currency", "boolean", "select"] = "number"
    value: float
    min: Optional[float] = None
    max: Optional[float] = None
    unit: Optional[str] = None


# Map AI-generated agent type strings to valid AgentType enum values
_AGENT_TYPE_FALLBACK_MAP = {
    "momentum_trader": "trader", "value_investor": "investor", "algorithmic_trader": "trader",
    "quant_trader": "trader", "retail_trader": "trader", "institutional_investor": "investor",
    "portfolio_manager": "investor", "market_analyst": "market", "market_participant": "market",
    "market_force": "market", "macro_force": "market", "macro": "market",
    "consumer": "customer", "user": "customer", "buyer": "customer", "client": "customer",
    "end_user": "customer", "churn_agent": "customer", "acquisition_agent": "customer",
    "sales_agent": "customer", "regulatory": "regulator", "government": "regulator",
    "policy_maker": "regulator", "vc_investor": "investor", "angel_investor": "investor",
    "data": "data_stream", "signal": "data_stream", "trend_agent": "data_stream",
    "sensor": "data_stream", "feed": "data_stream", "ligand": "molecule",
    "protein": "molecule", "substrate": "molecule", "catalyst": "enzyme", "inhibitor": "molecule",
    "supplier": "supply_chain", "vendor": "supply_chain", "logistics": "supply_chain",
    "warehouse": "supply_chain", "procurement": "supply_chain",
    "worker": "employee", "staff": "employee", "hire": "employee", "team": "employee",
    "talent": "employee", "hr": "employee",
}


class AgentConfig(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    type: AgentType
    name: str
    count: int = Field(ge=1, le=100000)
    sensitivity: float = Field(ge=0, le=1, default=0.7)
    behavior_rules: List[str] = []

    # Persona-driven behavioral parameters (from generated AgentProfiles).
    # Defaults are NEUTRAL: at these values the engine's persona modulations
    # collapse to 1.0/no-op, preserving the legacy behavior for configs that
    # only set `sensitivity`.
    activity_level: float = Field(ge=0, le=1, default=0.5)
    influence_weight: float = Field(ge=0, le=1, default=0.5)
    sentiment_bias: float = Field(ge=-1, le=1, default=0.0)
    risk_tolerance: float = Field(ge=0, le=1, default=0.5)
    decision_style: Optional[str] = None

    @field_validator("type", mode="before")
    @classmethod
    def coerce_agent_type(cls, v):
        """Coerce AI-generated agent type strings to valid AgentType enum values."""
        if isinstance(v, AgentType):
            return v
        s = str(v).lower().strip().replace(" ", "_").replace("-", "_")
        # Direct match first
        try:
            return AgentType(s)
        except ValueError:
            pass
        # Lookup in fallback map
        if s in _AGENT_TYPE_FALLBACK_MAP:
            return AgentType(_AGENT_TYPE_FALLBACK_MAP[s])
        # Partial match
        for key, val in _AGENT_TYPE_FALLBACK_MAP.items():
            if key in s or s in key:
                return AgentType(val)
        # Try any AgentType whose value is a substring
        for at in AgentType:
            if at.value in s or s in at.value:
                return at
        # Default fallback
        return AgentType.MARKET


class SimulationConfig(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    category: SimulationCategory
    variables: List[SimulationVariable]
    agents: List[AgentConfig]
    num_runs: int = Field(ge=10, le=10000, default=1000)
    time_horizon: int = Field(ge=1, le=120, default=12)  # months
    template_id: Optional[str] = None
    uploaded_data: Optional[Dict[str, List[float]]] = None  # column name → values
    company_context: Optional[Dict[str, Any]] = None  # user's real scenario context for AI insights


class TimelinePoint(BaseModel):
    month: int
    revenue: float
    customers: int
    market_share: float
    competitor_strength: float


class RiskFactor(BaseModel):
    name: str
    severity: Literal["low", "medium", "high", "critical"]
    probability: float
    description: str
    mitigation: str


class DomainMetadata(BaseModel):
    primary_metric_label: str
    primary_metric_unit: str
    secondary_metric_label: str
    tertiary_metric_label: str
    time_unit: str


class SimulationResults(BaseModel):
    success_probability: float
    confidence_interval: tuple[float, float]
    avg_revenue: float
    avg_market_share: float
    avg_breakeven_month: float
    risk_factors: List[RiskFactor]
    key_insights: List[str]
    timeline_aggregated: List[Dict[str, Any]]
    outcome_distribution: List[Dict[str, Any]]
    competitor_reactions: List[str]
    success_explanation: str
    failure_explanation: str
    domain_metadata: Optional[DomainMetadata] = None

    # ── Reproducibility ──────────────────────────────────────────────
    # The base seed actually used for this run. Re-running with the same
    # base_seed (and identical config/overrides) reproduces the result.
    base_seed: Optional[int] = None

    # ── Confidence diagnostics ───────────────────────────────────────
    # Monte-Carlo standard error of the success probability (percentage
    # points): sqrt(p(1-p)/n) * 100, where p is the success fraction.
    monte_carlo_standard_error: Optional[float] = None
    # First-half vs second-half success-prob gap and whether the run is
    # considered converged (|gap| <= 2 * MCSE).
    convergence_delta: Optional[float] = None
    converged: Optional[bool] = None
    # Overall confidence in the forecast: "high" | "medium" | "low".
    forecast_confidence: Optional[str] = None


class SimulationCreate(BaseModel):
    config: SimulationConfig
    user_id: str


class SimulationResponse(BaseModel):
    id: str
    user_id: str
    name: str
    description: Optional[str]
    category: SimulationCategory
    config: SimulationConfig
    status: SimulationStatus
    results: Optional[SimulationResults] = None
    created_at: datetime
    updated_at: datetime
    run_count: int = 0

    # ── Scenario tree (branching simulations) ────────────────────────
    # A root simulation has parent_id == None and root_id == its own id.
    # Branches/copies set parent_id to their source and inherit root_id.
    parent_id: Optional[str] = None
    root_id: Optional[str] = None
    branch_label: Optional[str] = None


class BranchSimulationRequest(BaseModel):
    """Branch an existing simulation with variable overrides applied."""
    variable_overrides: Dict[str, float]
    label: Optional[str] = None
    num_runs: Optional[int] = Field(default=None, ge=10, le=10000)


class RunSimulationRequest(BaseModel):
    num_runs: Optional[int] = Field(default=None, ge=10, le=10000)
    variable_overrides: Optional[Dict[str, float]] = None


# --- Company Context for AI-powered simulation setup ---

class CompanyContext(BaseModel):
    """Rich context about the user's real scenario, used by Claude to generate simulation params."""
    category: SimulationCategory
    context: Dict[str, Any]  # flexible dict — shape depends on category


class AIGeneratedVariable(BaseModel):
    name: str
    label: str
    value: float
    min: float
    max: float
    unit: str
    reasoning: str


class AIGeneratedAgent(BaseModel):
    type: str
    label: str
    count: int
    sensitivity: float
    reasoning: str


class ContextAnalysisResponse(BaseModel):
    variables: List[AIGeneratedVariable]
    agents: List[AIGeneratedAgent]
    assumptions: List[str]
    success_criteria: str
    time_horizon: int
    num_runs: int


class PromptRequest(BaseModel):
    """Free-text prompt for AI-generated simulation."""
    prompt: str


class PromptAnalysisResponse(ContextAnalysisResponse):
    """Extends ContextAnalysisResponse with auto-detected category and name."""
    category: str
    name: str
    description: str
