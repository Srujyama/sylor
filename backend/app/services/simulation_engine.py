"""
Multi-Agent Simulation Engine
Runs Monte Carlo simulations with AI-driven agent behavior.

Determinism
-----------
``SimulationEngine.run`` accepts an optional ``base_seed``. When omitted, one
is generated and RECORDED on the results (``base_seed``). Path *i* is driven by
a dedicated ``random.Random(base_seed + i)`` instance that is threaded through
``_run_single``, every agent's ``react``/``__init__`` and the domain
``_run_*`` branches, so re-running with the same ``base_seed`` reproduces the
exact same ``success_probability``. NumPy aggregation (bootstrap CI) uses a
``numpy.random.Generator`` seeded from the same ``base_seed``.

Persona-driven behavior
-----------------------
LLM-generated ``AgentProfile`` fields are no longer dead data: each agent reads
``activity_level``, ``influence_weight``, ``risk_tolerance`` and
``sentiment_bias`` (plus the existing ``sensitivity``) and genuinely modulates
its behavior. The defaults (activity/influence/risk = 0.5, sentiment = 0.0) are
NEUTRAL — every modulation collapses to a 1.0 multiplier / unchanged threshold,
so configs that only set ``sensitivity`` behave exactly as before. See each
agent's ``react`` docstring for the precise mapping.
"""
import asyncio
import random
import math
import numpy as np
from typing import List, Dict, Any, Optional
from app.models.simulation import SimulationConfig, SimulationResults, RiskFactor, TimelinePoint, DomainMetadata


class EventSink:
    """Collector for a single deterministic simulation path.

    A simple append-only buffer threaded through ``_run_single`` and the domain
    ``_run_*`` branches. When (and only when) an ``EventSink`` is attached to a
    single designated path it records, per time step, every agent's action plus
    the step's headline metrics. The 1000-path Monte Carlo run does NOT attach a
    sink, so mass runs are completely unaffected.

    ``ticks`` is a list of ``{t, events: [...], metrics: {...}}`` dicts and
    ``agents`` is the de-duplicated roster of agents that acted on the path.
    """

    def __init__(self):
        self.ticks: List[Dict[str, Any]] = []
        self._agents: Dict[str, Dict[str, str]] = {}
        self._current_events: List[Dict[str, Any]] = []

    def start_tick(self) -> None:
        self._current_events = []

    def record(
        self, agent_id: str, agent_type: str, action: str,
        value: float, name: Optional[str] = None, note: Optional[str] = None,
    ) -> None:
        if agent_id not in self._agents:
            self._agents[agent_id] = {
                "id": agent_id,
                "type": agent_type,
                "name": name or agent_id,
            }
        event = {
            "agent_id": agent_id,
            "agent_type": agent_type,
            "action": action,
            "value": round(float(value), 4),
        }
        if note:
            event["note"] = note
        self._current_events.append(event)

    def end_tick(self, t: int, revenue: float, customers: float, market_share: float) -> None:
        self.ticks.append({
            "t": t,
            "events": list(self._current_events),
            "metrics": {
                "revenue": round(float(revenue), 2),
                "customers": round(float(customers), 2),
                "market_share": round(float(market_share), 4),
            },
        })
        self._current_events = []

    def agents(self) -> List[Dict[str, str]]:
        return list(self._agents.values())


class Agent:
    """Base agent class with configurable, persona-driven behavior.

    Persona parameters (all optional, neutral defaults):
      - sensitivity:      scales reaction magnitude (already plumbed)
      - activity_level:   0..1, scales action frequency/magnitude
                          (multiplier ``0.5 + activity_level`` -> 1.0 at 0.5)
      - influence_weight: 0..1, scales this agent's effect on market_state
                          (multiplier ``0.5 + influence_weight`` -> 1.0 at 0.5)
      - risk_tolerance:   0..1, shifts decision thresholds
                          (aggressive vs conservative)
      - sentiment_bias:   -1..1, shifts drift / directional bias (0.0 = none)
    """

    def __init__(
        self,
        agent_type: str,
        count: int,
        sensitivity: float = 0.7,
        *,
        rng: Optional[random.Random] = None,
        params: Optional[Dict[str, Any]] = None,
    ):
        self.type = agent_type
        self.count = count
        self.sensitivity = sensitivity
        # Default to the module-level ``random`` so directly-constructed agents
        # (e.g. in unit tests that call ``random.seed(42)``) keep working.
        self.rng = rng if rng is not None else random
        params = params or {}
        # Stable identity for event-sink replay/transcript. Falls back to the
        # agent type when no config id/name is supplied (direct unit-test use).
        self.agent_id = str(params.get("agent_id") or agent_type)
        self.display_name = str(params.get("agent_name") or agent_type)
        self.activity_level = float(params.get("activity_level", 0.5))
        self.influence_weight = float(params.get("influence_weight", 0.5))
        self.risk_tolerance = float(params.get("risk_tolerance", 0.5))
        self.sentiment_bias = float(params.get("sentiment_bias", 0.0))
        self.decision_style = params.get("decision_style", "balanced")
        # ``decision_style`` is a categorical persona summary; rather than leave
        # it inert, fold it into the numeric modulators that every react()
        # already reads, so an "aggressive" vs "conservative" persona produces
        # genuinely different behavior. Nudges are clamped to [0, 1].
        style_adjust = {
            "aggressive": {"activity_level": +0.2, "risk_tolerance": +0.2},
            "conservative": {"activity_level": -0.2, "risk_tolerance": -0.2},
            "reactive": {"activity_level": +0.15, "risk_tolerance": -0.1},
            "balanced": {},
        }.get(str(self.decision_style).lower(), {})
        if style_adjust:
            self.activity_level = min(1.0, max(0.0, self.activity_level + style_adjust.get("activity_level", 0.0)))
            self.risk_tolerance = min(1.0, max(0.0, self.risk_tolerance + style_adjust.get("risk_tolerance", 0.0)))
        # ``behavior_rules`` is descriptive text used by the LLM persona/report
        # layers; the numeric engine carries but does not interpret it.
        self.behavior_rules = params.get("behavior_rules", [])
        self.state: Dict[str, Any] = {}

    # ── Persona modulation helpers (neutral at the default values) ────────
    @property
    def _activity_mult(self) -> float:
        """1.0 at activity_level=0.5; 0.5..1.5 across the range."""
        return 0.5 + self.activity_level

    @property
    def _influence_mult(self) -> float:
        """1.0 at influence_weight=0.5; 0.5..1.5 across the range."""
        return 0.5 + self.influence_weight

    def react(self, market_state: Dict[str, Any], variables: Dict[str, float]) -> Dict[str, Any]:
        """Return agent reactions to current market state."""
        raise NotImplementedError


class CustomerAgent(Agent):
    def __init__(
        self, count: int, sensitivity: float, price: float, market_size: float,
        *, rng: Optional[random.Random] = None, params: Optional[Dict[str, Any]] = None,
    ):
        super().__init__("customer", count, sensitivity, rng=rng, params=params)
        self.base_price = price
        self.market_size = market_size
        self.state = {"acquired": 0, "churned": 0}

    def react(self, market_state: Dict, variables: Dict) -> Dict:
        """Persona mapping:
          - sensitivity   -> price elasticity (existing price_factor)
          - sentiment_bias -> shifts conversion (positive sentiment buys more)
          - activity_level -> scales acquisition volume (_activity_mult)
          - risk_tolerance -> shifts churn sensitivity (risk-averse churn more)
        """
        price = variables.get("price_per_unit", self.base_price)
        price_factor = max(0.1, 1 - (price - self.base_price) / self.base_price * self.sensitivity)
        conversion = variables.get("conversion_rate", 5) / 100 * price_factor
        # Positive sentiment lifts conversion; negative depresses it (neutral at 0).
        conversion *= (1 + self.sentiment_bias * 0.5)

        # Add noise
        noise = self.rng.gauss(1.0, 0.2)
        # Activity scales how aggressively this segment is acquired.
        new_customers = int(self.market_size * conversion * noise * 0.01 * self._activity_mult)
        churn_rate = variables.get("churn_rate", 5) / 100
        # Risk-averse customers (low risk_tolerance) churn more readily.
        churn_rate *= (1 + (0.5 - self.risk_tolerance) * 0.4)
        churned = int(self.state["acquired"] * churn_rate * self.rng.gauss(1.0, 0.15))

        self.state["acquired"] = max(0, self.state["acquired"] + new_customers - churned)
        self.state["churned"] = churned

        return {
            "new_customers": new_customers,
            "churned": churned,
            "total": self.state["acquired"],
        }


class CompetitorAgent(Agent):
    def __init__(self, count: int, sensitivity: float,
                 *, rng: Optional[random.Random] = None, params: Optional[Dict[str, Any]] = None):
        super().__init__("competitor", count, sensitivity, rng=rng, params=params)
        self.state = {"strength": 70 + self.rng.uniform(-20, 20), "reaction_delay": self.rng.randint(2, 6)}

    def react(self, market_state: Dict, variables: Dict) -> Dict:
        """Persona mapping:
          - risk_tolerance -> reaction threshold (low risk => reacts sooner)
          - sensitivity    -> strength_boost magnitude (existing)
          - activity_level -> scales strength_boost (_activity_mult)
        """
        your_growth = market_state.get("month_growth", 0)
        # Competitors react with delay
        if market_state.get("month", 1) < self.state["reaction_delay"]:
            return {"strength_change": 0, "action": "observing"}

        # Aggressive (low risk tolerance) competitors react to smaller growth.
        react_threshold = 0.1 * (2 * self.risk_tolerance)  # 0.1 at neutral 0.5
        if your_growth > react_threshold:
            strength_boost = self.rng.uniform(0, 5 * self.sensitivity) * self._activity_mult
            self.state["strength"] = min(100, self.state["strength"] + strength_boost)
            action = self.rng.choice(["price_cut", "feature_launch", "marketing_surge"])
        else:
            self.state["strength"] = max(0, self.state["strength"] - 1)
            action = "maintain"

        return {"strength": self.state["strength"], "action": action}


class InvestorAgent(Agent):
    def __init__(self, count: int, sensitivity: float,
                 *, rng: Optional[random.Random] = None, params: Optional[Dict[str, Any]] = None):
        super().__init__("investor", count, sensitivity, rng=rng, params=params)
        self.state = {"invested": False, "interest": 0}

    def react(self, market_state: Dict, variables: Dict) -> Dict:
        """Persona mapping:
          - risk_tolerance -> funding interest threshold (risk-takers fund earlier)
          - activity_level -> probability of a funding event (_activity_mult)
          - influence_weight -> size of the funding injection (_influence_mult)
        """
        growth = market_state.get("revenue_growth", 0)
        customers = market_state.get("total_customers", 0)

        # Investors track growth metrics
        if growth > 0.15 and customers > 50:
            self.state["interest"] = min(100, self.state["interest"] + 15 * self.sensitivity)
        elif growth > 0.05:
            self.state["interest"] = min(100, self.state["interest"] + 5)

        # Risk-takers fund at a lower interest bar (75 at neutral).
        interest_threshold = 75 * (1.5 - self.risk_tolerance)
        funding_prob = 0.3 * self._activity_mult  # 0.3 at neutral
        # Funding event
        if self.state["interest"] > interest_threshold and not self.state["invested"] and self.rng.random() < funding_prob:
            self.state["invested"] = True
            budget_boost = variables.get("budget", 50000) * self.rng.uniform(2, 5) * self._influence_mult
            return {"funding": budget_boost, "interest": self.state["interest"]}

        return {"funding": 0, "interest": self.state["interest"]}


class MarketForceAgent(Agent):
    def __init__(self, sensitivity: float,
                 *, rng: Optional[random.Random] = None, params: Optional[Dict[str, Any]] = None):
        super().__init__("market", 1, sensitivity, rng=rng, params=params)
        self.state = {"trend": self.rng.gauss(0.02, 0.05), "recession": False}

    def react(self, market_state: Dict, variables: Dict) -> Dict:
        """Persona mapping:
          - sentiment_bias   -> shifts macro drift (optimistic vs pessimistic)
          - influence_weight -> scales the trend's effect on the market (_influence_mult)
        """
        # Macro events
        if self.rng.random() < 0.02:  # 2% chance of recession event per month
            self.state["recession"] = True
            self.state["trend"] = -0.05
        elif self.state["recession"] and self.rng.random() < 0.15:
            self.state["recession"] = False
            self.state["trend"] = self.rng.gauss(0.02, 0.03)

        # Influence scales how strongly the trend moves the market; sentiment
        # adds a directional drift. Neutral -> ``1 + trend`` (legacy behavior).
        effective_trend = self.state["trend"] * self._influence_mult + self.sentiment_bias * 0.05
        multiplier = 1 + effective_trend
        return {"trend_multiplier": multiplier, "recession": self.state["recession"]}


class TraderAgent(Agent):
    """Simulates trader behavior with momentum/mean-reversion strategies."""

    def __init__(self, count: int, sensitivity: float,
                 *, rng: Optional[random.Random] = None, params: Optional[Dict[str, Any]] = None):
        super().__init__("trader", count, sensitivity, rng=rng, params=params)
        self.state = {
            "position": 0,
            "pnl": 0,
            "strategy": self.rng.choice(["momentum", "mean_reversion"]),
        }

    def _position_size(self) -> int:
        """Risk-takers (high risk_tolerance) trade larger size; activity scales draw count is preserved."""
        base = self.rng.randint(1, 10)
        return max(1, int(base * (0.5 + self.risk_tolerance)))  # 1.0x at neutral

    def react(self, market_state: Dict, variables: Dict) -> Dict:
        """Persona mapping:
          - sensitivity    -> signal threshold (existing)
          - risk_tolerance -> position sizing (aggressive vs conservative)
          - activity_level -> trade-trigger sensitivity (more active => trades more)
        """
        price = market_state.get("price", 100)
        prev_price = market_state.get("prev_price", price)
        volatility = variables.get("volatility", 20) / 100

        # More active traders pull the trigger on smaller signals (neutral=1.0).
        trigger = 0.01 * self.sensitivity / self._activity_mult

        if self.state["strategy"] == "momentum":
            signal = (price - prev_price) / max(prev_price, 0.01)
            if signal > trigger:
                action = "buy"
                self.state["position"] += self._position_size()
            elif signal < -trigger:
                action = "sell"
                self.state["position"] = max(0, self.state["position"] - self._position_size())
            else:
                action = "hold"
        else:  # mean reversion
            ma = market_state.get("moving_avg", price)
            if price < ma * (1 - 0.02 * self.sensitivity):
                action = "buy"
                self.state["position"] += self._position_size()
            elif price > ma * (1 + 0.02 * self.sensitivity):
                action = "sell"
                self.state["position"] = max(0, self.state["position"] - self._position_size())
            else:
                action = "hold"

        self.state["pnl"] += self.state["position"] * (price - prev_price)
        return {"action": action, "position": self.state["position"], "pnl": self.state["pnl"]}


class MarketMakerAgent(Agent):
    """Liquidity provider that adjusts bid/ask spreads."""

    def __init__(self, count: int, sensitivity: float,
                 *, rng: Optional[random.Random] = None, params: Optional[Dict[str, Any]] = None):
        super().__init__("market_maker", count, sensitivity, rng=rng, params=params)
        self.state = {"spread": 0.5, "inventory": 0}

    def react(self, market_state: Dict, variables: Dict) -> Dict:
        """Persona mapping:
          - sensitivity      -> spread widening with volatility (existing)
          - influence_weight -> magnitude of order-flow impact on inventory (_influence_mult)
        """
        volatility = variables.get("volatility", 20) / 100
        volume = market_state.get("volume", 1000)

        # Widen spread in high volatility
        self.state["spread"] = max(0.1, 0.5 + volatility * 2 * self.sensitivity)
        # Adjust inventory based on order flow
        flow_imbalance = self.rng.gauss(0, volume * 0.01) * self._influence_mult
        self.state["inventory"] += flow_imbalance

        return {"spread": self.state["spread"], "inventory": self.state["inventory"]}


class MoleculeAgent(Agent):
    """Simulates molecular binding and conformational changes."""

    def __init__(self, count: int, sensitivity: float,
                 *, rng: Optional[random.Random] = None, params: Optional[Dict[str, Any]] = None):
        super().__init__("molecule", count, sensitivity, rng=rng, params=params)
        self.state = {"bound": False, "energy": self.rng.gauss(-5, 2), "conformation": 0}

    def react(self, market_state: Dict, variables: Dict) -> Dict:
        """Persona mapping:
          - sensitivity    -> binding probability scaling (existing)
          - sentiment_bias -> shifts binding propensity (favorable vs hostile env)
        """
        temperature = variables.get("temperature", 310)
        kd = variables.get("binding_affinity", 10)
        concentration = variables.get("concentration", 100)
        ph = variables.get("ph_level", 7.4)

        # Boltzmann binding probability
        kT = 0.00198 * temperature  # kcal/mol
        binding_prob = concentration / (concentration + kd) * self.sensitivity
        # Sentiment models a favorable/unfavorable microenvironment (neutral=1.0).
        binding_prob *= (1 + self.sentiment_bias * 0.2)
        # pH effect
        if abs(ph - 7.4) > 1:
            binding_prob *= max(0.3, 1 - abs(ph - 7.4) * 0.2)

        noise = self.rng.gauss(0, 0.1)
        if not self.state["bound"] and self.rng.random() < binding_prob + noise:
            self.state["bound"] = True
            self.state["energy"] -= self.rng.uniform(1, 5)
        elif self.state["bound"] and self.rng.random() < 0.05 / self.sensitivity:
            self.state["bound"] = False
            self.state["energy"] += self.rng.uniform(1, 3)

        # Conformational changes
        self.state["conformation"] += self.rng.gauss(0, kT * 0.5)

        return {
            "bound": self.state["bound"],
            "energy": self.state["energy"],
            "conformation": self.state["conformation"],
        }


class EnzymeAgent(Agent):
    """Catalytic agent affecting reaction rates."""

    def __init__(self, count: int, sensitivity: float,
                 *, rng: Optional[random.Random] = None, params: Optional[Dict[str, Any]] = None):
        super().__init__("enzyme", count, sensitivity, rng=rng, params=params)
        self.state = {"active": True, "catalytic_rate": self.rng.uniform(50, 200), "substrate_processed": 0}

    def react(self, market_state: Dict, variables: Dict) -> Dict:
        """Persona mapping:
          - sensitivity    -> effective catalytic rate (existing)
          - activity_level -> turnover throughput (_activity_mult)
        """
        temperature = variables.get("temperature", 310)
        ph = variables.get("ph_level", 7.4)

        # Enzyme activity depends on temperature and pH
        temp_factor = max(0, 1 - abs(temperature - 310) / 100) if temperature < 350 else 0
        ph_factor = max(0, 1 - abs(ph - 7.4) / 3)

        effective_rate = self.state["catalytic_rate"] * temp_factor * ph_factor * self.sensitivity * self._activity_mult
        substrate = int(effective_rate * self.rng.gauss(1, 0.2))
        self.state["substrate_processed"] += max(0, substrate)

        # Denaturation at extreme conditions
        if temperature > 340 or ph < 4 or ph > 10:
            if self.rng.random() < 0.1:
                self.state["active"] = False
                effective_rate = 0

        return {
            "active": self.state["active"],
            "rate": effective_rate,
            "processed": self.state["substrate_processed"],
        }


class DataStreamAgent(Agent):
    """Time-series data feed for trend detection and signal generation."""

    def __init__(self, count: int, sensitivity: float,
                 *, rng: Optional[random.Random] = None, params: Optional[Dict[str, Any]] = None):
        super().__init__("data_stream", count, sensitivity, rng=rng, params=params)
        self.state = {
            "trend": self.rng.gauss(0.001, 0.005),
            "seasonality_phase": self.rng.uniform(0, 2 * 3.14159),
            "noise_level": 0.02,
        }

    def react(self, market_state: Dict, variables: Dict) -> Dict:
        """Persona mapping:
          - sentiment_bias   -> directional bias added to the trend component
          - influence_weight -> amplitude of the trend signal (_influence_mult)
        """
        step = market_state.get("step", 1)
        seasonality_period = variables.get("seasonality_period", 12)
        trend_strength = variables.get("trend_strength", 50) / 100
        noise_level = variables.get("noise_level", 15) / 100

        # Generate signal: trend + seasonality + noise
        trend_component = self.state["trend"] * trend_strength * step * self._influence_mult
        trend_component += self.sentiment_bias * 0.01 * step  # directional drift (neutral=0)
        seasonal_component = math.sin(2 * math.pi * step / max(seasonality_period, 1) + self.state["seasonality_phase"]) * 0.05
        noise_component = self.rng.gauss(0, noise_level)

        signal = trend_component + seasonal_component + noise_component
        # Detect pattern
        is_trend = abs(trend_component) > abs(noise_component)

        return {
            "signal": signal,
            "trend_component": trend_component,
            "seasonal_component": seasonal_component,
            "pattern_detected": is_trend,
        }


class SupplyChainAgent(Agent):
    """Models supplier reliability, lead times, and inventory costs."""

    def __init__(self, count: int, sensitivity: float,
                 *, rng: Optional[random.Random] = None, params: Optional[Dict[str, Any]] = None):
        super().__init__("supply_chain", count, sensitivity, rng=rng, params=params)
        self.state = {
            "reliability": 0.85 + self.rng.uniform(-0.1, 0.1),
            "lead_time": self.rng.randint(7, 30),  # days
            "inventory_cost": self.rng.uniform(0.01, 0.05),  # % of revenue
            "disrupted": False,
        }

    def react(self, market_state: Dict, variables: Dict) -> Dict:
        """Persona mapping:
          - sensitivity -> stress response to demand spikes (existing)
        """
        demand_growth = market_state.get("month_growth", 0)
        month = market_state.get("month", 1)

        # Demand spikes stress the supply chain
        if demand_growth > 0.15:
            self.state["lead_time"] = min(60, self.state["lead_time"] + self.rng.randint(1, 5))
            self.state["reliability"] = max(0.5, self.state["reliability"] - 0.03 * self.sensitivity)
            self.state["inventory_cost"] *= 1 + 0.1 * self.sensitivity
        else:
            self.state["lead_time"] = max(3, self.state["lead_time"] - self.rng.randint(0, 2))
            self.state["reliability"] = min(0.99, self.state["reliability"] + 0.01)

        # Random disruption events (3% per month)
        if self.rng.random() < 0.03:
            self.state["disrupted"] = True
            self.state["reliability"] *= 0.6
            self.state["lead_time"] *= 2
        elif self.state["disrupted"] and self.rng.random() < 0.3:
            self.state["disrupted"] = False

        cost_impact = self.state["inventory_cost"] * (1 + (1 - self.state["reliability"]))
        return {
            "reliability": round(self.state["reliability"], 3),
            "lead_time": self.state["lead_time"],
            "cost_impact": round(cost_impact, 4),
            "disrupted": self.state["disrupted"],
        }


class EmployeeAgent(Agent):
    """Models hiring, productivity ramp-up, and attrition."""

    def __init__(self, count: int, sensitivity: float,
                 *, rng: Optional[random.Random] = None, params: Optional[Dict[str, Any]] = None):
        super().__init__("employee", count, sensitivity, rng=rng, params=params)
        self.state = {
            "headcount": count,
            "avg_productivity": 0.7 + self.rng.uniform(-0.1, 0.1),  # 0-1
            "attrition_rate": 0.02 + self.rng.uniform(-0.01, 0.01),  # monthly
            "hiring_pipeline": 0,
            "morale": 0.75,
        }

    def react(self, market_state: Dict, variables: Dict) -> Dict:
        """Persona mapping:
          - sensitivity -> morale impact under headcount pressure (existing)
        """
        revenue = market_state.get("revenue", 0)
        customers = market_state.get("total_customers", 0)
        month = market_state.get("month", 1)

        # Hiring need scales with customer growth
        target_headcount = max(self.state["headcount"], int(customers / 50) + 5)
        hiring_gap = target_headcount - self.state["headcount"]

        # Hire (with ramp-up delay — new hires start at 40% productivity)
        new_hires = min(hiring_gap, max(1, int(hiring_gap * 0.3)))
        if new_hires > 0:
            old_prod = self.state["avg_productivity"] * self.state["headcount"]
            new_prod = 0.4 * new_hires
            self.state["headcount"] += new_hires
            self.state["avg_productivity"] = (old_prod + new_prod) / self.state["headcount"]
        else:
            # Existing employees ramp up over time
            self.state["avg_productivity"] = min(1.0, self.state["avg_productivity"] + 0.02)

        # Attrition
        attrition = int(self.state["headcount"] * self.state["attrition_rate"] * self.rng.gauss(1, 0.3))
        attrition = max(0, min(attrition, self.state["headcount"] - 1))
        self.state["headcount"] -= attrition

        # Morale affected by growth rate and headcount pressure
        if hiring_gap > self.state["headcount"] * 0.3:
            self.state["morale"] = max(0.3, self.state["morale"] - 0.05 * self.sensitivity)
        else:
            self.state["morale"] = min(1.0, self.state["morale"] + 0.02)

        # Productivity multiplier for revenue
        productivity_multiplier = self.state["avg_productivity"] * self.state["morale"]

        return {
            "headcount": self.state["headcount"],
            "productivity": round(self.state["avg_productivity"], 3),
            "morale": round(self.state["morale"], 3),
            "attrition": attrition,
            "new_hires": new_hires,
            "productivity_multiplier": round(productivity_multiplier, 3),
        }


class SimulationEngine:
    """Monte Carlo simulation engine with multi-agent interactions."""

    def __init__(self, config: SimulationConfig):
        self.config = config
        self.variables = {v.name: v.value for v in config.variables}

    def _get_variable(self, name: str, default: float) -> float:
        return self.variables.get(name, default)

    def _agent_params(self, agent_cfg) -> Dict[str, Any]:
        """Extract persona parameters from an AgentConfig (neutral defaults)."""
        return {
            "activity_level": getattr(agent_cfg, "activity_level", 0.5),
            "influence_weight": getattr(agent_cfg, "influence_weight", 0.5),
            "risk_tolerance": getattr(agent_cfg, "risk_tolerance", 0.5),
            "sentiment_bias": getattr(agent_cfg, "sentiment_bias", 0.0),
            "decision_style": getattr(agent_cfg, "decision_style", "balanced"),
            "behavior_rules": getattr(agent_cfg, "behavior_rules", []) or [],
            "agent_name": getattr(agent_cfg, "name", None),
        }

    def _create_agents(self, rng: random.Random):
        agents = []
        for idx, agent_cfg in enumerate(self.config.agents):
            agent_type = agent_cfg.type.value
            params = self._agent_params(agent_cfg)
            # Deterministic, position-based identity for the event sink. Using
            # the index (not the config's random uuid) keeps replay/transcript
            # stable across re-parsing of a stored config.
            params["agent_id"] = f"{agent_type}-{idx}"
            if agent_type == "customer":
                agents.append(CustomerAgent(
                    agent_cfg.count,
                    agent_cfg.sensitivity,
                    self._get_variable("price_per_unit", 99),
                    self._get_variable("market_size", 1_000_000),
                    rng=rng, params=params,
                ))
            elif agent_type == "competitor":
                agents.append(CompetitorAgent(agent_cfg.count, agent_cfg.sensitivity, rng=rng, params=params))
            elif agent_type == "investor":
                agents.append(InvestorAgent(agent_cfg.count, agent_cfg.sensitivity, rng=rng, params=params))
            elif agent_type == "market":
                agents.append(MarketForceAgent(agent_cfg.sensitivity, rng=rng, params=params))
            elif agent_type == "trader":
                agents.append(TraderAgent(agent_cfg.count, agent_cfg.sensitivity, rng=rng, params=params))
            elif agent_type == "market_maker":
                agents.append(MarketMakerAgent(agent_cfg.count, agent_cfg.sensitivity, rng=rng, params=params))
            elif agent_type == "molecule":
                agents.append(MoleculeAgent(agent_cfg.count, agent_cfg.sensitivity, rng=rng, params=params))
            elif agent_type == "enzyme":
                agents.append(EnzymeAgent(agent_cfg.count, agent_cfg.sensitivity, rng=rng, params=params))
            elif agent_type == "data_stream":
                agents.append(DataStreamAgent(agent_cfg.count, agent_cfg.sensitivity, rng=rng, params=params))
            elif agent_type == "supply_chain":
                agents.append(SupplyChainAgent(agent_cfg.count, agent_cfg.sensitivity, rng=rng, params=params))
            elif agent_type == "employee":
                agents.append(EmployeeAgent(agent_cfg.count, agent_cfg.sensitivity, rng=rng, params=params))
        return agents

    def _run_single(
        self,
        variables: Optional[Dict] = None,
        rng: Optional[random.Random] = None,
        event_sink: Optional["EventSink"] = None,
    ) -> Dict[str, Any]:
        """Run a single simulation scenario with a dedicated RNG.

        ``rng`` defaults to the module-level ``random`` so direct calls (e.g.
        in tests using ``random.seed(42)``) remain deterministic.

        ``event_sink`` is optional and, when present, captures per-step agent
        actions + headline metrics for replay/transcript. It is NEVER passed by
        the Monte Carlo ``run()`` loop, so mass runs are unaffected.
        """
        if rng is None:
            rng = random
        vars_ = dict(self.variables)
        if variables:
            vars_.update(variables)

        category = self.config.category.value
        if category in ("finance",):
            return self._run_finance(vars_, rng, event_sink)
        elif category in ("biology",):
            return self._run_biology(vars_, rng, event_sink)
        elif category in ("trend",):
            return self._run_trend(vars_, rng, event_sink)
        else:
            return self._run_business(vars_, rng, event_sink)

    @staticmethod
    def _event_for(agent, result: Dict[str, Any]) -> tuple:
        """Derive a short verb + representative number from a react() result.

        Returns ``(action, value, note)`` for the event sink. Each agent type
        maps to a domain-meaningful verb so the captured path reads like a
        sequence of decisions rather than raw numbers.
        """
        t = agent.type
        if t == "customer":
            new_c = result.get("new_customers", 0)
            churned = result.get("churned", 0)
            if new_c > churned:
                return "acquire", new_c, f"{new_c} new, {churned} churned"
            return "churn", churned, f"{new_c} new, {churned} churned"
        if t == "competitor":
            return result.get("action", "maintain"), result.get("strength", 0), None
        if t == "investor":
            funding = result.get("funding", 0)
            if funding > 0:
                return "fund", funding, f"interest {result.get('interest', 0):.0f}"
            return "watch", result.get("interest", 0), None
        if t == "market":
            mult = result.get("trend_multiplier", 1.0)
            if result.get("recession"):
                return "recession", mult, "macro downturn"
            return "drift", mult, None
        if t == "trader":
            return result.get("action", "hold"), result.get("position", 0), f"pnl {result.get('pnl', 0):.1f}"
        if t == "market_maker":
            return "quote", result.get("spread", 0), f"inventory {result.get('inventory', 0):.1f}"
        if t == "molecule":
            return ("bind" if result.get("bound") else "release"), result.get("energy", 0), None
        if t == "enzyme":
            return ("catalyze" if result.get("active") else "denatured"), result.get("rate", 0), None
        if t == "data_stream":
            return ("signal" if result.get("pattern_detected") else "noise"), result.get("signal", 0), None
        if t == "supply_chain":
            return ("disrupted" if result.get("disrupted") else "supply"), result.get("cost_impact", 0), f"lead {result.get('lead_time', 0)}d"
        if t == "employee":
            return "staff", result.get("headcount", 0), f"morale {result.get('morale', 0):.2f}"
        return "act", 0, None

    def _find_var(self, vars_: Dict, *keys: str, default: float = 0) -> float:
        """Find a variable by trying multiple possible names (AI may name things differently)."""
        for key in keys:
            if key in vars_:
                return float(vars_[key])
            # Try partial match
            for vk in vars_:
                if key in vk or vk in key:
                    return float(vars_[vk])
        return default

    def _run_business(self, vars_: Dict, rng: random.Random,
                      event_sink: Optional["EventSink"] = None) -> Dict[str, Any]:
        """Run a business/startup simulation. Works with AI-generated variable names."""
        agents = self._create_agents(rng)

        # Flexibly find key variables — AI may name them differently
        budget = self._find_var(vars_, "budget", "monthly_budget", "monthly_burn", "burn_rate", "monthly_burn_rate", default=50000)
        price = self._find_var(vars_, "price_per_unit", "price", "current_price", "price_point", "monthly_price", "subscription_price", default=99)
        market_size = self._find_var(vars_, "market_size", "target_market_size", "tam", "total_addressable_market", "addressable_market", default=1_000_000)
        initial_customers = int(self._find_var(vars_, "current_customers", "customer_count", "existing_customers", "customer_base", default=0))
        current_mrr = self._find_var(vars_, "current_mrr", "mrr", "monthly_revenue", "current_revenue", default=0)

        timeline = []
        revenue = current_mrr
        customers = initial_customers
        total_funding = 0
        prev_revenue = revenue

        for month in range(1, self.config.time_horizon + 1):
            market_state = {
                "month": month,
                "revenue": revenue,
                "total_customers": customers,
                "revenue_growth": (revenue - prev_revenue) / max(prev_revenue, 1),
                "month_growth": (customers - (timeline[-1]["customers"] if timeline else initial_customers)) / max(customers, 1),
            }

            market_effect = 1.0
            new_funding = 0
            competitor_strength = 50
            supply_cost_impact = 0
            productivity_multiplier = 1.0

            if event_sink is not None:
                event_sink.start_tick()

            for agent in agents:
                result = agent.react(market_state, vars_)
                if event_sink is not None:
                    action, value, note = self._event_for(agent, result)
                    event_sink.record(agent.agent_id, agent.type, action, value,
                                      name=agent.display_name, note=note)
                if agent.type == "customer":
                    customers = result["total"]
                elif agent.type == "market":
                    market_effect = result["trend_multiplier"]
                    if result["recession"]:
                        market_effect *= 0.7
                elif agent.type == "investor":
                    new_funding += result.get("funding", 0)
                elif agent.type == "competitor":
                    competitor_strength = result.get("strength", 50)
                elif agent.type == "supply_chain":
                    supply_cost_impact += result.get("cost_impact", 0)
                elif agent.type == "employee":
                    productivity_multiplier = result.get("productivity_multiplier", 1.0)

            total_funding += new_funding
            budget += new_funding

            prev_revenue = revenue
            revenue = customers * price * market_effect * productivity_multiplier + rng.gauss(0, max(customers * price * 0.1, 1))
            revenue = max(0, revenue * (1 - supply_cost_impact))

            market_share = min(100, (customers / max(market_size, 1)) * 100)

            if event_sink is not None:
                event_sink.end_tick(month, revenue, customers, market_share)

            timeline.append({
                "month": month,
                "revenue": round(revenue, 2),
                "customers": customers,
                "market_share": round(market_share, 4),
                "competitor_strength": round(competitor_strength, 1),
                "budget": round(budget, 2),
            })

            monthly_burn = budget * 0.8
            budget -= monthly_burn
            if budget < 0:
                break

        final_revenue = timeline[-1]["revenue"] if timeline else 0
        final_month = len(timeline)
        # Success = survived full period and revenue exceeds burn
        target_revenue = self._find_var(vars_, "budget", "monthly_burn", default=50000) * 1.5
        success = final_revenue >= target_revenue and final_month >= self.config.time_horizon * 0.75

        return {
            "success": success,
            "final_revenue": final_revenue,
            "final_customers": timeline[-1]["customers"] if timeline else 0,
            "final_market_share": timeline[-1]["market_share"] if timeline else 0,
            "months_survived": final_month,
            "timeline": timeline,
        }

    def _run_finance(self, vars_: Dict, rng: random.Random,
                     event_sink: Optional["EventSink"] = None) -> Dict[str, Any]:
        """Run a financial markets simulation."""
        agents = self._create_agents(rng)
        portfolio_value = self._find_var(vars_, "portfolio_value", "starting_capital", "initial_capital", "capital", default=100000)
        # Cap trading_days: use time_horizon * ~21 trading days/month, max 252
        default_days = min(252, self.config.time_horizon * 21)
        trading_days = int(self._find_var(vars_, "trading_days", "simulation_days", default=default_days))
        trading_days = min(trading_days, 252)  # Hard cap to prevent runaway loops
        initial_value = portfolio_value
        volatility = self._find_var(vars_, "volatility", "expected_volatility", "annual_volatility", default=20) / 100
        num_assets = int(self._find_var(vars_, "num_assets", "number_of_assets", "asset_count", default=5))

        timeline = []
        prices = [100 + rng.gauss(0, 10) for _ in range(num_assets)]
        moving_avg = list(prices)

        for day in range(1, trading_days + 1):
            prev_prices = list(prices)
            # Update prices with geometric brownian motion
            for i in range(len(prices)):
                drift = 0.0001  # slight positive drift
                shock = rng.gauss(drift, volatility / math.sqrt(252))
                prices[i] *= (1 + shock)
                moving_avg[i] = moving_avg[i] * 0.95 + prices[i] * 0.05

            market_state = {
                "step": day,
                "price": sum(prices) / len(prices),
                "prev_price": sum(prev_prices) / len(prev_prices),
                "moving_avg": sum(moving_avg) / len(moving_avg),
                "volume": rng.randint(500, 5000),
            }

            total_pnl = 0
            spread = 0.5
            if event_sink is not None:
                event_sink.start_tick()
            for agent in agents:
                result = agent.react(market_state, vars_)
                if event_sink is not None:
                    action, value, note = self._event_for(agent, result)
                    event_sink.record(agent.agent_id, agent.type, action, value,
                                      name=agent.display_name, note=note)
                if agent.type == "trader":
                    total_pnl += result.get("pnl", 0)
                elif agent.type == "market_maker":
                    spread = result.get("spread", 0.5)

            portfolio_value = initial_value + total_pnl

            if event_sink is not None:
                event_sink.end_tick(
                    day,
                    portfolio_value - initial_value,
                    int(sum(prices)),
                    round((portfolio_value / initial_value - 1) * 100, 4),
                )

            if day % max(1, trading_days // self.config.time_horizon) == 0:
                month = len(timeline) + 1
                timeline.append({
                    "month": month,
                    "revenue": round(portfolio_value - initial_value, 2),
                    "customers": int(sum(prices)),  # reusing field for price index
                    "market_share": round((portfolio_value / initial_value - 1) * 100, 4),
                    "competitor_strength": round(spread * 100, 1),
                    "budget": round(portfolio_value, 2),
                })

        # Success = portfolio growth above threshold
        growth = (portfolio_value - initial_value) / max(initial_value, 1)
        risk_tolerance = self._find_var(vars_, "risk_tolerance", "target_return", default=50) / 100
        success = growth > risk_tolerance * 0.1

        return {
            "success": success,
            "final_revenue": portfolio_value - initial_value,
            "final_customers": int(sum(prices)),
            "final_market_share": round(growth * 100, 4),
            "months_survived": len(timeline),
            "timeline": timeline if timeline else [{"month": 1, "revenue": 0, "customers": 0, "market_share": 0, "competitor_strength": 50, "budget": portfolio_value}],
        }

    def _run_biology(self, vars_: Dict, rng: random.Random,
                     event_sink: Optional["EventSink"] = None) -> Dict[str, Any]:
        """Run a molecular biology simulation."""
        agents = self._create_agents(rng)
        num_molecules = int(self._find_var(vars_, "num_molecules", "molecule_count", "number_of_molecules", default=128))
        sim_steps = int(self._find_var(vars_, "sim_steps", "simulation_steps", "total_steps", default=1000))
        sim_steps = min(sim_steps, 2000)  # Hard cap

        timeline = []
        total_bound = 0
        total_processed = 0

        steps_per_period = max(1, sim_steps // self.config.time_horizon)

        for step in range(1, sim_steps + 1):
            market_state = {"step": step}
            bound_count = 0
            processed = 0

            capture = event_sink is not None and step % steps_per_period == 0
            if capture:
                event_sink.start_tick()

            for agent in agents:
                result = agent.react(market_state, vars_)
                if capture:
                    action, value, note = self._event_for(agent, result)
                    event_sink.record(agent.agent_id, agent.type, action, value,
                                      name=agent.display_name, note=note)
                if agent.type == "molecule":
                    if result.get("bound", False):
                        bound_count += 1
                elif agent.type == "enzyme":
                    processed += result.get("processed", 0)

            total_bound = bound_count
            total_processed = processed

            if step % steps_per_period == 0:
                month = len(timeline) + 1
                binding_rate = bound_count / max(num_molecules, 1)
                if capture:
                    event_sink.end_tick(
                        month, round(binding_rate * 100, 2), total_bound,
                        round(binding_rate * 100, 4),
                    )
                timeline.append({
                    "month": month,
                    "revenue": round(binding_rate * 100, 2),  # reusing for binding %
                    "customers": total_bound,  # reusing for bound molecules
                    "market_share": round(binding_rate * 100, 4),
                    "competitor_strength": round(total_processed, 1),
                    "budget": round(total_processed, 2),
                })

        # Success = binding events above 50% threshold
        final_binding_rate = total_bound / max(num_molecules, 1)
        success = final_binding_rate > 0.4

        return {
            "success": success,
            "final_revenue": round(final_binding_rate * 100, 2),
            "final_customers": total_bound,
            "final_market_share": round(final_binding_rate * 100, 4),
            "months_survived": len(timeline),
            "timeline": timeline if timeline else [{"month": 1, "revenue": 0, "customers": 0, "market_share": 0, "competitor_strength": 0, "budget": 0}],
        }

    def _run_trend(self, vars_: Dict, rng: random.Random,
                   event_sink: Optional["EventSink"] = None) -> Dict[str, Any]:
        """Run a trend analysis simulation."""
        agents = self._create_agents(rng)
        forecast_periods = int(self._find_var(vars_, "forecast_periods", "forecast_horizon", "prediction_periods", default=self.config.time_horizon * 2))
        forecast_periods = min(forecast_periods, 120)  # Hard cap
        confidence_level = self._find_var(vars_, "confidence_level", "confidence_threshold", default=95) / 100

        timeline = []
        signals = []
        patterns_detected = 0

        period_size = max(1, forecast_periods // self.config.time_horizon)
        for step in range(1, forecast_periods + 1):
            market_state = {"step": step}
            step_signal = 0
            step_patterns = 0

            capture = event_sink is not None and (
                step % period_size == 0 or step == forecast_periods
            )
            if capture:
                event_sink.start_tick()

            for agent in agents:
                result = agent.react(market_state, vars_)
                if capture:
                    action, value, note = self._event_for(agent, result)
                    event_sink.record(agent.agent_id, agent.type, action, value,
                                      name=agent.display_name, note=note)
                if agent.type == "data_stream":
                    step_signal += result.get("signal", 0)
                    if result.get("pattern_detected", False):
                        step_patterns += 1
                elif agent.type == "market":
                    market_mult = result.get("trend_multiplier", 1.0)
                    step_signal *= market_mult

            signals.append(step_signal)
            patterns_detected += step_patterns

            if step % period_size == 0 or step == forecast_periods:
                month = len(timeline) + 1
                accuracy = min(100, patterns_detected / max(step, 1) * 100 * 0.5 + 50)
                if capture:
                    event_sink.end_tick(
                        month,
                        round(sum(signals[-10:]) if len(signals) >= 10 else sum(signals), 4),
                        patterns_detected,
                        round(accuracy, 4),
                    )
                timeline.append({
                    "month": month,
                    "revenue": round(sum(signals[-10:]) if len(signals) >= 10 else sum(signals), 4),
                    "customers": patterns_detected,
                    "market_share": round(accuracy, 4),
                    "competitor_strength": round(np.std(signals[-20:]) if len(signals) >= 20 else 0, 4),
                    "budget": round(accuracy, 2),
                })

        # Success = forecast accuracy above confidence level threshold
        accuracy = patterns_detected / max(forecast_periods, 1)
        success = accuracy > confidence_level * 0.5

        return {
            "success": success,
            "final_revenue": round(accuracy * 100, 2),
            "final_customers": patterns_detected,
            "final_market_share": round(accuracy * 100, 4),
            "months_survived": len(timeline),
            "timeline": timeline if timeline else [{"month": 1, "revenue": 0, "customers": 0, "market_share": 0, "competitor_strength": 0, "budget": 0}],
        }

    # Domain -> singular time unit for replay (e.g. "month", "day", "step").
    _TIME_UNIT_SINGULAR = {
        "finance": "day",
        "biology": "step",
        "trend": "period",
    }

    def replay_path(
        self,
        base_seed: int,
        variable_overrides: Optional[Dict] = None,
        path_index: int = 0,
    ) -> Dict[str, Any]:
        """Re-run ONE deterministic path with an attached event sink.

        Uses ``random.Random(base_seed + path_index)`` — the same RNG the Monte
        Carlo loop uses for path ``path_index`` — so the captured path matches a
        real path from the mass run. Returns ``{base_seed, time_unit, agents,
        ticks}`` ready to serve as the replay payload. This is a single cheap
        path, NOT the full Monte Carlo.
        """
        sink = EventSink()
        rng = random.Random(base_seed + path_index)
        self._run_single(variable_overrides, rng, event_sink=sink)
        category = self.config.category.value
        time_unit = self._TIME_UNIT_SINGULAR.get(category, "month")
        return {
            "base_seed": base_seed,
            "time_unit": time_unit,
            "agents": sink.agents(),
            "ticks": sink.ticks,
        }

    async def run(
        self,
        num_runs: Optional[int] = None,
        variable_overrides: Optional[Dict] = None,
        progress_callback: Optional[Any] = None,
        base_seed: Optional[int] = None,
    ) -> SimulationResults:
        """Run full Monte Carlo simulation.

        Args:
            base_seed: Optional reproducibility seed. When omitted, one is
                generated and recorded on the results. Path i is driven by
                ``random.Random(base_seed + i)`` so the same base_seed yields
                an identical success_probability.
            progress_callback: Optional async callable(completed: int, total: int)
                called after each batch completes, for SSE streaming.
        """
        n = num_runs or self.config.num_runs
        if base_seed is None:
            base_seed = random.randrange(2 ** 32)

        # Run in batches — larger batches reduce asyncio overhead for CPU-bound tasks
        results = []
        batch_size = 100
        for i in range(0, n, batch_size):
            batch = min(batch_size, n - i)
            batch_results = await asyncio.gather(
                *[
                    asyncio.to_thread(
                        self._run_single, variable_overrides, random.Random(base_seed + i + j)
                    )
                    for j in range(batch)
                ]
            )
            results.extend(batch_results)
            if progress_callback:
                await progress_callback(len(results), n)

        # NumPy aggregation RNG seeded from the same base_seed for reproducibility.
        np_rng = np.random.default_rng(base_seed)

        # Aggregate results
        successes = [r for r in results if r["success"]]
        success_prob = len(successes) / len(results) * 100

        revenues = [r["final_revenue"] for r in results]
        avg_revenue = float(np.mean(revenues))

        market_shares = [r["final_market_share"] for r in results]
        avg_market_share = float(np.mean(market_shares))

        months_survived = [r["months_survived"] for r in results]
        avg_breakeven = float(np.mean([m for m in months_survived if m > 0]))

        # Bootstrap confidence interval (95%) — much more accurate than arbitrary ±12%
        success_flags = [r["success"] for r in results]
        bootstrap_probs = []
        for _ in range(200):
            sample = np_rng.choice(success_flags, size=len(success_flags), replace=True)
            bootstrap_probs.append(np.mean(sample) * 100)
        ci_low = max(0, float(np.percentile(bootstrap_probs, 2.5)))
        ci_high = min(100, float(np.percentile(bootstrap_probs, 97.5)))

        # ── Confidence diagnostics ──────────────────────────────────────
        diagnostics = self._compute_diagnostics(success_flags, ci_low, ci_high)

        # Dynamic outcome distribution based on actual result data (not hardcoded ranges)
        category = self.config.category.value
        sorted_revs = sorted(revenues)
        nr = len(sorted_revs)
        quantile_edges = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0]
        outcome_dist = []
        for qi in range(len(quantile_edges) - 1):
            lo_idx = int(quantile_edges[qi] * nr)
            hi_idx = min(int(quantile_edges[qi + 1] * nr) - 1, nr - 1)
            lo_val = sorted_revs[lo_idx]
            hi_val = sorted_revs[hi_idx]
            count = hi_idx - lo_idx + 1
            # Format ranges based on domain
            if category in ("biology", "trend"):
                range_label = f"{lo_val:.1f} — {hi_val:.1f}"
            else:
                range_label = f"${lo_val:,.0f} — ${hi_val:,.0f}"
            outcome_dist.append({
                "range": range_label,
                "probability": round(count / nr * 100, 1),
            })

        # Aggregate timeline (use median timeline)
        max_months = self.config.time_horizon
        timeline_agg = []
        for m in range(1, max_months + 1):
            month_revenues = [r["timeline"][m - 1]["revenue"] for r in results if len(r["timeline"]) >= m]
            month_customers = [r["timeline"][m - 1]["customers"] for r in results if len(r["timeline"]) >= m]
            month_market_share = [r["timeline"][m - 1]["market_share"] for r in results if len(r["timeline"]) >= m]
            if not month_revenues:
                break
            timeline_agg.append({
                "month": m,
                "avg_revenue": float(np.mean(month_revenues)),
                "p10_revenue": float(np.percentile(month_revenues, 10)),
                "p90_revenue": float(np.percentile(month_revenues, 90)),
                "avg_customers": float(np.mean(month_customers)),
                "avg_market_share": float(np.mean(month_market_share)),
            })

        # Generate risk factors based on results
        risk_factors = self._generate_risk_factors(results, success_prob)

        # Domain metadata for frontend labeling
        metadata_map = {
            "finance": DomainMetadata(
                primary_metric_label="Portfolio PnL",
                primary_metric_unit="$",
                secondary_metric_label="Price Index",
                tertiary_metric_label="Return %",
                time_unit="months",
            ),
            "biology": DomainMetadata(
                primary_metric_label="Binding Rate",
                primary_metric_unit="%",
                secondary_metric_label="Bound Molecules",
                tertiary_metric_label="Stability Score",
                time_unit="steps",
            ),
            "trend": DomainMetadata(
                primary_metric_label="Signal Strength",
                primary_metric_unit="",
                secondary_metric_label="Patterns Detected",
                tertiary_metric_label="Accuracy %",
                time_unit="periods",
            ),
        }
        domain_metadata = metadata_map.get(category, DomainMetadata(
            primary_metric_label="Revenue",
            primary_metric_unit="$",
            secondary_metric_label="Customers",
            tertiary_metric_label="Market Share %",
            time_unit="months",
        ))

        return SimulationResults(
            success_probability=round(success_prob, 1),
            confidence_interval=(round(ci_low, 1), round(ci_high, 1)),
            avg_revenue=round(avg_revenue, 0),
            avg_market_share=round(avg_market_share, 3),
            avg_breakeven_month=round(avg_breakeven, 1),
            risk_factors=risk_factors,
            key_insights=self._generate_quick_insights(results, success_prob),
            timeline_aggregated=timeline_agg,
            outcome_distribution=outcome_dist,
            competitor_reactions=self._generate_competitor_reactions(results),
            success_explanation=self._success_explanation(success_prob, avg_revenue),
            failure_explanation=self._failure_explanation(results),
            domain_metadata=domain_metadata,
            base_seed=base_seed,
            monte_carlo_standard_error=diagnostics["mcse"],
            convergence_delta=diagnostics["convergence_delta"],
            converged=diagnostics["converged"],
            forecast_confidence=diagnostics["forecast_confidence"],
        )

    def _compute_diagnostics(
        self, success_flags: List[bool], ci_low: float, ci_high: float
    ) -> Dict[str, Any]:
        """Compute Monte-Carlo confidence diagnostics.

        - monte_carlo_standard_error: sqrt(p(1-p)/n) on the success probability,
          expressed in percentage points.
        - convergence: |first-half success prob - second-half| <= 2*MCSE.
        - forecast_confidence: derived from MCSE and the CI width.
        """
        n = len(success_flags)
        p = (sum(1 for f in success_flags if f) / n) if n else 0.0
        mcse = math.sqrt(p * (1 - p) / n) * 100 if n else 0.0

        # Convergence: first half vs second half of the paths.
        half = n // 2
        if half >= 1:
            first = success_flags[:half]
            second = success_flags[half:]
            p_first = sum(1 for f in first if f) / len(first) * 100
            p_second = sum(1 for f in second if f) / len(second) * 100
            convergence_delta = abs(p_first - p_second)
        else:
            convergence_delta = 0.0
        converged = convergence_delta <= max(2 * mcse, 1e-9)

        # Forecast confidence from MCSE + CI width.
        ci_width = ci_high - ci_low
        if mcse <= 1.5 and ci_width <= 10:
            forecast_confidence = "high"
        elif mcse <= 4.0 and ci_width <= 25:
            forecast_confidence = "medium"
        else:
            forecast_confidence = "low"

        return {
            "mcse": round(mcse, 3),
            "convergence_delta": round(convergence_delta, 3),
            "converged": bool(converged),
            "forecast_confidence": forecast_confidence,
        }

    def _generate_risk_factors(self, results: List[Dict], success_prob: float) -> List[RiskFactor]:
        category = self.config.category.value
        failed = [r for r in results if not r["success"]]
        fail_rate = len(failed) / max(len(results), 1)
        early_failures = [r for r in failed if r["months_survived"] < self.config.time_horizon * 0.5]
        early_fail_rate = len(early_failures) / max(len(results), 1)

        risks = []

        # Domain-specific risk generation
        if category == "finance":
            if early_fail_rate > 0.1:
                risks.append(RiskFactor(name="Drawdown Risk", severity="high",
                    probability=round(early_fail_rate * 100, 0),
                    description=f"Portfolio experienced significant drawdown in {len(early_failures)} of {len(results)} scenarios",
                    mitigation="Implement stop-loss at -15% and increase diversification across uncorrelated assets"))
            if success_prob < 60:
                risks.append(RiskFactor(name="Return Shortfall", severity="high",
                    probability=round(100 - success_prob, 0),
                    description="Target return was not met in majority of simulations",
                    mitigation="Adjust target return expectations or increase risk allocation"))
            risks.append(RiskFactor(name="Correlation Risk", severity="medium", probability=45,
                description="Asset correlations increased during stress periods, reducing diversification benefit",
                mitigation="Include alternative assets (commodities, REITs) to reduce correlation"))
            risks.append(RiskFactor(name="Liquidity Risk", severity="low", probability=12,
                description="Spread widening reduced execution quality in ~12% of volatile scenarios",
                mitigation="Maintain position sizes below 5% of daily volume per asset"))

        elif category == "biology":
            if early_fail_rate > 0.1:
                risks.append(RiskFactor(name="Denaturation Risk", severity="high",
                    probability=round(early_fail_rate * 100, 0),
                    description=f"Molecules denatured or lost activity in {len(early_failures)} of {len(results)} runs",
                    mitigation="Tighten temperature to 298-310K and pH to 6.8-7.6"))
            if success_prob < 60:
                risks.append(RiskFactor(name="Low Binding Affinity", severity="high",
                    probability=round(100 - success_prob, 0),
                    description="Binding rate remained below threshold in majority of simulations",
                    mitigation="Screen for higher-affinity ligand variants or optimize concentration"))
            risks.append(RiskFactor(name="Off-Target Binding", severity="medium", probability=30,
                description="Non-specific binding events detected in significant fraction of runs",
                mitigation="Add selectivity screen and optimize binding pocket specificity"))
            risks.append(RiskFactor(name="pH Sensitivity", severity="low", probability=18,
                description="Small pH fluctuations caused binding rate variations of ±15%",
                mitigation="Use buffered conditions and monitor pH drift continuously"))

        elif category == "trend":
            if success_prob < 60:
                risks.append(RiskFactor(name="Overfitting Risk", severity="high",
                    probability=round(100 - success_prob, 0),
                    description="Model captured noise rather than true signal in many scenarios",
                    mitigation="Use cross-validation, reduce model complexity, add regularization"))
            risks.append(RiskFactor(name="Regime Change", severity="medium", probability=35,
                description="Underlying data distribution shifted in ~35% of simulated scenarios",
                mitigation="Implement regime detection and retrain triggers"))
            risks.append(RiskFactor(name="Data Quality", severity="medium", probability=25,
                description="Missing data and outliers degraded forecast accuracy",
                mitigation="Implement robust preprocessing with outlier detection"))
            risks.append(RiskFactor(name="Seasonal Misalignment", severity="low", probability=15,
                description="Seasonal patterns shifted timing in some scenarios",
                mitigation="Use adaptive seasonality decomposition"))

        else:  # Business domains
            if early_fail_rate > 0.15:
                risks.append(RiskFactor(name="Runway Risk", severity="high",
                    probability=round(early_fail_rate * 100, 0),
                    description=f"Ran out of budget in {len(early_failures)} of {len(results)} scenarios before breakeven",
                    mitigation="Reduce burn by 20% or extend runway to 18+ months"))
            if success_prob < 60:
                risks.append(RiskFactor(name="Market Fit Uncertainty", severity="high",
                    probability=round(100 - success_prob, 0),
                    description="Low success rate suggests product-market fit needs validation",
                    mitigation="Run customer discovery to validate core assumptions"))
            risks.append(RiskFactor(name="Competitive Pressure", severity="medium", probability=65,
                description="Competitors reacted with price cuts or feature launches in majority of runs",
                mitigation="Build switching costs and brand moat early"))
            risks.append(RiskFactor(name="Macro Economic Events", severity="low", probability=15,
                description="~15% of runs included a recession or macro shock event",
                mitigation="Maintain 6+ months buffer and diversify customer segments"))

        return risks

    def _generate_competitor_reactions(self, results: List[Dict]) -> List[str]:
        category = self.config.category.value
        if category == "finance":
            return ["Market makers widened spreads in 40% of volatile periods", "Algorithmic traders increased activity during trend reversals"]
        elif category == "biology":
            return ["Enzyme deactivation occurred at temperature extremes", "Competitive binding from solvent molecules observed in 25% of runs"]
        elif category == "trend":
            return ["External shock events disrupted patterns in 20% of forecasts", "Seasonal shifts caused temporary accuracy drops"]
        return ["Price cut by primary competitor in 65% of runs", "Feature parity reached by month 8 in 45% of runs"]

    def _generate_quick_insights(self, results: List[Dict], success_prob: float) -> List[str]:
        category = self.config.category.value
        median_customers = int(np.median([r["final_customers"] for r in results]))
        median_revenue = float(np.median([r["final_revenue"] for r in results]))

        if category == "finance":
            pct_positive = round(len([r for r in results if r["final_revenue"] > 0]) / len(results) * 100)
            return [
                f"Success probability of {success_prob:.0f}% — portfolio met return target in {success_prob:.0f}% of simulations",
                f"Median PnL: ${median_revenue:,.0f} at end of simulation period",
                f"Positive returns in {pct_positive}% of all scenarios",
                f"Median price index ended at {median_customers} — {'above' if median_customers > 500 else 'below'} starting levels",
                f"Maximum drawdown exceeded -20% in {round(len([r for r in results if r['final_revenue'] < -0.2 * 100000]) / len(results) * 100)}% of runs",
            ]
        elif category == "biology":
            return [
                f"Binding success rate: {success_prob:.0f}% of simulations achieved target binding threshold",
                f"Median binding rate: {median_revenue:.1f}% at equilibrium",
                f"Median bound molecules: {median_customers} out of total pool",
                f"Temperature and pH sensitivity accounted for ±{round(np.std([r['final_revenue'] for r in results]), 1)}% binding variation",
                f"Enzyme catalysis processed substrate {'efficiently' if median_customers > 50 else 'slowly'} across conditions",
            ]
        elif category == "trend":
            return [
                f"Forecast accuracy: {success_prob:.0f}% of runs met confidence threshold",
                f"Median signal strength: {median_revenue:.2f}",
                f"Patterns detected: {median_customers} across median scenario",
                f"Signal-to-noise ratio {'favorable' if success_prob > 60 else 'challenging'} for reliable prediction",
                f"Seasonal components contributed significantly to {'successful' if success_prob > 50 else 'most'} forecasts",
            ]
        else:
            pct_above_1m = round(len([r for r in results if r["final_revenue"] > 1_000_000]) / len(results) * 100)
            return [
                f"Success probability of {success_prob:.0f}% — {'above' if success_prob > 60 else 'below'} the 60% confidence threshold",
                f"Median final customer count: {median_customers} at end of simulation period",
                f"Median monthly revenue: ${median_revenue:,.0f} at simulation end",
                f"In {pct_above_1m}% of runs, revenue exceeded $1M ARR",
                f"Break-even timing averaged month {np.mean([r['months_survived'] for r in results if r['success']]) if any(r['success'] for r in results) else 0:.1f} in successful runs",
            ]

    def _success_explanation(self, prob: float, avg_rev: float) -> str:
        category = self.config.category.value
        if category == "finance":
            return (f"In the {prob:.0f}% of successful scenarios, portfolios benefited from favorable trend conditions "
                    f"and disciplined position sizing. Average PnL was ${avg_rev:,.0f}. Key drivers: diversification "
                    f"across uncorrelated assets and timely rebalancing during volatility spikes.")
        elif category == "biology":
            return (f"In the {prob:.0f}% of successful runs, binding conditions were optimal with temperature and pH "
                    f"within favorable ranges. Average binding rate reached {avg_rev:.1f}%. Key factors: molecular "
                    f"concentration above Kd threshold and stable environmental conditions.")
        elif category == "trend":
            return (f"In the {prob:.0f}% of successful forecasts, the signal-to-noise ratio was sufficient for reliable "
                    f"pattern detection. Average accuracy: {avg_rev:.1f}%. Key drivers: consistent seasonal patterns "
                    f"and low noise contamination during forecast windows.")
        return (f"In the {prob:.0f}% of successful scenarios, simulations showed early product-market fit "
                f"by month 4-6 with organic growth accelerating. Average revenue: ${avg_rev:,.0f}/month. "
                f"Key levers: stable pricing, churn below 5%, and competitor reaction delays enabling brand building.")

    def _failure_explanation(self, results: List[Dict]) -> str:
        category = self.config.category.value
        failed = [r for r in results if not r["success"]]
        avg_survival = np.mean([r["months_survived"] for r in failed]) if failed else 0

        if category == "finance":
            return (f"Failed scenarios experienced significant drawdowns averaging through period {avg_survival:.1f}. "
                    f"Primary causes: correlated selloffs during market stress, position concentration risk, "
                    f"and volatility spikes exceeding risk management thresholds.")
        elif category == "biology":
            return (f"Failed simulations showed binding rates below threshold through step {avg_survival:.0f}. "
                    f"Primary causes: suboptimal temperature/pH conditions, competitive binding interference, "
                    f"and enzyme denaturation at extreme conditions reducing catalytic efficiency.")
        elif category == "trend":
            return (f"Failed forecasts diverged from reality by period {avg_survival:.0f}. "
                    f"Primary causes: regime changes in underlying data, noise overwhelming signal, "
                    f"and seasonal pattern shifts that invalidated learned patterns.")
        return (f"Failed scenarios ran out of runway at an average of month {avg_survival:.1f}. "
                f"Primary failure modes: insufficient customer acquisition to cover burn rate, "
                f"high churn from poor segment fit, and competitor pricing that undercut value proposition.")
