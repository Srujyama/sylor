from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends, Request
from fastapi.responses import JSONResponse, StreamingResponse
from typing import List, Optional, AsyncGenerator
import uuid
import json
import asyncio
from datetime import datetime

from app.models.simulation import (
    SimulationConfig, SimulationCreate, SimulationResponse,
    RunSimulationRequest, SimulationStatus, AgentType,
)
from app.services.simulation_engine import SimulationEngine
from app.services.ai_insights import generate_ai_insights
from app.services.firebase_admin import (
    create_document, get_document, update_document, delete_document, query_collection, get_db,
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
    }

    db = get_db()
    await db.collection(COLLECTION).document(sim_id).set(sim)
    return sim


@router.get("", response_model=List[dict])
async def list_simulations(user: dict = Depends(get_current_user)):
    return await query_collection(COLLECTION, [("user_id", "==", user["uid"])])


@router.get("/{sim_id}", response_model=dict)
async def get_simulation(sim_id: str, user: dict = Depends(get_current_user)):
    sim = await get_document(COLLECTION, sim_id)
    if not sim:
        raise HTTPException(status_code=404, detail="Simulation not found")
    if sim.get("user_id") != user["uid"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    return sim


@router.post("/{sim_id}/run", dependencies=[Depends(require_expensive_rate_limit)])
async def run_simulation(
    sim_id: str,
    request: RunSimulationRequest,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
):
    _validate_num_runs(request.num_runs)

    sim = await get_document(COLLECTION, sim_id)
    if not sim:
        raise HTTPException(status_code=404, detail="Simulation not found")
    if sim.get("user_id") != user["uid"]:
        raise HTTPException(status_code=403, detail="Not authorized")
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

    sim = await get_document(COLLECTION, sim_id)
    if not sim:
        raise HTTPException(status_code=404, detail="Simulation not found")
    if sim.get("user_id") != user["uid"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    if sim["status"] == SimulationStatus.RUNNING.value:
        raise HTTPException(status_code=409, detail="Simulation is already running")

    config = SimulationConfig(**sim["config"])
    _validate_variable_overrides(request.variable_overrides, config)

    await update_document(COLLECTION, sim_id, {
        "status": SimulationStatus.RUNNING.value,
        "updated_at": datetime.utcnow().isoformat(),
    })

    async def stream_simulation() -> AsyncGenerator[str, None]:
        try:
            engine = SimulationEngine(config)
            n = request.num_runs or config.num_runs
            progress_queue: asyncio.Queue = asyncio.Queue()

            async def on_progress(completed: int, total: int):
                pct = round(completed / total * 85)  # Reserve 15% for post-processing
                await progress_queue.put(_sse_event("progress", {
                    "percent": pct, "completed": completed, "total": total, "phase": "running"
                }))

            yield _sse_event("progress", {"percent": 0, "completed": 0, "total": n, "phase": "running"})

            # Run simulation with progress callback
            results = await engine.run(
                num_runs=n,
                variable_overrides=request.variable_overrides,
                progress_callback=on_progress,
            )

            # Drain queued progress events
            while not progress_queue.empty():
                yield await progress_queue.get()

            yield _sse_event("progress", {"percent": 90, "completed": n, "total": n, "phase": "ai_insights"})

            # AI insights
            try:
                ai_data = await generate_ai_insights(config, results, company_context=config.company_context)
                results.key_insights = ai_data.get("key_insights", results.key_insights)
                results.success_explanation = ai_data.get("success_pattern", results.success_explanation)
                results.failure_explanation = ai_data.get("failure_pattern", results.failure_explanation)
            except Exception:
                pass

            yield _sse_event("progress", {"percent": 98, "completed": n, "total": n, "phase": "saving"})

            # Save to Firestore
            doc = await get_document(COLLECTION, sim_id)
            run_count = (doc.get("run_count", 0) if doc else 0) + 1
            await update_document(COLLECTION, sim_id, {
                "status": SimulationStatus.COMPLETED.value,
                "results": results.model_dump(mode="json"),
                "run_count": run_count,
                "updated_at": datetime.utcnow().isoformat(),
            })

            yield _sse_event("complete", {"sim_id": sim_id, "success_probability": results.success_probability})

        except Exception as e:
            await update_document(COLLECTION, sim_id, {
                "status": SimulationStatus.FAILED.value,
                "error": str(e),
                "updated_at": datetime.utcnow().isoformat(),
            })
            yield _sse_event("error", {"detail": str(e)})

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
        except Exception:
            pass

        doc = await get_document(COLLECTION, sim_id)
        run_count = (doc.get("run_count", 0) if doc else 0) + 1

        await update_document(COLLECTION, sim_id, {
            "status": SimulationStatus.COMPLETED.value,
            "results": results.model_dump(mode="json"),
            "run_count": run_count,
            "updated_at": datetime.utcnow().isoformat(),
        })

    except Exception as e:
        await update_document(COLLECTION, sim_id, {
            "status": SimulationStatus.FAILED.value,
            "error": str(e),
            "updated_at": datetime.utcnow().isoformat(),
        })


@router.get("/{sim_id}/results")
async def get_results(sim_id: str, user: dict = Depends(get_current_user)):
    sim = await get_document(COLLECTION, sim_id)
    if not sim:
        raise HTTPException(status_code=404, detail="Simulation not found")
    if sim.get("user_id") != user["uid"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    if sim["status"] != SimulationStatus.COMPLETED.value:
        return {"status": sim["status"], "results": None}
    return {"status": sim["status"], "results": sim.get("results")}


@router.post("/{sim_id}/duplicate")
async def duplicate_simulation(sim_id: str, user: dict = Depends(get_current_user)):
    sim = await get_document(COLLECTION, sim_id)
    if not sim:
        raise HTTPException(status_code=404, detail="Simulation not found")
    if sim.get("user_id") != user["uid"]:
        raise HTTPException(status_code=403, detail="Not authorized")

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

    db = get_db()
    await db.collection(COLLECTION).document(new_id).set(new_sim)
    return new_sim


@router.delete("/{sim_id}", status_code=204)
async def delete_simulation(sim_id: str, user: dict = Depends(get_current_user)):
    sim = await get_document(COLLECTION, sim_id)
    if not sim:
        raise HTTPException(status_code=404, detail="Simulation not found")
    if sim.get("user_id") != user["uid"]:
        raise HTTPException(status_code=403, detail="Not authorized")
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
    sim = await get_document(COLLECTION, sim_id)
    if not sim:
        raise HTTPException(status_code=404, detail="Simulation not found")
    if sim.get("user_id") != user["uid"]:
        raise HTTPException(status_code=403, detail="Not authorized")

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
