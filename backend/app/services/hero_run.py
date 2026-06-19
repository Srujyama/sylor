"""
Hero run — one LLM-in-the-loop explanatory simulation path.

A "hero run" is a SINGLE deterministic-seed simulation path where, at a few KEY
decision ticks, the most influential agent makes an actual LLM (Claude) decision
grounded in its persona + the current market_state, instead of the hardcoded
react() formula. Every other tick (and every non-selected agent) uses the normal
formula, so the path stays seeded and reproducible APART FROM the handful of LLM
decision points.

This is deliberately NOT the 1000-path Monte Carlo (which stays formula-based and
fast). It is ONE illustrative path meant to *explain* how an influential agent
might reason, not to produce a statistical result. The LLM decision points are
inherently non-deterministic; the rest of the path is seeded.

Determinism / safety
--------------------
- The path is driven by ``random.Random(base_seed)`` — the SAME RNG family the
  Monte Carlo loop uses for path 0 — so the formula parts reproduce exactly.
- Budget is HARD-capped at ``max_decisions`` LLM calls across the whole run; once
  exhausted, every remaining key tick falls back to the formula.
- Every LLM-derived nudge is clamped to a bounded, finite range. An LLM failure
  (timeout, bad JSON, anything) is caught and the agent falls back to its formula
  for that tick — never a 500, never NaN/inf.

This service drives a parallel async loop that MIRRORS ``_run_business``'s
per-step decision points (it reuses the engine's ``_create_agents`` + persona
modulators + ``_find_var`` + ``EventSink``-style metrics) WITHOUT mutating
``_run_single`` or the Monte Carlo path.
"""
from __future__ import annotations

import json
import logging
import math
import random
from typing import Any, Dict, List, Optional

from app.models.simulation import SimulationConfig
from app.services.simulation_engine import SimulationEngine

logger = logging.getLogger(__name__)

# Hard bounds on the budget (mirrors the API contract).
MIN_DECISIONS = 1
MAX_DECISIONS = 12
DEFAULT_DECISIONS = 6

# The bounded multiplicative range an LLM decision may nudge the step by. The
# agent's structured choice maps to one of these; clamped so a single tick can
# never run away or produce a non-finite metric.
_CHOICE_NUDGE = {
    "aggressive_expand": 0.15,   # push hard for growth this step
    "expand": 0.07,
    "hold": 0.0,
    "defend": -0.07,
    "retreat": -0.15,            # pull back / cut exposure this step
}
_VALID_CHOICES = tuple(_CHOICE_NUDGE.keys())
# Absolute clamp on the resulting multiplicative nudge, independent of the map
# above, so even a future map change can never breach this.
_MAX_ABS_NUDGE = 0.25

_HERO_SYSTEM = (
    "You are role-playing a single influential agent inside a multi-agent business "
    "simulation. Given your persona and a compact market snapshot, choose ONE action "
    "for this step. Stay in character: an aggressive persona pushes for growth, a "
    "conservative one protects downside. Respond with JSON of the shape "
    '{"decision": "<one of: aggressive_expand|expand|hold|defend|retreat>", '
    '"rationale": "<one or two sentences, grounded in the snapshot and your persona>"}. '
    "Pick exactly one decision from the allowed list; do not invent new actions."
)


def _finite(x: float, default: float = 0.0) -> float:
    """Coerce to a finite float; NaN/inf -> default. Mirrors the optimizer guard."""
    try:
        xf = float(x)
    except (TypeError, ValueError):
        return default
    return xf if math.isfinite(xf) else default


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def _persona_summary(agent) -> str:
    """A short, human-readable persona blurb for the prompt + response payload."""
    rules = getattr(agent, "behavior_rules", []) or []
    rules_txt = "; ".join(str(r) for r in rules[:3])
    parts = [
        f"{getattr(agent, 'display_name', agent.type)} ({agent.type})",
        f"style={getattr(agent, 'decision_style', 'balanced')}",
        f"risk={getattr(agent, 'risk_tolerance', 0.5):.2f}",
        f"activity={getattr(agent, 'activity_level', 0.5):.2f}",
        f"influence={getattr(agent, 'influence_weight', 0.5):.2f}",
    ]
    summary = ", ".join(parts)
    if rules_txt:
        summary += f". Rules: {rules_txt}"
    return summary


class HeroRunner:
    """Drives ONE LLM-in-the-loop business-style path for a config.

    The runner reuses an underlying ``SimulationEngine`` for agent construction
    and variable resolution, but runs its OWN seeded loop so it can ``await`` an
    LLM decision at budgeted key ticks. The Monte Carlo machinery is untouched.
    """

    def __init__(self, config: SimulationConfig, llm_client):
        self.config = config
        self.engine = SimulationEngine(config)
        # Injected so tests can pass a mock and we never import a real client here.
        self.llm = llm_client

    # ── Key-tick selection ────────────────────────────────────────────────
    def _key_ticks(self, horizon: int, budget: int) -> set:
        """Pick which steps are "key" decision ticks.

        Always includes the first step; then spaces the remaining budget evenly
        across the horizon. Regime/swing detection happens dynamically in the
        loop too (a big revenue swing also qualifies), but this gives a bounded,
        deterministic backbone so behavior is predictable. The set may be LARGER
        than the budget — the budget counter is the hard cap, not this set.
        """
        if horizon <= 0 or budget <= 0:
            return set()
        ticks = {1}
        # Evenly space up to `budget` additional candidate ticks.
        if horizon > 1 and budget > 1:
            step = max(1, horizon // budget)
            for k in range(1, budget):
                t = 1 + k * step
                if t <= horizon:
                    ticks.add(t)
        return ticks

    def _pick_agent(self, agents: List, rotate_idx: int):
        """Pick the most influential agent, rotating among ties to add variety."""
        if not agents:
            return None
        # Highest influence_weight; deterministic tiebreak by position.
        max_w = max(getattr(a, "influence_weight", 0.5) for a in agents)
        top = [a for a in agents if getattr(a, "influence_weight", 0.5) >= max_w - 1e-9]
        return top[rotate_idx % len(top)]

    async def _llm_decision(
        self, agent, market_snapshot: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """ONE chat_json call -> a validated structured choice, or None on failure.

        Returns ``{"decision", "rationale", "nudge"}`` where ``nudge`` is the
        bounded multiplicative effect for this step. Any exception or invalid
        payload returns None so the caller falls back to the formula.
        """
        try:
            parsed = await self.llm.chat_json(
                messages=[{
                    "role": "user",
                    "content": (
                        f"Your persona: {_persona_summary(agent)}\n"
                        f"Allowed decisions: {', '.join(_VALID_CHOICES)}\n"
                        f"Market snapshot: {json.dumps(market_snapshot)}\n\n"
                        "Choose ONE decision for this step and explain briefly."
                    ),
                }],
                system=_HERO_SYSTEM,
                temperature=0.5,
                max_tokens=400,
            )
        except Exception as exc:  # noqa: BLE001 — graceful formula fallback
            logger.warning("Hero-run LLM decision failed for agent %s: %s",
                           getattr(agent, "agent_id", "?"), exc)
            return None

        if not isinstance(parsed, dict):
            return None
        decision = str(parsed.get("decision", "")).strip().lower()
        if decision not in _CHOICE_NUDGE:
            # Out-of-vocabulary choice — treat as a failed decision (fall back).
            logger.warning("Hero-run LLM returned invalid decision %r; falling back.",
                           decision)
            return None
        rationale = str(parsed.get("rationale") or "").strip()
        if not rationale:
            rationale = f"Chose to {decision.replace('_', ' ')}."
        # Bounded, finite nudge — double-clamped.
        nudge = _clamp(_finite(_CHOICE_NUDGE[decision]), -_MAX_ABS_NUDGE, _MAX_ABS_NUDGE)
        return {"decision": decision, "rationale": rationale[:400], "nudge": nudge}

    # ── Main path ─────────────────────────────────────────────────────────
    async def run(self, base_seed: int, max_decisions: int) -> Dict[str, Any]:
        """Run the single hero path. Returns the full response payload (minus the
        narrative, which the router adds with its own LLM call)."""
        budget = int(_clamp(max_decisions, MIN_DECISIONS, MAX_DECISIONS))
        rng = random.Random(base_seed)

        engine = self.engine
        agents = engine._create_agents(rng)
        vars_ = dict(engine.variables)

        # Business-style key variables (reuse the engine's flexible resolver so
        # AI-named variables still map). The hero path always reports business
        # metrics (revenue/customers/market_share) per the contract, regardless
        # of the sim's category.
        price = engine._find_var(
            vars_, "price_per_unit", "price", "current_price", "price_point",
            "monthly_price", "subscription_price", default=99,
        )
        market_size = engine._find_var(
            vars_, "market_size", "target_market_size", "tam",
            "total_addressable_market", "addressable_market", default=1_000_000,
        )
        initial_customers = int(engine._find_var(
            vars_, "current_customers", "customer_count", "existing_customers",
            "customer_base", default=0,
        ))
        current_mrr = engine._find_var(
            vars_, "current_mrr", "mrr", "monthly_revenue", "current_revenue",
            default=0,
        )
        budget_var = engine._find_var(
            vars_, "budget", "monthly_budget", "monthly_burn", "burn_rate",
            "monthly_burn_rate", default=50000,
        )

        horizon = int(self.config.time_horizon)
        key_ticks = self._key_ticks(horizon, budget)

        timeline: List[Dict[str, Any]] = []
        decisions: List[Dict[str, Any]] = []
        revenue = _finite(current_mrr)
        customers = max(0, initial_customers)
        prev_revenue = revenue
        decisions_used = 0   # successful decisions (reported)
        attempts = 0         # LLM calls made — the HARD budget is on ATTEMPTS
        rotate_idx = 0

        for month in range(1, horizon + 1):
            month_growth = (
                (customers - (timeline[-1]["customers"] if timeline else initial_customers))
                / max(customers, 1)
            )
            market_state = {
                "month": month,
                "revenue": revenue,
                "total_customers": customers,
                "revenue_growth": (revenue - prev_revenue) / max(prev_revenue, 1),
                "month_growth": month_growth,
            }

            market_effect = 1.0
            new_funding = 0.0
            productivity_multiplier = 1.0
            for agent in agents:
                result = agent.react(market_state, vars_)
                if agent.type == "customer":
                    customers = result.get("total", customers)
                elif agent.type == "market":
                    market_effect = _finite(result.get("trend_multiplier", 1.0), 1.0)
                    if result.get("recession"):
                        market_effect *= 0.7
                elif agent.type == "investor":
                    new_funding += _finite(result.get("funding", 0.0))
                elif agent.type == "employee":
                    productivity_multiplier = _finite(
                        result.get("productivity_multiplier", 1.0), 1.0
                    )

            budget_var += new_funding

            # ── KEY-TICK detection: scheduled tick OR a large revenue swing ──
            prev_revenue = revenue
            base_revenue = (
                customers * price * market_effect * productivity_multiplier
                + rng.gauss(0, max(customers * price * 0.1, 1))
            )
            base_revenue = max(0.0, _finite(base_revenue))

            swing = abs(base_revenue - prev_revenue) / max(prev_revenue, 1)
            is_key = month in key_ticks or swing > 0.4 or month == 1

            llm_nudge = 0.0
            # HARD cap on LLM CALLS (attempts), not just successful decisions:
            # a failing/invalid LLM must not let later key ticks keep calling
            # chat_json past the budget.
            if is_key and attempts < budget and agents:
                agent = self._pick_agent(agents, rotate_idx)
                rotate_idx += 1
                snapshot = {
                    "month": month,
                    "revenue": round(base_revenue, 2),
                    "customers": int(customers),
                    "market_effect": round(market_effect, 4),
                    "revenue_growth": round(market_state["revenue_growth"], 4),
                    "runway_budget": round(budget_var, 2),
                }
                attempts += 1
                decision = await self._llm_decision(agent, snapshot)
                if decision is not None:
                    decisions_used += 1
                    llm_nudge = decision["nudge"]
                    applied = base_revenue * llm_nudge
                    decisions.append({
                        "t": month,
                        "agent_id": getattr(agent, "agent_id", agent.type),
                        "agent_type": agent.type,
                        "agent_name": getattr(agent, "display_name", agent.type),
                        "persona_summary": _persona_summary(agent),
                        "market_snapshot": snapshot,
                        "decision": decision["decision"],
                        "rationale": decision["rationale"],
                        "applied_effect": round(_finite(applied), 2),
                    })
                # decision is None => LLM failed/invalid; we silently fall back
                # to the formula. The attempt still counts against the budget
                # (we already made the chat_json call), so a failing LLM can't
                # exceed max_decisions calls.

            revenue = max(0.0, _finite(base_revenue * (1.0 + llm_nudge)))
            market_share = _clamp((customers / max(market_size, 1)) * 100, 0.0, 100.0)

            timeline.append({
                "t": month,
                "revenue": round(_finite(revenue), 2),
                "customers": int(customers),
                "market_share": round(_finite(market_share), 4),
            })

            # Burn down the runway like the business engine does.
            monthly_burn = budget_var * 0.8
            budget_var -= monthly_burn
            if budget_var < 0:
                break

        final_revenue = _finite(timeline[-1]["revenue"]) if timeline else 0.0
        months_survived = len(timeline)
        target_revenue = engine._find_var(
            vars_, "budget", "monthly_burn", default=50000
        ) * 1.5
        success = bool(
            final_revenue >= target_revenue
            and months_survived >= horizon * 0.75
        )

        time_unit = engine._TIME_UNIT_SINGULAR.get(self.config.category.value, "month")

        return {
            "base_seed": base_seed,
            "time_unit": time_unit,
            "timeline": timeline,
            "decisions": decisions,
            "outcome": {"success": success, "final_revenue": round(final_revenue, 2)},
            "decisions_used": decisions_used,
            "decisions_budget": budget,
        }
