from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from fastapi.responses import StreamingResponse
from typing import List, Optional, AsyncGenerator, Dict
import uuid
import json
import asyncio
import logging
import math
import random
import numpy as np
from datetime import datetime

logger = logging.getLogger(__name__)

from app.models.simulation import (
    SimulationConfig, SimulationCreate,
    RunSimulationRequest, SimulationStatus,
    BranchSimulationRequest,
)
from app.services.simulation_engine import SimulationEngine
from app.services.hero_run import HeroRunner, MIN_DECISIONS, MAX_DECISIONS, DEFAULT_DECISIONS
from app.services.ai_insights import generate_ai_insights
from app.services.calibration import calibrate as run_calibration
from app.services import optimizer
from app.services.llm_client import llm_client
from app.services.run_history import record_run, RUNS_COLLECTION
from app.services.firebase_admin import (
    get_document, update_document, delete_document, query_collection, get_db,
)
from app.middleware.auth import get_current_user
from app.middleware.rate_limit import require_expensive_rate_limit

import re

# ---------------------------------------------------------------------------
# Input-validation helpers
# ---------------------------------------------------------------------------

_MAX_NAME_LENGTH = 200
_MAX_DESCRIPTION_LENGTH = 2000


def _sanitize_string(value: Optional[str], max_length: int) -> Optional[str]:
    """Strip excessive whitespace and enforce length limit."""
    if value is None:
        return None
    # Collapse internal whitespace runs to a single space and strip ends
    cleaned = re.sub(r"\s+", " ", value).strip()
    return cleaned[:max_length]


def _validate_variable_overrides(
    overrides: Optional[dict], config: SimulationConfig
) -> None:
    """Raise 422 if any override key does not match a known variable name."""
    if not overrides:
        return
    valid_names = {v.name for v in config.variables}
    invalid = set(overrides.keys()) - valid_names
    if invalid:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown variable override keys: {sorted(invalid)}. "
                   f"Valid keys are: {sorted(valid_names)}",
        )


def _validate_num_runs(num_runs: Optional[int]) -> None:
    """Enforce bounds on num_runs when provided."""
    if num_runs is not None and (num_runs < 10 or num_runs > 10000):
        raise HTTPException(
            status_code=422,
            detail="num_runs must be between 10 and 10,000.",
        )

router = APIRouter(prefix="/api/simulations", tags=["simulations"])

COLLECTION = "simulations"


async def _load_owned_sim(sim_id: str, user: dict) -> dict:
    """Fetch a simulation, enforcing existence (404) and ownership (403)."""
    sim = await get_document(COLLECTION, sim_id)
    if not sim:
        raise HTTPException(status_code=404, detail="Simulation not found")
    if sim.get("user_id") != user["uid"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    return sim


# Map AI-generated agent type strings to valid AgentType enum values
_AGENT_TYPE_MAP = {
    "customer": "customer", "competitor": "competitor", "regulator": "regulator",
    "investor": "investor", "market": "market", "trader": "trader",
    "market_maker": "market_maker", "molecule": "molecule", "enzyme": "enzyme",
    "data_stream": "data_stream", "supply_chain": "supply_chain", "employee": "employee",
    "momentum_trader": "trader", "value_investor": "investor",
    "algorithmic_trader": "trader", "quant_trader": "trader", "retail_trader": "trader",
    "institutional_investor": "investor", "portfolio_manager": "investor",
    "market_analyst": "market", "market_participant": "market",
    "market_force": "market", "macro_force": "market", "macro": "market",
    "consumer": "customer", "user": "customer", "buyer": "customer", "client": "customer",
    "end_user": "customer", "churn_agent": "customer", "acquisition_agent": "customer",
    "sales_agent": "customer", "regulatory": "regulator", "government": "regulator",
    "policy_maker": "regulator", "vc_investor": "investor", "angel_investor": "investor",
    "data": "data_stream", "signal": "data_stream", "trend": "data_stream",
    "sensor": "data_stream", "feed": "data_stream", "ligand": "molecule",
    "protein": "molecule", "substrate": "molecule", "catalyst": "enzyme",
    "inhibitor": "molecule", "supplier": "supply_chain", "vendor": "supply_chain",
    "logistics": "supply_chain", "warehouse": "supply_chain",
    "worker": "employee", "staff": "employee", "hire": "employee", "team": "employee",
}


def _sanitize_agent_type(agent_type_str: str) -> str:
    s = str(agent_type_str).lower().strip().replace(" ", "_").replace("-", "_")
    if s in _AGENT_TYPE_MAP:
        return _AGENT_TYPE_MAP[s]
    for key, val in _AGENT_TYPE_MAP.items():
        if key in s or s in key:
            return val
    return "market"


@router.post("", response_model=dict, status_code=201)
async def create_simulation(payload: SimulationCreate, user: dict = Depends(get_current_user)):
    # Sanitize string inputs
    payload.config.name = _sanitize_string(payload.config.name, _MAX_NAME_LENGTH) or "Untitled"
    payload.config.description = _sanitize_string(payload.config.description, _MAX_DESCRIPTION_LENGTH)

    sim_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()

    config_dict = payload.config.model_dump()
    for agent in config_dict.get("agents", []):
        raw_type = agent.get("type", "market")
        if isinstance(raw_type, str):
            agent["type"] = _sanitize_agent_type(raw_type)

    try:
        sanitized_config = SimulationConfig(**config_dict)
    except Exception:
        sanitized_config = payload.config

    sim = {
        "id": sim_id,
        "user_id": user["uid"],
        "name": sanitized_config.name,
        "description": sanitized_config.description,
        "category": sanitized_config.category.value,
        "config": sanitized_config.model_dump(mode="json"),
        "status": SimulationStatus.DRAFT.value,
        "results": None,
        "created_at": now,
        "updated_at": now,
        "run_count": 0,
        # Scenario tree: a freshly created sim is its own root.
        "parent_id": None,
        "root_id": sim_id,
        "branch_label": None,
    }

    db = get_db()
    await db.collection(COLLECTION).document(sim_id).set(sim)
    return sim


@router.get("", response_model=List[dict])
async def list_simulations(user: dict = Depends(get_current_user)):
    return await query_collection(COLLECTION, [("user_id", "==", user["uid"])])


@router.get("/{sim_id}", response_model=dict)
async def get_simulation(sim_id: str, user: dict = Depends(get_current_user)):
    sim = await _load_owned_sim(sim_id, user)
    return sim


@router.post("/{sim_id}/run", dependencies=[Depends(require_expensive_rate_limit)])
async def run_simulation(
    sim_id: str,
    request: RunSimulationRequest,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
):
    _validate_num_runs(request.num_runs)

    sim = await _load_owned_sim(sim_id, user)
    if sim["status"] == SimulationStatus.RUNNING.value:
        raise HTTPException(status_code=409, detail="Simulation is already running")

    # Validate variable_overrides against config
    config = SimulationConfig(**sim["config"])
    _validate_variable_overrides(request.variable_overrides, config)

    await update_document(COLLECTION, sim_id, {
        "status": SimulationStatus.RUNNING.value,
        "updated_at": datetime.utcnow().isoformat(),
    })

    background_tasks.add_task(
        _execute_simulation,
        sim_id,
        SimulationConfig(**sim["config"]),
        request.num_runs,
        request.variable_overrides,
    )

    return {"status": "running", "sim_id": sim_id}


# ── SSE Streaming endpoint ─────────────────────────────────────────────────

def _sse_event(event: str, data: dict) -> str:
    """Format a Server-Sent Event."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@router.post("/{sim_id}/run/stream", dependencies=[Depends(require_expensive_rate_limit)])
async def run_simulation_stream(
    sim_id: str,
    request: RunSimulationRequest,
    user: dict = Depends(get_current_user),
):
    """Run simulation with SSE progress streaming.

    Sends events:
      - progress: { percent, completed, total, phase }
      - complete: { results }
      - error: { detail }
    """
    _validate_num_runs(request.num_runs)

    sim = await _load_owned_sim(sim_id, user)
    if sim["status"] == SimulationStatus.RUNNING.value:
        raise HTTPException(status_code=409, detail="Simulation is already running")

    config = SimulationConfig(**sim["config"])
    _validate_variable_overrides(request.variable_overrides, config)

    await update_document(COLLECTION, sim_id, {
        "status": SimulationStatus.RUNNING.value,
        "updated_at": datetime.utcnow().isoformat(),
    })

    async def stream_simulation() -> AsyncGenerator[str, None]:
        n = request.num_runs or config.num_runs
        # Queue carries (event_name, data) tuples; None is the end sentinel.
        event_queue: asyncio.Queue = asyncio.Queue()

        async def on_progress(completed: int, total: int):
            pct = round(completed / total * 85)  # Reserve 15% for post-processing
            await event_queue.put(("progress", {
                "percent": pct, "completed": completed, "total": total, "phase": "running"
            }))

        async def run_engine():
            """Run the engine, pushing events onto the queue AS THEY HAPPEN."""
            try:
                engine = SimulationEngine(config)
                results = await engine.run(
                    num_runs=n,
                    variable_overrides=request.variable_overrides,
                    progress_callback=on_progress,
                )

                await event_queue.put(("progress", {
                    "percent": 90, "completed": n, "total": n, "phase": "ai_insights"
                }))

                # AI insights
                try:
                    ai_data = await generate_ai_insights(config, results, company_context=config.company_context)
                    results.key_insights = ai_data.get("key_insights", results.key_insights)
                    results.success_explanation = ai_data.get("success_pattern", results.success_explanation)
                    results.failure_explanation = ai_data.get("failure_pattern", results.failure_explanation)
                except Exception as exc:
                    logger.warning("AI insights generation failed for simulation %s: %s", sim_id, exc)

                await event_queue.put(("progress", {
                    "percent": 98, "completed": n, "total": n, "phase": "saving"
                }))

                # Save to Firestore
                doc = await get_document(COLLECTION, sim_id)
                run_count = (doc.get("run_count", 0) if doc else 0) + 1
                await update_document(COLLECTION, sim_id, {
                    "status": SimulationStatus.COMPLETED.value,
                    "results": results.model_dump(mode="json"),
                    "run_count": run_count,
                    "updated_at": datetime.utcnow().isoformat(),
                })

                # Record run history (best-effort, never raises)
                await record_run(
                    sim_id, sim.get("user_id"), n, results,
                    variable_overrides=request.variable_overrides,
                )

                await event_queue.put(("complete", {
                    "sim_id": sim_id, "success_probability": results.success_probability
                }))

            except Exception as e:
                logger.exception("Simulation %s failed", sim_id)
                await update_document(COLLECTION, sim_id, {
                    "status": SimulationStatus.FAILED.value,
                    "error": str(e),
                    "updated_at": datetime.utcnow().isoformat(),
                })
                await event_queue.put(("error", {"detail": str(e)}))
            finally:
                await event_queue.put(None)  # end sentinel

        # Start the engine as a concurrent task and stream events as they arrive.
        engine_task = asyncio.create_task(run_engine())

        yield _sse_event("progress", {"percent": 0, "completed": 0, "total": n, "phase": "running"})

        try:
            while True:
                try:
                    item = await asyncio.wait_for(event_queue.get(), timeout=10.0)
                except asyncio.TimeoutError:
                    # Keep the connection alive during long silent stretches.
                    yield ": heartbeat\n\n"
                    continue
                if item is None:
                    break
                event_name, data = item
                yield _sse_event(event_name, data)
        finally:
            await engine_task

    return StreamingResponse(
        stream_simulation(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


async def _execute_simulation(
    sim_id: str,
    config: SimulationConfig,
    num_runs: Optional[int],
    variable_overrides: Optional[dict],
):
    try:
        engine = SimulationEngine(config)
        results = await engine.run(num_runs=num_runs, variable_overrides=variable_overrides)

        try:
            ai_data = await generate_ai_insights(config, results, company_context=config.company_context)
            results.key_insights = ai_data.get("key_insights", results.key_insights)
            results.success_explanation = ai_data.get("success_pattern", results.success_explanation)
            results.failure_explanation = ai_data.get("failure_pattern", results.failure_explanation)
        except Exception as exc:
            logger.warning("AI insights generation failed for simulation %s: %s", sim_id, exc)

        doc = await get_document(COLLECTION, sim_id)
        run_count = (doc.get("run_count", 0) if doc else 0) + 1

        await update_document(COLLECTION, sim_id, {
            "status": SimulationStatus.COMPLETED.value,
            "results": results.model_dump(mode="json"),
            "run_count": run_count,
            "updated_at": datetime.utcnow().isoformat(),
        })

        # Record run history (best-effort, never raises)
        await record_run(
            sim_id,
            doc.get("user_id") if doc else None,
            num_runs or config.num_runs,
            results,
            variable_overrides=variable_overrides,
        )

    except Exception as e:
        logger.exception("Simulation %s failed", sim_id)
        await update_document(COLLECTION, sim_id, {
            "status": SimulationStatus.FAILED.value,
            "error": str(e),
            "updated_at": datetime.utcnow().isoformat(),
        })


@router.get("/{sim_id}/results")
async def get_results(sim_id: str, user: dict = Depends(get_current_user)):
    sim = await _load_owned_sim(sim_id, user)
    if sim["status"] != SimulationStatus.COMPLETED.value:
        return {"status": sim["status"], "results": None}
    return {"status": sim["status"], "results": sim.get("results")}


# ── Theater replay (one captured deterministic path) ─────────────────────────

def _build_replay(sim: dict) -> dict:
    """Re-run ONE seeded path with an event sink and shape the replay payload.

    Uses the sim's recorded ``results.base_seed`` so the captured path is one of
    the real Monte Carlo paths (path 0). This is a single cheap deterministic
    run, NOT the full Monte Carlo.
    """
    config = SimulationConfig(**sim["config"])
    base_seed = _resolve_base_seed(sim)
    engine = SimulationEngine(config)
    return engine.replay_path(base_seed, path_index=0)


@router.get("/{sim_id}/replay")
async def get_replay(sim_id: str, user: dict = Depends(get_current_user)):
    """Return one representative seeded path captured for animation.

    Re-runs a single deterministic path with the sim's stored base_seed and an
    event sink. The built replay is cached on the sim doc (``results.replay``)
    so repeat GETs do not recompute. 404 if the sim has no results yet.
    """
    sim = await _load_owned_sim(sim_id, user)

    results = sim.get("results")
    if not isinstance(results, dict):
        raise HTTPException(status_code=404, detail="Simulation has no results yet")

    cached = results.get("replay")
    if isinstance(cached, dict) and cached.get("ticks"):
        return cached

    replay = _build_replay(sim)

    # Cache onto the sim doc so repeat GETs don't recompute.
    results = dict(results)
    results["replay"] = replay
    try:
        await update_document(COLLECTION, sim_id, {"results": results})
    except Exception as exc:
        logger.warning("Failed to cache replay for simulation %s: %s", sim_id, exc)

    return replay


# ── Agent transcript (persona-voiced narrative of the captured path) ─────────

_TRANSCRIPT_SYSTEM = (
    "You are a narrator turning a multi-agent simulation's event log into a "
    "short, vivid play-by-play. Each step has agent actions; voice the named "
    "agents as characters (e.g. 'Users surged in', 'Rival cut prices'). "
    'Respond with JSON of the shape {"transcript": [{"t": <step number>, '
    '"narrative": "<one or two sentences>"}], "summary": "<2-3 sentence overall '
    'arc>"}. Keep each step narrative under 240 characters. Use the agent names '
    "and types provided; do not invent agents."
)


def _fallback_transcript(replay: dict) -> dict:
    """Deterministic templated narrative when the LLM is unavailable."""
    name_by_id = {a["id"]: a.get("name") or a.get("type") for a in replay.get("agents", [])}
    time_unit = replay.get("time_unit", "step")
    transcript = []
    for tick in replay.get("ticks", []):
        parts = []
        for ev in tick.get("events", [])[:4]:
            who = name_by_id.get(ev["agent_id"], ev.get("agent_type", "agent"))
            parts.append(f"{who} {ev['action']} ({ev['value']:g})")
        metrics = tick.get("metrics", {})
        narrative = (
            f"{time_unit.capitalize()} {tick['t']}: " + "; ".join(parts) + ". "
            f"Revenue {metrics.get('revenue', 0):,.0f}, "
            f"customers {metrics.get('customers', 0):,.0f}."
        )
        transcript.append({"t": tick["t"], "narrative": narrative})
    summary = (
        f"Across {len(transcript)} {time_unit}s the agents interacted to shape the "
        "outcome shown in the metrics above."
    )
    return {"transcript": transcript, "summary": summary}


@router.get("/{sim_id}/transcript")
async def get_transcript(sim_id: str, user: dict = Depends(get_current_user)):
    """Return a persona-voiced narrative of the captured path.

    Builds the event log (same as /replay), then makes ONE llm_client.chat_json
    call to turn the per-step events into a narrative + summary. Cached on the
    sim doc (``results.transcript``). Falls back to a templated narrative if the
    LLM fails (still 200). 404 if no results.
    """
    sim = await _load_owned_sim(sim_id, user)

    results = sim.get("results")
    if not isinstance(results, dict):
        raise HTTPException(status_code=404, detail="Simulation has no results yet")

    cached = results.get("transcript")
    if isinstance(cached, dict) and cached.get("transcript"):
        return cached

    # Reuse the cached replay event log when present, else build it.
    replay = results.get("replay")
    if not (isinstance(replay, dict) and replay.get("ticks")):
        replay = _build_replay(sim)

    transcript = _fallback_transcript(replay)
    try:
        agents_desc = [
            {"id": a["id"], "name": a.get("name"), "type": a.get("type")}
            for a in replay.get("agents", [])
        ]
        # Trim each tick's events to keep the prompt compact.
        ticks_desc = [
            {"t": tk["t"], "events": tk.get("events", []), "metrics": tk.get("metrics", {})}
            for tk in replay.get("ticks", [])
        ]
        parsed = await llm_client.chat_json(
            messages=[{
                "role": "user",
                "content": (
                    f"Simulation: {sim.get('name', 'Simulation')} "
                    f"(category {sim.get('category')}, time unit {replay.get('time_unit')}).\n"
                    f"Agents:\n{json.dumps(agents_desc)}\n\n"
                    f"Event log per step:\n{json.dumps(ticks_desc)}"
                ),
            }],
            system=_TRANSCRIPT_SYSTEM,
            temperature=0.6,
            max_tokens=2048,
        )
        steps = parsed.get("transcript")
        if isinstance(steps, list) and steps:
            cleaned = []
            for s in steps:
                if isinstance(s, dict) and s.get("narrative"):
                    cleaned.append({
                        "t": int(s.get("t", len(cleaned) + 1)),
                        "narrative": str(s["narrative"]),
                    })
            if cleaned:
                transcript = {
                    "transcript": cleaned,
                    "summary": str(parsed.get("summary") or transcript["summary"]),
                }
    except Exception as exc:
        logger.warning("Transcript generation failed for simulation %s: %s", sim_id, exc)

    # Cache onto the sim doc.
    results = dict(results)
    results["transcript"] = transcript
    try:
        await update_document(COLLECTION, sim_id, {"results": results})
    except Exception as exc:
        logger.warning("Failed to cache transcript for simulation %s: %s", sim_id, exc)

    return transcript


# ── AI copilot (next-experiment suggestions) ─────────────────────────────────

_COPILOT_SYSTEM = (
    "You are an experiment-design copilot for a Monte Carlo simulation tool. "
    "Given a simulation's results summary, its variables, and its run history, "
    "propose 3-5 high-value next experiments. Each suggestion has a typed action "
    "the UI maps onto an existing endpoint. Allowed types: 'sweep' (vary one "
    "variable across a range), 'branch' (apply variable overrides as a new "
    "scenario), 'whatif' (a natural-language scenario prompt), 'compare' "
    "(compare existing runs). Respond with JSON of the shape "
    '{"suggestions": [{"type": "sweep"|"branch"|"whatif"|"compare", "title": '
    '"<short>", "rationale": "<why>", "action": {"variable_name"?: str, '
    '"min_value"?: number, "max_value"?: number, "variable_overrides"?: '
    '{<name>: number}, "prompt"?: str}}]}. Only use variable names from the '
    "provided list. Sweep actions need variable_name+min_value+max_value; "
    "branch actions need variable_overrides; whatif actions need prompt."
)

_VALID_COPILOT_TYPES = {"sweep", "branch", "whatif", "compare"}


def _heuristic_suggestions(config: SimulationConfig, results: Optional[dict]) -> List[dict]:
    """Deterministic fallback suggestions (2-3) when the LLM is unavailable."""
    numeric = [v for v in config.variables if v.type in _NUMERIC_VARIABLE_TYPES]
    suggestions: List[dict] = []
    if numeric:
        v = numeric[0]
        lo = v.min if v.min is not None else v.value * 0.5
        hi = v.max if v.max is not None else v.value * 1.5
        suggestions.append({
            "type": "sweep",
            "title": f"Sweep {v.label}",
            "rationale": (
                f"{v.label} is a primary lever; sweeping it from {lo:g} to {hi:g} "
                "reveals where success probability turns."
            ),
            "action": {
                "variable_name": v.name,
                "min_value": round(float(lo), 4),
                "max_value": round(float(hi), 4),
            },
        })
        suggestions.append({
            "type": "branch",
            "title": f"Branch: {v.label} +20%",
            "rationale": f"Test a concrete scenario where {v.label} is 20% higher.",
            "action": {"variable_overrides": {v.name: round(float(v.value) * 1.2, 4)}},
        })
        suggestions.append({
            "type": "branch",
            "title": f"Branch: {v.label} -20%",
            "rationale": f"Test a concrete scenario where {v.label} is 20% lower.",
            "action": {"variable_overrides": {v.name: round(float(v.value) * 0.8, 4)}},
        })
    else:
        suggestions.append({
            "type": "whatif",
            "title": "Explore a downside scenario",
            "rationale": "No numeric variables to sweep; describe a stress scenario in words.",
            "action": {"prompt": "What if demand dropped sharply?"},
        })
        suggestions.append({
            "type": "compare",
            "title": "Compare against a baseline run",
            "rationale": "Compare this simulation's outcome with another saved run.",
            "action": {},
        })
    return suggestions[:3]


@router.post("/{sim_id}/copilot", dependencies=[Depends(require_expensive_rate_limit)])
async def copilot_suggestions(sim_id: str, user: dict = Depends(get_current_user)):
    """Suggest 3-5 typed next experiments for a simulation.

    Feeds the results summary, variable list, and run history to the LLM. Falls
    back to 2-3 heuristic suggestions when the LLM fails. Owner-scoped.
    """
    sim = await _load_owned_sim(sim_id, user)

    config = SimulationConfig(**sim["config"])
    results = sim.get("results") if isinstance(sim.get("results"), dict) else None

    variables_desc = [
        {"name": v.name, "label": v.label, "value": v.value,
         "min": v.min, "max": v.max, "type": v.type}
        for v in config.variables
    ]
    results_summary = {}
    if results:
        results_summary = {
            "success_probability": results.get("success_probability"),
            "avg_revenue": results.get("avg_revenue"),
            "avg_market_share": results.get("avg_market_share"),
            "confidence_interval": results.get("confidence_interval"),
            "key_insights": results.get("key_insights"),
        }

    # Run history (best-effort).
    run_history = []
    try:
        runs = await query_collection(RUNS_COLLECTION, [("simulation_id", "==", sim_id)])
        runs.sort(key=lambda r: r.get("created_at") or "", reverse=True)
        run_history = [
            {"success_probability": r.get("success_probability"),
             "avg_revenue": r.get("avg_revenue"),
             "variable_overrides": r.get("variable_overrides")}
            for r in runs[:10]
        ]
    except Exception as exc:
        logger.warning("Copilot run-history fetch failed for simulation %s: %s", sim_id, exc)

    valid_names = {v.name for v in config.variables}
    suggestions: List[dict] = []
    try:
        parsed = await llm_client.chat_json(
            messages=[{
                "role": "user",
                "content": (
                    f"Simulation: {sim.get('name', 'Simulation')} "
                    f"(category {sim.get('category')}).\n"
                    f"Variables:\n{json.dumps(variables_desc, indent=2)}\n\n"
                    f"Results summary:\n{json.dumps(results_summary, indent=2)}\n\n"
                    f"Run history:\n{json.dumps(run_history, indent=2)}"
                ),
            }],
            system=_COPILOT_SYSTEM,
            temperature=0.5,
            max_tokens=2048,
        )
        for s in (parsed.get("suggestions") or []):
            if not isinstance(s, dict):
                continue
            stype = s.get("type")
            if stype not in _VALID_COPILOT_TYPES:
                continue
            action = s.get("action") if isinstance(s.get("action"), dict) else {}
            # Drop sweep/branch actions that reference unknown variables.
            if stype == "sweep" and action.get("variable_name") not in valid_names:
                continue
            if stype == "branch":
                overrides = action.get("variable_overrides")
                if not isinstance(overrides, dict) or not (set(overrides) <= valid_names):
                    continue
            suggestions.append({
                "type": stype,
                "title": str(s.get("title") or stype.capitalize()),
                "rationale": str(s.get("rationale") or ""),
                "action": action,
            })
        suggestions = suggestions[:5]
    except Exception as exc:
        logger.warning("Copilot suggestion generation failed for simulation %s: %s", sim_id, exc)

    if len(suggestions) < 3:
        suggestions = _heuristic_suggestions(config, results)

    return {"suggestions": suggestions}


@router.post("/{sim_id}/duplicate")
async def duplicate_simulation(sim_id: str, user: dict = Depends(get_current_user)):
    sim = await _load_owned_sim(sim_id, user)

    new_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    new_sim = dict(sim)
    new_sim.pop("id", None)
    new_sim["id"] = new_id
    new_sim["name"] = f"{sim['name']} (copy)"
    new_sim["status"] = SimulationStatus.DRAFT.value
    new_sim["results"] = None
    new_sim["created_at"] = now
    new_sim["updated_at"] = now
    new_sim["run_count"] = 0
    # Scenario tree: the copy is a child of the source, inheriting its root.
    new_sim["parent_id"] = sim_id
    new_sim["root_id"] = sim.get("root_id") or sim_id
    new_sim["branch_label"] = "copy"

    db = get_db()
    await db.collection(COLLECTION).document(new_id).set(new_sim)
    return new_sim


@router.post("/{sim_id}/branch", status_code=201,
             dependencies=[Depends(require_expensive_rate_limit)])
async def branch_simulation(
    sim_id: str,
    request: BranchSimulationRequest,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
):
    """Create a child simulation that applies *variable_overrides* on top of the
    parent's config, then runs it in a tracked background task.

    The new sim's parent_id is *sim_id* and it inherits the parent's root_id.
    Pollable at GET /api/simulations/{id}/results like any run.
    """
    _validate_num_runs(request.num_runs)

    parent = await _load_owned_sim(sim_id, user)

    # Validate overrides against the parent's config, then bake them into the
    # child's config so the branch carries its scenario as a first-class sim.
    parent_config = SimulationConfig(**parent["config"])
    _validate_variable_overrides(request.variable_overrides, parent_config)

    config_dict = parent_config.model_dump()
    for var in config_dict.get("variables", []):
        if var.get("name") in request.variable_overrides:
            var["value"] = request.variable_overrides[var["name"]]
    child_config = SimulationConfig(**config_dict)

    new_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    label = _sanitize_string(request.label, _MAX_NAME_LENGTH) or "branch"
    child = {
        "id": new_id,
        "user_id": user["uid"],
        "name": f"{parent.get('name', 'Simulation')} — {label}",
        "description": parent.get("description"),
        "category": child_config.category.value,
        "config": child_config.model_dump(mode="json"),
        "status": SimulationStatus.RUNNING.value,
        "results": None,
        "created_at": now,
        "updated_at": now,
        "run_count": 0,
        "parent_id": sim_id,
        "root_id": parent.get("root_id") or sim_id,
        "branch_label": label,
    }

    db = get_db()
    await db.collection(COLLECTION).document(new_id).set(child)

    # Run exactly like the regular run path: status running -> completed,
    # results written, run history recorded. Overrides are already baked into
    # the child's config, so the engine runs the branch scenario directly.
    background_tasks.add_task(
        _execute_simulation,
        new_id,
        child_config,
        request.num_runs,
        None,
    )

    return {"simulation_id": new_id}


@router.get("/{sim_id}/tree")
async def get_simulation_tree(sim_id: str, user: dict = Depends(get_current_user)):
    """Return every owner-scoped simulation sharing this sim's root_id."""
    sim = await _load_owned_sim(sim_id, user)

    root_id = sim.get("root_id") or sim.get("id") or sim_id
    family = await query_collection(
        COLLECTION,
        [("root_id", "==", root_id), ("user_id", "==", user["uid"])],
    )

    def _to_node(s: dict) -> dict:
        return {
            "id": s.get("id"),
            "name": s.get("name"),
            "parent_id": s.get("parent_id"),
            "branch_label": s.get("branch_label"),
            "status": s.get("status"),
            "success_probability": (
                s["results"].get("success_probability")
                if isinstance(s.get("results"), dict) else None
            ),
            "created_at": s.get("created_at"),
        }

    nodes = [_to_node(s) for s in family]

    # Legacy simulations created before the scenario-tree feature have no
    # ``root_id`` field, so an equality query on root_id never matches them and
    # the root would be missing from its own tree. Ensure the entry sim is
    # always present (it's already fetched and ownership-checked above).
    if not any(n["id"] == sim.get("id") for n in nodes):
        nodes.append(_to_node(sim))

    nodes.sort(key=lambda n: n.get("created_at") or "")

    return {"root_id": root_id, "nodes": nodes}


@router.delete("/{sim_id}", status_code=204)
async def delete_simulation(sim_id: str, user: dict = Depends(get_current_user)):
    await _load_owned_sim(sim_id, user)
    await delete_document(COLLECTION, sim_id)


# ── Sensitivity analysis (variable sweep) ────────────────────────────────────

from pydantic import BaseModel, Field


class SweepRequest(BaseModel):
    variable_name: str
    min_value: float
    max_value: float
    steps: int = Field(ge=3, le=20, default=10)
    num_runs: int = Field(ge=10, le=2000, default=200)


class SweepPoint(BaseModel):
    value: float
    success_probability: float
    avg_revenue: float


@router.post("/{sim_id}/sweep", response_model=List[SweepPoint],
              dependencies=[Depends(require_expensive_rate_limit)])
async def sweep_variable(
    sim_id: str,
    request: SweepRequest,
    user: dict = Depends(get_current_user),
):
    sim = await _load_owned_sim(sim_id, user)

    config = SimulationConfig(**sim["config"])

    # Validate that variable_name exists in the config
    valid_names = {v.name for v in config.variables}
    if request.variable_name not in valid_names:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown variable '{request.variable_name}'. "
                   f"Valid variables: {sorted(valid_names)}",
        )
    step_size = (request.max_value - request.min_value) / (request.steps - 1)
    points = []

    for i in range(request.steps):
        value = request.min_value + i * step_size
        overrides = {request.variable_name: value}
        engine = SimulationEngine(config)
        results = await engine.run(num_runs=request.num_runs, variable_overrides=overrides)
        points.append(SweepPoint(
            value=round(value, 4),
            success_probability=results.success_probability,
            avg_revenue=results.avg_revenue,
        ))

    return points


# ── Tornado sensitivity analysis ─────────────────────────────────────────────

_NUMERIC_VARIABLE_TYPES = {"number", "percentage", "currency"}
_TORNADO_MAX_VARIABLES = 12


class TornadoRequest(BaseModel):
    delta_pct: float = Field(default=20, ge=5, le=50)
    num_runs: int = Field(default=200, ge=50, le=1000)


def _resolve_base_seed(sim: dict) -> int:
    """Reuse the sim's recorded base_seed when present, else generate one."""
    results = sim.get("results")
    if isinstance(results, dict) and results.get("base_seed") is not None:
        return int(results["base_seed"])
    return random.randrange(2 ** 32)


@router.post("/{sim_id}/tornado", dependencies=[Depends(require_expensive_rate_limit)])
async def tornado_analysis(
    sim_id: str,
    request: TornadoRequest,
    user: dict = Depends(get_current_user),
):
    """One-variable-at-a-time sensitivity (tornado chart).

    For each numeric variable, runs the engine at value*(1±delta) — clamped to
    the variable's min/max — with the SAME base_seed so differences are signal,
    not Monte Carlo noise. Runs sequentially to bound memory.
    """
    sim = await _load_owned_sim(sim_id, user)

    config = SimulationConfig(**sim["config"])
    numeric_vars = [
        v for v in config.variables if v.type in _NUMERIC_VARIABLE_TYPES
    ][:_TORNADO_MAX_VARIABLES]
    if not numeric_vars:
        raise HTTPException(
            status_code=422,
            detail="Simulation has no numeric variables to analyze.",
        )

    base_seed = _resolve_base_seed(sim)
    delta = request.delta_pct / 100
    engine = SimulationEngine(config)

    baseline = await engine.run(num_runs=request.num_runs, base_seed=base_seed)

    bars = []
    for v in numeric_vars:
        low_value = v.value * (1 - delta)
        high_value = v.value * (1 + delta)
        if v.min is not None:
            low_value = max(v.min, low_value)
            high_value = max(v.min, high_value)
        if v.max is not None:
            low_value = min(v.max, low_value)
            high_value = min(v.max, high_value)

        low_res = await engine.run(
            num_runs=request.num_runs,
            variable_overrides={v.name: low_value},
            base_seed=base_seed,
        )
        high_res = await engine.run(
            num_runs=request.num_runs,
            variable_overrides={v.name: high_value},
            base_seed=base_seed,
        )
        low_success = round(low_res.success_probability / 100, 4)
        high_success = round(high_res.success_probability / 100, 4)
        bars.append({
            "variable": v.name,
            "label": v.label,
            "low_value": round(low_value, 6),
            "high_value": round(high_value, 6),
            "low_success": low_success,
            "high_success": high_success,
            "impact": round(abs(high_success - low_success), 4),
        })

    bars.sort(key=lambda b: b["impact"], reverse=True)
    logger.info(
        "Tornado analysis for simulation %s: %d variables, %d runs each",
        sim_id, len(bars), request.num_runs,
    )

    return {
        "base_seed": base_seed,
        "baseline": {
            "success_probability": round(baseline.success_probability / 100, 4),
            "avg_revenue": baseline.avg_revenue,
        },
        "bars": bars,
    }


# ── Natural-language what-if analysis ────────────────────────────────────────

class WhatIfRequest(BaseModel):
    prompt: str = Field(min_length=3, max_length=500)


_WHATIF_PARSE_SYSTEM = (
    "You translate natural-language what-if scenarios into numeric overrides for "
    "simulation variables. Only use variable names from the provided list. "
    'Respond with JSON of the shape {"variable_overrides": {"<variable_name>": '
    '<new_numeric_value>}, "unparseable_parts": ["<any part of the request you '
    'could not map to a listed variable>"]}. Values must be plain numbers (no '
    "units, no strings). Interpret relative changes (e.g. 'double the price', "
    "'cut churn by half') against the variable's current value."
)


@router.post("/{sim_id}/whatif", dependencies=[Depends(require_expensive_rate_limit)])
async def whatif_analysis(
    sim_id: str,
    request: WhatIfRequest,
    user: dict = Depends(get_current_user),
):
    """Parse a natural-language what-if prompt and run a paired comparison.

    Baseline and what-if runs share the SAME base_seed so the deltas are
    signal rather than Monte Carlo noise.
    """
    sim = await _load_owned_sim(sim_id, user)

    config = SimulationConfig(**sim["config"])
    variables_desc = [
        {
            "name": v.name,
            "label": v.label,
            "current_value": v.value,
            "min": v.min,
            "max": v.max,
            "unit": v.unit,
        }
        for v in config.variables
    ]

    try:
        parsed_raw = await llm_client.chat_json(
            messages=[{
                "role": "user",
                "content": (
                    f"Simulation variables:\n{json.dumps(variables_desc, indent=2)}\n\n"
                    f"What-if request: {request.prompt}"
                ),
            }],
            system=_WHATIF_PARSE_SYSTEM,
            temperature=0.2,
            max_tokens=1024,
        )
    except Exception as exc:
        logger.warning("What-if prompt parsing failed for simulation %s: %s", sim_id, exc)
        raise HTTPException(
            status_code=502,
            detail="What-if parsing is temporarily unavailable. Please try again.",
        )

    valid_names = {v.name for v in config.variables}
    overrides: Dict[str, float] = {}
    unparseable = [str(p) for p in (parsed_raw.get("unparseable_parts") or [])]
    for key, value in (parsed_raw.get("variable_overrides") or {}).items():
        try:
            if key in valid_names:
                overrides[key] = float(value)
            else:
                unparseable.append(f"{key}={value}")
        except (TypeError, ValueError):
            unparseable.append(f"{key}={value}")

    if not overrides:
        raise HTTPException(
            status_code=422,
            detail="No variable changes could be parsed from the prompt. "
                   "Try referencing specific simulation variables.",
        )

    base_seed = _resolve_base_seed(sim)
    n = min(config.num_runs, 1000)
    engine = SimulationEngine(config)

    baseline_res = await engine.run(num_runs=n, base_seed=base_seed)
    whatif_res = await engine.run(
        num_runs=n, variable_overrides=overrides, base_seed=base_seed
    )

    baseline = {
        "success_probability": baseline_res.success_probability,
        "avg_revenue": baseline_res.avg_revenue,
        "avg_time_to_breakeven": baseline_res.avg_breakeven_month,
    }
    whatif = {
        "success_probability": whatif_res.success_probability,
        "avg_revenue": whatif_res.avg_revenue,
        "avg_time_to_breakeven": whatif_res.avg_breakeven_month,
    }
    deltas = {
        "success_probability_pp": round(
            whatif_res.success_probability - baseline_res.success_probability, 2
        ),
        "avg_revenue": round(whatif_res.avg_revenue - baseline_res.avg_revenue, 2),
        "avg_time_to_breakeven": round(
            whatif_res.avg_breakeven_month - baseline_res.avg_breakeven_month, 2
        ),
    }

    # One-sentence verdict (LLM, with deterministic template fallback).
    pp = deltas["success_probability_pp"]
    if pp > 0:
        fallback_verdict = (
            f"This scenario raises the success probability from "
            f"{baseline['success_probability']:.1f}% to {whatif['success_probability']:.1f}% "
            f"({pp:+.1f} pp) and shifts average revenue by {deltas['avg_revenue']:+,.0f}."
        )
    elif pp < 0:
        fallback_verdict = (
            f"This scenario lowers the success probability from "
            f"{baseline['success_probability']:.1f}% to {whatif['success_probability']:.1f}% "
            f"({pp:+.1f} pp) and shifts average revenue by {deltas['avg_revenue']:+,.0f}."
        )
    else:
        fallback_verdict = (
            f"This scenario leaves the success probability unchanged at "
            f"{whatif['success_probability']:.1f}%, with average revenue shifting by "
            f"{deltas['avg_revenue']:+,.0f}."
        )

    verdict = fallback_verdict
    try:
        verdict_resp = await llm_client.chat(
            messages=[{
                "role": "user",
                "content": (
                    f"Baseline simulation: success {baseline['success_probability']:.1f}%, "
                    f"avg revenue {baseline['avg_revenue']:,.0f}, "
                    f"breakeven month {baseline['avg_time_to_breakeven']:.1f}. "
                    f"What-if scenario ({overrides}): success {whatif['success_probability']:.1f}%, "
                    f"avg revenue {whatif['avg_revenue']:,.0f}, "
                    f"breakeven month {whatif['avg_time_to_breakeven']:.1f}. "
                    "In ONE sentence, state the practical takeaway of this comparison."
                ),
            }],
            temperature=0.4,
            max_tokens=150,
        )
        if verdict_resp.text.strip():
            verdict = verdict_resp.text.strip()
    except Exception as exc:
        logger.warning("What-if verdict generation failed for simulation %s: %s", sim_id, exc)

    return {
        "parsed": {
            "variable_overrides": overrides,
            "unparseable_parts": unparseable,
        },
        "baseline": baseline,
        "whatif": whatif,
        "deltas": deltas,
        "verdict": verdict,
    }


# ── Bayesian-flavored calibration (fit variables to historical data) ─────────

class CalibrateRequest(BaseModel):
    # column name -> observed historical series (from /api/upload/parse output).
    observed: Dict[str, List[float]]
    # optional: observed column name -> sim variable name. When absent we
    # fuzzy-match by name (case/whitespace/separator-insensitive).
    mapping: Optional[Dict[str, str]] = None


class CalibrateApplyRequest(BaseModel):
    # variable_name -> posterior_value to write into the config.
    posteriors: Dict[str, float]


def _validate_observed_series(observed: Dict[str, List[float]]) -> None:
    """422 unless every observed series is numeric & non-empty."""
    if not observed:
        raise HTTPException(
            status_code=422, detail="observed must contain at least one column."
        )
    for col, series in observed.items():
        if not isinstance(series, list) or len(series) == 0:
            raise HTTPException(
                status_code=422,
                detail=f"Observed series for column '{col}' must be a non-empty list.",
            )
        for v in series:
            # bool is an int subclass but is not a meaningful numeric series value;
            # NaN/inf pass isinstance(float) but would poison the posterior + score.
            if (
                isinstance(v, bool)
                or not isinstance(v, (int, float))
                or not math.isfinite(v)
            ):
                raise HTTPException(
                    status_code=422,
                    detail=f"Observed series for column '{col}' must be finite numeric values.",
                )


@router.post("/{sim_id}/calibrate", dependencies=[Depends(require_expensive_rate_limit)])
async def calibrate_simulation(
    sim_id: str,
    request: CalibrateRequest,
    user: dict = Depends(get_current_user),
):
    """Calibrate engine variables against a user's observed historical data.

    Resolves the column->variable mapping (explicit, else fuzzy name match),
    validates the observed series (numeric & non-empty -> 422), then runs a
    LIGHTWEIGHT moment-matching Bayesian update (conjugate-normal posterior of
    the variable's current value as prior vs. the observed mean/std/n). Adds a
    one-paragraph plain-English summary (LLM, deterministic template fallback).

    Honest framing: this is NOT MCMC and does NOT invert the simulation's
    forward map — posteriors are a precision-weighted nudge toward the data.
    Owner-scoped, expensive. 404 if the sim is missing.
    """
    _validate_observed_series(request.observed)

    sim = await _load_owned_sim(sim_id, user)

    config = SimulationConfig(**sim["config"])
    config_variables = [
        {"name": v.name, "label": v.label, "value": v.value}
        for v in config.variables
    ]

    calibrated, score, unmatched = run_calibration(
        config_variables, request.observed, request.mapping
    )

    method = "moment-matching + conjugate-normal posterior (lightweight Bayesian)"

    # One-paragraph summary (LLM with deterministic template fallback).
    moved = [c for c in calibrated if abs(c.shift_pct) >= 0.5]
    if calibrated:
        biggest = max(calibrated, key=lambda c: abs(c.shift_pct))
        fallback_summary = (
            f"Calibrating against your data adjusted {len(calibrated)} variable(s) "
            f"with a calibration score of {score:.0f}/100. "
            + (
                f"The largest shift was {biggest.label}, moving "
                f"{biggest.shift_pct:+.1f}% from {biggest.prior_value:g} toward the "
                f"observed mean of {biggest.observed_summary['mean']:g}. "
                if moved else
                "No variable moved materially — your priors already matched the data. "
            )
            + "This is a lightweight moment-matching Bayesian update, not full MCMC."
        )
    else:
        fallback_summary = (
            "No observed columns could be matched to simulation variables, so no "
            "calibration was performed. Provide a mapping or rename columns to match "
            "variable names."
        )

    summary = fallback_summary
    try:
        summary_resp = await llm_client.chat(
            messages=[{
                "role": "user",
                "content": (
                    f"A simulation's variables were calibrated against observed "
                    f"historical data using a lightweight conjugate-normal Bayesian "
                    f"update (moment matching, NOT MCMC). Calibration score: "
                    f"{score:.0f}/100. Results: "
                    f"{json.dumps([c.to_dict() for c in calibrated])}. "
                    f"Unmatched columns: {unmatched}. "
                    "In ONE plain-English paragraph, summarize what the data implies "
                    "about these variables and how confident we should be. Be honest "
                    "that this is a lightweight fit, not a rigorous MCMC posterior."
                ),
            }],
            temperature=0.4,
            max_tokens=300,
        )
        if summary_resp.text.strip():
            summary = summary_resp.text.strip()
    except Exception as exc:
        logger.warning("Calibration summary generation failed for simulation %s: %s", sim_id, exc)

    return {
        "calibrated": [c.to_dict() for c in calibrated],
        "calibration_score": score,
        "unmatched_columns": unmatched,
        "method": method,
        "summary": summary,
    }


@router.post("/{sim_id}/calibrate/apply")
async def apply_calibration(
    sim_id: str,
    request: CalibrateApplyRequest,
    user: dict = Depends(get_current_user),
):
    """Write calibrated posterior values into the simulation's config.

    Validates that every posterior key matches a config variable name (422 on
    unknown), then updates each matching variable's ``value`` to its posterior
    and bumps ``updated_at``. Status is left as-is. Owner-scoped. Returns
    {simulation_id}.
    """
    sim = await _load_owned_sim(sim_id, user)

    config = SimulationConfig(**sim["config"])
    valid_names = {v.name for v in config.variables}
    invalid = set(request.posteriors) - valid_names
    if invalid:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown posterior keys: {sorted(invalid)}. "
                   f"Valid variable names are: {sorted(valid_names)}",
        )

    # Write posteriors into the config variables, then persist the full config.
    config_dict = config.model_dump(mode="json")
    for var in config_dict.get("variables", []):
        if var.get("name") in request.posteriors:
            var["value"] = float(request.posteriors[var["name"]])

    await update_document(COLLECTION, sim_id, {
        "config": config_dict,
        "updated_at": datetime.utcnow().isoformat(),
    })

    return {"simulation_id": sim_id}


# ── Counterfactual diff (generalized paired-seed comparison) ─────────────────

class DiffRequest(BaseModel):
    # Direct numeric overrides (NOT a natural-language prompt). Keys are
    # validated against the config's variable names (422 on unknown key).
    variable_overrides: Dict[str, float] = Field(default_factory=dict)


def _risk_name_severity(results) -> Dict[str, str]:
    """Map each risk-factor name to its severity from a SimulationResults."""
    out: Dict[str, str] = {}
    for rf in results.risk_factors:
        # rf is a RiskFactor model with .name / .severity attributes.
        out[rf.name] = rf.severity
    return out


@router.post("/{sim_id}/diff", dependencies=[Depends(require_expensive_rate_limit)])
async def counterfactual_diff(
    sim_id: str,
    request: DiffRequest,
    user: dict = Depends(get_current_user),
):
    """Counterfactual diff: a paired-seed baseline vs. override comparison.

    Generalizes the what-if endpoint but takes DIRECT numeric overrides instead
    of a natural-language prompt. Baseline and counterfactual runs share the
    SAME base_seed (reused from the sim's recorded results when present) so the
    deltas are signal, not Monte Carlo noise. Adds per-month revenue deltas and
    the set-difference of risk-factor names, plus a one-paragraph LLM
    explanation (deterministic template fallback). Owner-scoped, expensive.
    """
    sim = await _load_owned_sim(sim_id, user)

    config = SimulationConfig(**sim["config"])
    overrides = {k: float(v) for k, v in request.variable_overrides.items()}
    # 422 on any override key that is not a known variable name.
    _validate_variable_overrides(overrides, config)
    if not overrides:
        raise HTTPException(
            status_code=422,
            detail="variable_overrides must contain at least one variable.",
        )

    base_seed = _resolve_base_seed(sim)
    n = min(config.num_runs, 1000)
    engine = SimulationEngine(config)

    baseline_res = await engine.run(num_runs=n, base_seed=base_seed)
    cf_res = await engine.run(
        num_runs=n, variable_overrides=overrides, base_seed=base_seed
    )

    baseline = {
        "success_probability": baseline_res.success_probability,
        "avg_revenue": baseline_res.avg_revenue,
        "avg_market_share": baseline_res.avg_market_share,
        "avg_time_to_breakeven": baseline_res.avg_breakeven_month,
    }
    counterfactual = {
        "success_probability": cf_res.success_probability,
        "avg_revenue": cf_res.avg_revenue,
        "avg_market_share": cf_res.avg_market_share,
        "avg_time_to_breakeven": cf_res.avg_breakeven_month,
    }
    deltas = {
        "success_probability_pp": round(
            cf_res.success_probability - baseline_res.success_probability, 2
        ),
        "avg_revenue": round(cf_res.avg_revenue - baseline_res.avg_revenue, 2),
        "avg_market_share": round(
            cf_res.avg_market_share - baseline_res.avg_market_share, 4
        ),
        "avg_time_to_breakeven": round(
            cf_res.avg_breakeven_month - baseline_res.avg_breakeven_month, 2
        ),
    }

    # Per-timeline-point revenue delta: zip the two aggregated timelines by month.
    base_tl = {pt["month"]: pt.get("avg_revenue", 0.0) for pt in baseline_res.timeline_aggregated}
    cf_tl = {pt["month"]: pt.get("avg_revenue", 0.0) for pt in cf_res.timeline_aggregated}
    timeline_delta = []
    for month in sorted(set(base_tl) | set(cf_tl)):
        b_rev = float(base_tl.get(month, 0.0))
        c_rev = float(cf_tl.get(month, 0.0))
        timeline_delta.append({
            "month": month,
            "baseline_revenue": round(b_rev, 2),
            "counterfactual_revenue": round(c_rev, 2),
            "delta": round(c_rev - b_rev, 2),
        })

    # Risk-factor set difference by name (appeared = in CF not baseline, etc.).
    base_risks = _risk_name_severity(baseline_res)
    cf_risks = _risk_name_severity(cf_res)
    appeared = [
        {"name": name, "severity": cf_risks[name]}
        for name in cf_risks if name not in base_risks
    ]
    disappeared = [
        {"name": name, "severity": base_risks[name]}
        for name in base_risks if name not in cf_risks
    ]
    risk_changes = {"appeared": appeared, "disappeared": disappeared}

    # One-paragraph plain-English attribution (LLM, template fallback).
    pp = deltas["success_probability_pp"]
    direction = "raises" if pp > 0 else ("lowers" if pp < 0 else "leaves unchanged")
    fallback_explanation = (
        f"Applying {overrides} {direction} the success probability from "
        f"{baseline['success_probability']:.1f}% to "
        f"{counterfactual['success_probability']:.1f}% ({pp:+.1f} pp), with average "
        f"revenue shifting by {deltas['avg_revenue']:+,.0f} and average market share "
        f"by {deltas['avg_market_share']:+.3f}. "
        + (
            f"New risks appeared: {', '.join(r['name'] for r in appeared)}. "
            if appeared else ""
        )
        + (
            f"Risks dropped out: {', '.join(r['name'] for r in disappeared)}. "
            if disappeared else ""
        )
    ).strip()

    explanation = fallback_explanation
    try:
        exp_resp = await llm_client.chat(
            messages=[{
                "role": "user",
                "content": (
                    f"A Monte Carlo simulation was compared against a counterfactual "
                    f"with these direct variable overrides: {json.dumps(overrides)}. "
                    f"Baseline: success {baseline['success_probability']:.1f}%, "
                    f"avg revenue {baseline['avg_revenue']:,.0f}, "
                    f"avg market share {baseline['avg_market_share']:.3f}, "
                    f"breakeven month {baseline['avg_time_to_breakeven']:.1f}. "
                    f"Counterfactual: success {counterfactual['success_probability']:.1f}%, "
                    f"avg revenue {counterfactual['avg_revenue']:,.0f}, "
                    f"avg market share {counterfactual['avg_market_share']:.3f}, "
                    f"breakeven month {counterfactual['avg_time_to_breakeven']:.1f}. "
                    f"Risks that newly appeared: {[r['name'] for r in appeared]}. "
                    f"Risks that dropped out: {[r['name'] for r in disappeared]}. "
                    "In ONE plain-English paragraph, attribute these changes to the "
                    "overrides and state the practical takeaway."
                ),
            }],
            temperature=0.4,
            max_tokens=300,
        )
        if exp_resp.text.strip():
            explanation = exp_resp.text.strip()
    except Exception as exc:
        logger.warning("Diff explanation generation failed for simulation %s: %s", sim_id, exc)

    return {
        "base_seed": base_seed,
        "baseline": baseline,
        "counterfactual": counterfactual,
        "deltas": deltas,
        "timeline_delta": timeline_delta,
        "risk_changes": risk_changes,
        "explanation": explanation,
    }


# ── Per-run explainer (why a percentile path went the way it did) ────────────

_EXPLAIN_PERCENTILES = {"p10": 10, "p50": 50, "p90": 90}

_EXPLAIN_SYSTEM = (
    "You explain why a single Monte Carlo simulation path ended where it did. "
    "Given the path's outcome and a short list of its largest-magnitude agent "
    "events, write a concise narrative (2-4 sentences) attributing the outcome "
    "to those pivotal events. Use the agent names/types provided; do not invent "
    'agents or numbers. Respond with JSON of the shape {"narrative": "<text>", '
    '"pivotal_events": [{"t": <step>, "why": "<one short clause>"}]}, where each '
    "why explains that event's role. Keep it grounded in the data."
)


def _explain_pivotal_events(replay: dict, top_k: int = 5) -> List[dict]:
    """Deterministically extract the largest-magnitude agent events from a path.

    Scans every captured tick's events and ranks them by absolute value, then
    returns the top-K as ``{t, agent_type, action, value, why}`` (``why`` is a
    template placeholder the LLM may overwrite).
    """
    name_by_id = {a["id"]: a.get("name") or a.get("type") for a in replay.get("agents", [])}
    candidates = []
    for tick in replay.get("ticks", []):
        for ev in tick.get("events", []):
            candidates.append({
                "t": tick["t"],
                "agent_id": ev.get("agent_id"),
                "agent_type": ev.get("agent_type", "agent"),
                "action": ev.get("action", "act"),
                "value": float(ev.get("value", 0.0)),
            })
    candidates.sort(key=lambda e: abs(e["value"]), reverse=True)
    pivotal = []
    for c in candidates[:top_k]:
        who = name_by_id.get(c["agent_id"], c["agent_type"])
        pivotal.append({
            "t": c["t"],
            "agent_type": c["agent_type"],
            "action": c["action"],
            "value": round(c["value"], 4),
            "why": f"{who} {c['action']} ({c['value']:g}) at step {c['t']}.",
        })
    return pivotal


@router.get("/{sim_id}/explain", dependencies=[Depends(require_expensive_rate_limit)])
async def explain_path(
    sim_id: str,
    percentile: str = "p50",
    user: dict = Depends(get_current_user),
):
    """Explain why a percentile path (p10/p50/p90) went the way it did.

    Path 0 (driven by base_seed) is the median-ish path used for p50. For
    p10/p90 we scan a modest sample of path indices, compute each path's final
    revenue deterministically from base_seed, then pick the path whose final
    revenue is nearest the requested percentile of that sample. We replay that
    path with an EventSink, deterministically extract the largest-magnitude
    agent events as pivotal events, then make ONE llm_client.chat_json call to
    narrate "why" (template fallback). Owner-scoped, expensive. 404 if no
    results.
    """
    if percentile not in _EXPLAIN_PERCENTILES:
        raise HTTPException(
            status_code=422,
            detail=f"percentile must be one of {sorted(_EXPLAIN_PERCENTILES)}.",
        )

    sim = await _load_owned_sim(sim_id, user)

    results = sim.get("results")
    if not isinstance(results, dict):
        raise HTTPException(status_code=404, detail="Simulation has no results yet")

    config = SimulationConfig(**sim["config"])
    base_seed = _resolve_base_seed(sim)
    engine = SimulationEngine(config)

    target_pct = _EXPLAIN_PERCENTILES[percentile]

    if percentile == "p50":
        # Path 0 is the canonical median-ish path captured by base_seed.
        chosen_index = 0
    else:
        # Scan a modest sample of single paths, computing each one's final
        # revenue deterministically (same RNG as the Monte Carlo loop), then
        # pick the path nearest the requested percentile of that sample.
        sample_size = min(50, max(10, config.num_runs))
        finals = []
        for idx in range(sample_size):
            single = engine._run_single(None, random.Random(base_seed + idx))
            finals.append((idx, float(single.get("final_revenue", 0.0))))
        revenues = sorted(v for _, v in finals)
        pct_value = float(np.percentile(revenues, target_pct))
        chosen_index = min(finals, key=lambda iv: abs(iv[1] - pct_value))[0]

    replay = engine.replay_path(base_seed, path_index=chosen_index)
    seed_used = base_seed + chosen_index
    # Re-derive the outcome deterministically from the same path. Report the
    # engine's own final_revenue (the SAME metric the percentile path was
    # selected by) rather than the replay's last-tick revenue — those differ
    # for the trend (always) and biology (when sim_steps isn't a clean multiple
    # of the period) domains, where the tick metric is a different quantity.
    single_for_outcome = engine._run_single(None, random.Random(seed_used))
    outcome = {
        "success": bool(single_for_outcome.get("success", False)),
        "final_revenue": round(float(single_for_outcome.get("final_revenue", 0.0)), 2),
    }

    pivotal_events = _explain_pivotal_events(replay)

    fallback_narrative = (
        f"The {percentile} path ended {'successfully' if outcome['success'] else 'short of target'} "
        f"with final revenue {outcome['final_revenue']:,.0f}. "
        + (
            "Key moves: " + "; ".join(
                f"{e['agent_type']} {e['action']} ({e['value']:g}) at step {e['t']}"
                for e in pivotal_events[:3]
            ) + "."
            if pivotal_events else
            "No standout agent actions were captured on this path."
        )
    )

    narrative = fallback_narrative
    try:
        parsed = await llm_client.chat_json(
            messages=[{
                "role": "user",
                "content": (
                    f"Simulation: {sim.get('name', 'Simulation')} "
                    f"(category {sim.get('category')}). "
                    f"This is the {percentile} path. Outcome: "
                    f"{'success' if outcome['success'] else 'failure'}, final revenue "
                    f"{outcome['final_revenue']:,.0f}.\n"
                    f"Largest-magnitude agent events:\n{json.dumps(pivotal_events)}"
                ),
            }],
            system=_EXPLAIN_SYSTEM,
            temperature=0.4,
            max_tokens=600,
        )
        narr = parsed.get("narrative")
        if isinstance(narr, str) and narr.strip():
            narrative = narr.strip()
        # Let the LLM enrich each pivotal event's "why" by index, when provided.
        llm_pivotal = parsed.get("pivotal_events")
        if isinstance(llm_pivotal, list):
            for i, item in enumerate(llm_pivotal):
                if i < len(pivotal_events) and isinstance(item, dict) and item.get("why"):
                    pivotal_events[i]["why"] = str(item["why"])
    except Exception as exc:
        logger.warning("Path explanation generation failed for simulation %s: %s", sim_id, exc)

    return {
        "percentile": percentile,
        "seed_used": seed_used,
        "outcome": outcome,
        "pivotal_events": pivotal_events,
        "narrative": narrative,
    }


# ── Hero run (one LLM-in-the-loop explanatory path) ──────────────────────────

class HeroRunRequest(BaseModel):
    """Body for POST /{sim_id}/hero-run.

    ``max_decisions`` is the HARD cap on total LLM decision calls across the whole
    run (cost bound). ``base_seed`` reuses the sim's recorded base_seed when
    omitted (else a fresh one), and is echoed in the response.
    """
    max_decisions: int = Field(default=DEFAULT_DECISIONS, ge=MIN_DECISIONS, le=MAX_DECISIONS)
    base_seed: Optional[int] = None


_HERO_NARRATIVE_SYSTEM = (
    "You are a narrator wrapping up a single 'hero run' of a multi-agent business "
    "simulation: one illustrative path where a few influential agents made real "
    "LLM-driven decisions (the rest of the path is formula-driven and seeded). "
    "Given the per-step decisions and the final outcome, write ONE short paragraph "
    "(3-5 sentences) describing the arc and the role those decisions played. Be "
    "honest that this is one illustrative path, not a statistical result. Respond "
    'with JSON of the shape {"narrative": "<one paragraph>"}.'
)


def _hero_fallback_narrative(payload: dict) -> str:
    """Deterministic templated wrap-up when the LLM is unavailable."""
    outcome = payload.get("outcome", {})
    decisions = payload.get("decisions", [])
    time_unit = payload.get("time_unit", "month")
    n_steps = len(payload.get("timeline", []))
    final_rev = float(outcome.get("final_revenue", 0.0))
    verb = "reached its target" if outcome.get("success") else "fell short of target"
    if decisions:
        moves = "; ".join(
            f"{d.get('agent_name', d.get('agent_type', 'agent'))} chose to "
            f"{str(d.get('decision', 'hold')).replace('_', ' ')} at {time_unit} {d.get('t')}"
            for d in decisions[:4]
        )
        body = f"Across {n_steps} {time_unit}s, key moves: {moves}. "
    else:
        body = (
            f"Across {n_steps} {time_unit}s no LLM decisions were applied "
            "(budget unused or the model was unavailable), so the path ran on the "
            "formula alone. "
        )
    return (
        body
        + f"The path {verb} with final revenue {final_rev:,.0f}. "
        "This is one illustrative LLM-in-the-loop path, not a statistical result — "
        "the formula parts are seeded and reproducible, but the LLM decisions are not."
    )


@router.post("/{sim_id}/hero-run", dependencies=[Depends(require_expensive_rate_limit)])
async def hero_run(
    sim_id: str,
    request: HeroRunRequest,
    user: dict = Depends(get_current_user),
):
    """Run ONE LLM-in-the-loop 'hero' path for a simulation.

    A hero run is a SINGLE deterministic-seed path where, at a few KEY decision
    ticks (and only while budget remains), the most influential agent makes an
    actual Claude decision grounded in its persona + the compact market snapshot,
    instead of the hardcoded formula. Every other tick uses the normal formula,
    so the path stays seeded APART FROM the handful of LLM decisions.

    This is NOT the 1000-path Monte Carlo (which stays formula-based and fast) —
    it is one illustrative, budget-capped explanatory path. ``max_decisions``
    (1-12) HARD-caps total LLM decision calls. Each LLM call is wrapped so a
    failure falls back to the formula (never a 500, never NaN/inf). ONE extra LLM
    call narrates the wrap-up (deterministic template fallback). Owner-scoped,
    expensive. 404 missing, 403 not owner, 409 if the sim has no config.
    """
    sim = await _load_owned_sim(sim_id, user)

    raw_config = sim.get("config")
    if not isinstance(raw_config, dict) or not raw_config:
        raise HTTPException(status_code=409, detail="Simulation has no config to run")
    try:
        config = SimulationConfig(**raw_config)
    except Exception as exc:
        logger.warning("Hero-run config invalid for simulation %s: %s", sim_id, exc)
        raise HTTPException(status_code=409, detail="Simulation has no config to run")

    base_seed = int(request.base_seed) if request.base_seed is not None else _resolve_base_seed(sim)

    runner = HeroRunner(config, llm_client)
    payload = await runner.run(base_seed=base_seed, max_decisions=request.max_decisions)

    # ONE narration call to wrap up the path (deterministic template fallback).
    narrative = _hero_fallback_narrative(payload)
    try:
        parsed = await llm_client.chat_json(
            messages=[{
                "role": "user",
                "content": (
                    f"Simulation: {sim.get('name', 'Simulation')} "
                    f"(category {sim.get('category')}, time unit {payload.get('time_unit')}).\n"
                    f"Outcome: {json.dumps(payload.get('outcome'))}.\n"
                    f"Decisions made ({payload.get('decisions_used')} of "
                    f"{payload.get('decisions_budget')} budget):\n"
                    f"{json.dumps(payload.get('decisions'))}"
                ),
            }],
            system=_HERO_NARRATIVE_SYSTEM,
            temperature=0.5,
            max_tokens=600,
        )
        narr = parsed.get("narrative") if isinstance(parsed, dict) else None
        if isinstance(narr, str) and narr.strip():
            narrative = narr.strip()
    except Exception as exc:
        logger.warning("Hero-run narrative generation failed for simulation %s: %s", sim_id, exc)

    logger.info(
        "Hero run for simulation %s: %d/%d LLM decisions used over %d steps",
        sim_id, payload.get("decisions_used", 0), payload.get("decisions_budget", 0),
        len(payload.get("timeline", [])),
    )

    payload["narrative"] = narrative
    return payload


# ── Run history ──────────────────────────────────────────────────────────────

@router.get("/{sim_id}/runs")
async def list_simulation_runs(sim_id: str, user: dict = Depends(get_current_user)):
    """Run history for a simulation — newest first, capped at 50."""
    await _load_owned_sim(sim_id, user)

    runs = await query_collection(RUNS_COLLECTION, [("simulation_id", "==", sim_id)])
    runs.sort(key=lambda r: r.get("created_at") or "", reverse=True)
    return {
        "runs": [
            {
                "run_id": r.get("id"),
                "created_at": r.get("created_at"),
                "num_runs": r.get("num_runs"),
                "success_probability": r.get("success_probability"),
                "avg_revenue": r.get("avg_revenue"),
                "variable_overrides": r.get("variable_overrides"),
            }
            for r in runs[:50]
        ]
    }


# ── Simulation comparison ────────────────────────────────────────────────────

class CompareRequest(BaseModel):
    simulation_ids: List[str] = Field(min_length=2, max_length=10)


@router.post("/compare")
async def compare_simulations(request: CompareRequest, user: dict = Depends(get_current_user)):
    comparisons = []
    for sid in request.simulation_ids:
        sim = await get_document(COLLECTION, sid)
        if not sim:
            raise HTTPException(status_code=404, detail=f"Simulation {sid} not found")
        if sim.get("user_id") != user["uid"]:
            raise HTTPException(status_code=403, detail=f"Not authorized for simulation {sid}")
        results = sim.get("results")
        comparisons.append({
            "id": sid,
            "name": sim.get("name"),
            "category": sim.get("category"),
            "status": sim.get("status"),
            "success_probability": results.get("success_probability") if results else None,
            "avg_revenue": results.get("avg_revenue") if results else None,
            "avg_market_share": results.get("avg_market_share") if results else None,
            "confidence_interval": results.get("confidence_interval") if results else None,
            "risk_factors": results.get("risk_factors") if results else None,
            "key_insights": results.get("key_insights") if results else None,
        })
    return {"comparisons": comparisons}


# ── Simulation import ────────────────────────────────────────────────────────

class SimulationImport(BaseModel):
    config: dict
    name: Optional[str] = None


@router.post("/import", response_model=dict, status_code=201)
async def import_simulation(payload: SimulationImport, user: dict = Depends(get_current_user)):
    try:
        config = SimulationConfig(**payload.config)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Invalid simulation config: {e}")

    # Sanitize imported strings
    config.name = _sanitize_string(config.name, _MAX_NAME_LENGTH) or "Untitled"
    config.description = _sanitize_string(config.description, _MAX_DESCRIPTION_LENGTH)

    sim_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    imported_name = _sanitize_string(payload.name, _MAX_NAME_LENGTH) if payload.name else None
    sim = {
        "id": sim_id,
        "user_id": user["uid"],
        "name": imported_name or config.name,
        "description": config.description,
        "category": config.category.value,
        "config": config.model_dump(mode="json"),
        "status": SimulationStatus.DRAFT.value,
        "results": None,
        "created_at": now,
        "updated_at": now,
        "run_count": 0,
    }

    db = get_db()
    await db.collection(COLLECTION).document(sim_id).set(sim)
    return sim


# ── Multi-objective Pareto optimizer ─────────────────────────────────────────

class OptimizeObjective(BaseModel):
    metric: str
    direction: str


class OptimizeRequest(BaseModel):
    objectives: List[OptimizeObjective] = Field(default_factory=list)
    variables: Optional[List[str]] = None
    budget: int = Field(default=60, ge=10, le=200)
    runs_per_candidate: int = Field(default=100, ge=20, le=500)


# Cap on simultaneous candidate evaluations to bound memory/CPU.
_OPTIMIZE_MAX_CONCURRENCY = 8


@router.post("/{sim_id}/optimize", dependencies=[Depends(require_expensive_rate_limit)])
async def optimize_simulation(
    sim_id: str,
    request: OptimizeRequest,
    user: dict = Depends(get_current_user),
):
    """Multi-objective Pareto optimizer over the simulation's variable space.

    Draws ``budget`` candidate configurations via seeded Latin-Hypercube sampling
    of the chosen variables' [min, max] boxes, evaluates each with a LOW number of
    Monte Carlo runs under a SHARED base_seed (common random numbers, so the
    comparison between candidates is signal not noise), then computes the
    direction-aware Pareto-non-dominated frontier and a knee point
    (closest-to-ideal on normalized objectives).

    Honest framing: this is an APPROXIMATION — a budgeted LHS sample evaluated at
    low N. Validate frontier members / the knee point with a full run. Owner-scoped,
    expensive.
    """
    # ── Validate objectives ──────────────────────────────────────────────
    objectives = request.objectives
    if not objectives or len(objectives) > 4:
        raise HTTPException(
            status_code=422,
            detail="objectives must contain between 1 and 4 entries.",
        )
    for obj in objectives:
        if obj.metric not in optimizer.VALID_OBJECTIVE_METRICS:
            raise HTTPException(
                status_code=422,
                detail=f"Invalid objective metric '{obj.metric}'. "
                       f"Valid metrics: {sorted(optimizer.VALID_OBJECTIVE_METRICS)}",
            )
        if obj.direction not in optimizer.VALID_DIRECTIONS:
            raise HTTPException(
                status_code=422,
                detail=f"Invalid direction '{obj.direction}'. "
                       f"Valid directions: {sorted(optimizer.VALID_DIRECTIONS)}",
            )

    sim = await _load_owned_sim(sim_id, user)

    config = SimulationConfig(**sim["config"])

    # ── Resolve searchable variables (chosen, else all numeric w/ both bounds) ──
    def _searchable(v) -> bool:
        return (
            v.type in _NUMERIC_VARIABLE_TYPES
            and v.min is not None
            and v.max is not None
            and v.max > v.min
        )

    by_name = {v.name: v for v in config.variables}
    if request.variables:
        invalid = [n for n in request.variables if n not in by_name]
        if invalid:
            raise HTTPException(
                status_code=422,
                detail=f"Unknown variable(s): {sorted(invalid)}. "
                       f"Valid variables: {sorted(by_name)}",
            )
        searchable_vars = [by_name[n] for n in request.variables if _searchable(by_name[n])]
    else:
        searchable_vars = [v for v in config.variables if _searchable(v)]

    if not searchable_vars:
        raise HTTPException(
            status_code=422,
            detail="No searchable variables (numeric with both min and max bounds).",
        )

    # ── Shared base_seed for fair (common-random-number) comparison ──────
    base_seed = _resolve_base_seed(sim)
    budget = request.budget
    runs = request.runs_per_candidate

    # ── Draw candidates via Latin-Hypercube ──────────────────────────────
    overrides_list = optimizer.latin_hypercube(searchable_vars, budget, base_seed)

    engine = SimulationEngine(config)

    def _finite(x: float) -> float:
        # Any non-finite metric (NaN/inf) would poison Pareto dominance + the
        # knee-point math and serialize as invalid-JSON `NaN`. Coerce to 0.
        xf = float(x)
        return xf if math.isfinite(xf) else 0.0

    async def _evaluate(overrides: Dict[str, float]):
        results = await engine.run(
            num_runs=runs, variable_overrides=overrides, base_seed=base_seed
        )
        return {
            "success_probability": _finite(results.success_probability),
            "avg_revenue": _finite(results.avg_revenue),
            "avg_market_share": _finite(results.avg_market_share),
            "avg_breakeven_month": _finite(results.avg_breakeven_month),
        }

    # Bounded concurrency: evaluate candidates in modest batches so we never
    # spawn more than _OPTIMIZE_MAX_CONCURRENCY engine runs at once.
    metrics_list: List[Dict[str, float]] = []
    for i in range(0, len(overrides_list), _OPTIMIZE_MAX_CONCURRENCY):
        chunk = overrides_list[i:i + _OPTIMIZE_MAX_CONCURRENCY]
        chunk_metrics = await asyncio.gather(*[_evaluate(o) for o in chunk])
        metrics_list.extend(chunk_metrics)

    candidates = []
    for idx, (overrides, metrics) in enumerate(zip(overrides_list, metrics_list)):
        candidates.append({
            "id": idx,
            "overrides": {k: round(float(v), 6) for k, v in overrides.items()},
            "metrics": {k: round(float(val), 6) for k, val in metrics.items()},
            "on_frontier": False,
        })

    objectives_payload = [{"metric": o.metric, "direction": o.direction} for o in objectives]

    frontier_ids = optimizer.pareto_frontier(candidates, objectives_payload)
    for cand in candidates:
        cand["on_frontier"] = cand["id"] in frontier_ids

    frontier_cands = [c for c in candidates if c["id"] in frontier_ids]
    knee = optimizer.knee_point(frontier_cands, objectives_payload)

    # Frontier ids sorted by the FIRST objective (direction-aware).
    first = objectives_payload[0]
    frontier_sorted = sorted(
        frontier_cands,
        key=lambda c: c["metrics"].get(first["metric"], 0.0),
        reverse=(first["direction"] == "maximize"),
    )
    frontier = [c["id"] for c in frontier_sorted]

    logger.info(
        "Optimize for simulation %s: %d vars, %d candidates, %d runs each, %d on frontier",
        sim_id, len(searchable_vars), len(candidates), runs, len(frontier),
    )

    return {
        "base_seed": base_seed,
        "searched_variables": [
            {"name": v.name, "label": v.label, "min": v.min, "max": v.max}
            for v in searchable_vars
        ],
        "objectives": objectives_payload,
        "candidates": candidates,
        "frontier": frontier,
        "knee_point": knee,
        "evaluated": len(candidates),
    }
