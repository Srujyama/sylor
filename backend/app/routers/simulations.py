from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from fastapi.responses import JSONResponse
from typing import List, Optional
import uuid
from datetime import datetime

from app.models.simulation import (
    SimulationConfig, SimulationCreate, SimulationResponse,
    RunSimulationRequest, SimulationStatus, AgentType,
)
from app.services.simulation_engine import SimulationEngine
from app.services.ai_insights import generate_ai_insights

router = APIRouter(prefix="/api/simulations", tags=["simulations"])

# In-memory store for demo (replace with Firebase Firestore in production via app/services/firebase_admin.py)
_store: dict = {}

# Map AI-generated agent type strings to valid AgentType enum values
_AGENT_TYPE_MAP = {
    # Direct matches (already valid)
    "customer": "customer",
    "competitor": "competitor",
    "regulator": "regulator",
    "investor": "investor",
    "market": "market",
    "trader": "trader",
    "market_maker": "market_maker",
    "molecule": "molecule",
    "enzyme": "enzyme",
    "data_stream": "data_stream",
    # Common AI-invented variations → nearest valid type
    "momentum_trader": "trader",
    "value_investor": "investor",
    "algorithmic_trader": "trader",
    "quant_trader": "trader",
    "retail_trader": "trader",
    "institutional_investor": "investor",
    "portfolio_manager": "investor",
    "market_analyst": "market",
    "market_participant": "market",
    "market_force": "market",
    "macro_force": "market",
    "macro": "market",
    "consumer": "customer",
    "user": "customer",
    "buyer": "customer",
    "client": "customer",
    "end_user": "customer",
    "churn_agent": "customer",
    "acquisition_agent": "customer",
    "sales_agent": "customer",
    "regulatory": "regulator",
    "government": "regulator",
    "policy_maker": "regulator",
    "vc_investor": "investor",
    "angel_investor": "investor",
    "data": "data_stream",
    "signal": "data_stream",
    "trend": "data_stream",
    "sensor": "data_stream",
    "feed": "data_stream",
    "ligand": "molecule",
    "protein": "molecule",
    "substrate": "molecule",
    "catalyst": "enzyme",
    "inhibitor": "molecule",
}


def _sanitize_agent_type(agent_type_str: str) -> str:
    """Map an AI-generated agent type string to a valid AgentType enum value."""
    s = str(agent_type_str).lower().strip().replace(" ", "_").replace("-", "_")
    if s in _AGENT_TYPE_MAP:
        return _AGENT_TYPE_MAP[s]
    # Try partial match
    for key, val in _AGENT_TYPE_MAP.items():
        if key in s or s in key:
            return val
    # Default fallback: pick by category context
    return "market"  # Safe default


@router.post("", response_model=dict, status_code=201)
async def create_simulation(payload: SimulationCreate):
    sim_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()

    # Sanitize agent types — AI may return types outside the enum
    config_dict = payload.config.model_dump()
    for agent in config_dict.get("agents", []):
        raw_type = agent.get("type", "market")
        if isinstance(raw_type, str):
            agent["type"] = _sanitize_agent_type(raw_type)

    # Re-validate config with sanitized types
    try:
        sanitized_config = SimulationConfig(**config_dict)
    except Exception:
        sanitized_config = payload.config  # Fallback to original if re-parse fails

    sim = {
        "id": sim_id,
        "user_id": payload.user_id,
        "name": sanitized_config.name,
        "description": sanitized_config.description,
        "category": sanitized_config.category.value,
        "config": sanitized_config.model_dump(),
        "status": SimulationStatus.DRAFT.value,
        "results": None,
        "created_at": now,
        "updated_at": now,
        "run_count": 0,
    }
    _store[sim_id] = sim
    return sim


@router.get("", response_model=List[dict])
async def list_simulations(user_id: str):
    return [s for s in _store.values() if s["user_id"] == user_id]


@router.get("/{sim_id}", response_model=dict)
async def get_simulation(sim_id: str):
    sim = _store.get(sim_id)
    if not sim:
        raise HTTPException(status_code=404, detail="Simulation not found")
    return sim


@router.post("/{sim_id}/run")
async def run_simulation(
    sim_id: str,
    request: RunSimulationRequest,
    background_tasks: BackgroundTasks,
):
    sim = _store.get(sim_id)
    if not sim:
        raise HTTPException(status_code=404, detail="Simulation not found")

    if sim["status"] == SimulationStatus.RUNNING.value:
        raise HTTPException(status_code=409, detail="Simulation is already running")

    # Mark as running
    _store[sim_id]["status"] = SimulationStatus.RUNNING.value
    _store[sim_id]["updated_at"] = datetime.utcnow().isoformat()

    background_tasks.add_task(
        _execute_simulation,
        sim_id,
        SimulationConfig(**sim["config"]),
        request.num_runs,
        request.variable_overrides,
    )

    return {"status": "running", "sim_id": sim_id}


async def _execute_simulation(
    sim_id: str,
    config: SimulationConfig,
    num_runs: Optional[int],
    variable_overrides: Optional[dict],
):
    try:
        engine = SimulationEngine(config)
        results = await engine.run(num_runs=num_runs, variable_overrides=variable_overrides)

        # Enhance with AI insights
        try:
            ai_data = await generate_ai_insights(config, results, company_context=config.company_context)
            results.key_insights = ai_data.get("key_insights", results.key_insights)
            results.success_explanation = ai_data.get("success_pattern", results.success_explanation)
            results.failure_explanation = ai_data.get("failure_pattern", results.failure_explanation)
        except Exception:
            pass  # Use fallback insights

        _store[sim_id]["status"] = SimulationStatus.COMPLETED.value
        _store[sim_id]["results"] = results.model_dump()
        _store[sim_id]["run_count"] = _store[sim_id].get("run_count", 0) + 1
        _store[sim_id]["updated_at"] = datetime.utcnow().isoformat()

    except Exception as e:
        _store[sim_id]["status"] = SimulationStatus.FAILED.value
        _store[sim_id]["error"] = str(e)
        _store[sim_id]["updated_at"] = datetime.utcnow().isoformat()


@router.get("/{sim_id}/results")
async def get_results(sim_id: str):
    sim = _store.get(sim_id)
    if not sim:
        raise HTTPException(status_code=404, detail="Simulation not found")
    if sim["status"] != SimulationStatus.COMPLETED.value:
        return {"status": sim["status"], "results": None}
    return {"status": sim["status"], "results": sim["results"]}


@router.post("/{sim_id}/duplicate")
async def duplicate_simulation(sim_id: str):
    sim = _store.get(sim_id)
    if not sim:
        raise HTTPException(status_code=404, detail="Simulation not found")
    new_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    new_sim = dict(sim)
    new_sim["id"] = new_id
    new_sim["name"] = f"{sim['name']} (copy)"
    new_sim["status"] = SimulationStatus.DRAFT.value
    new_sim["results"] = None
    new_sim["created_at"] = now
    new_sim["updated_at"] = now
    new_sim["run_count"] = 0
    _store[new_id] = new_sim
    return new_sim


@router.delete("/{sim_id}", status_code=204)
async def delete_simulation(sim_id: str):
    if sim_id not in _store:
        raise HTTPException(status_code=404, detail="Simulation not found")
    del _store[sim_id]
