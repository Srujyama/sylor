from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from fastapi.responses import JSONResponse
from typing import List, Optional
import uuid
from datetime import datetime

from app.models.simulation import (
    SimulationConfig, SimulationCreate, SimulationResponse,
    RunSimulationRequest, SimulationStatus,
)
from app.services.simulation_engine import SimulationEngine
from app.services.ai_insights import generate_ai_insights

router = APIRouter(prefix="/api/simulations", tags=["simulations"])

# In-memory store for demo (replace with Firebase Firestore in production via app/services/firebase_admin.py)
_store: dict = {}


@router.post("", response_model=dict, status_code=201)
async def create_simulation(payload: SimulationCreate):
    sim_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    sim = {
        "id": sim_id,
        "user_id": payload.user_id,
        "name": payload.config.name,
        "description": payload.config.description,
        "category": payload.config.category.value,
        "config": payload.config.model_dump(),
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
            ai_data = await generate_ai_insights(config, results)
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
