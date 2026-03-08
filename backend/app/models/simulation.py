from pydantic import BaseModel, Field
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


class SimulationCategory(str, Enum):
    STARTUP = "startup"
    PRICING = "pricing"
    POLICY = "policy"
    MARKETING = "marketing"
    PRODUCT = "product"
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


class AgentConfig(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    type: AgentType
    name: str
    count: int = Field(ge=1, le=100000)
    sensitivity: float = Field(ge=0, le=1, default=0.7)
    behavior_rules: List[str] = []


class SimulationConfig(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    category: SimulationCategory
    variables: List[SimulationVariable]
    agents: List[AgentConfig]
    num_runs: int = Field(ge=100, le=10000, default=1000)
    time_horizon: int = Field(ge=1, le=120, default=12)  # months
    template_id: Optional[str] = None


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


class RunSimulationRequest(BaseModel):
    num_runs: Optional[int] = None
    variable_overrides: Optional[Dict[str, float]] = None
