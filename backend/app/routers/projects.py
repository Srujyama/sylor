"""
Project Orchestration API.
Exposes the unified MiroFish-inspired pipeline through RESTful endpoints.
Combines document upload, knowledge graph, profile generation, simulation,
and report generation into a single project workflow.

All endpoints require authentication; projects and their tasks are scoped
to the owning user.
"""
from typing import List, Optional, Dict
from fastapi import APIRouter, HTTPException, UploadFile, File, Depends
from pydantic import BaseModel, Field

from app.middleware.auth import get_current_user
from app.middleware.rate_limit import require_expensive_rate_limit
from app.services.simulation_orchestrator import orchestrator, Project

router = APIRouter(prefix="/api/projects", tags=["projects"])


# ── Request/Response Models ──────────────────────────────────────────────────

class CreateProjectRequest(BaseModel):
    name: str
    category: str = "startup"


class ChatRequest(BaseModel):
    message: str


class RunSimulationRequest(BaseModel):
    num_runs: Optional[int] = Field(default=None, ge=10, le=10000)
    time_horizon: Optional[int] = Field(default=None, ge=1, le=120)
    variable_overrides: Optional[Dict[str, float]] = None


# ── Ownership helper ─────────────────────────────────────────────────────────

async def _get_owned_project(project_id: str, user: dict) -> Project:
    """Fetch a project, 404 if missing, 403 if owned by another user."""
    project = await orchestrator.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.user_id != user["uid"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    return project


# ── Project CRUD ─────────────────────────────────────────────────────────────

@router.post("", status_code=201)
async def create_project(body: CreateProjectRequest, user: dict = Depends(get_current_user)):
    """Create a new orchestration project owned by the authenticated user."""
    project = await orchestrator.create_project(body.name, body.category, user_id=user["uid"])
    return project.to_dict()


@router.get("")
async def list_projects(user: dict = Depends(get_current_user)):
    """List the authenticated user's projects."""
    return await orchestrator.list_projects(user_id=user["uid"])


@router.get("/{project_id}")
async def get_project(project_id: str, user: dict = Depends(get_current_user)):
    """Get project details."""
    project = await _get_owned_project(project_id, user)
    return project.to_dict()


@router.delete("/{project_id}", status_code=204)
async def delete_project(project_id: str, user: dict = Depends(get_current_user)):
    """Delete a project and all associated resources."""
    await _get_owned_project(project_id, user)
    if not await orchestrator.delete_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")


# ── Phase 1: Document Upload ─────────────────────────────────────────────────

@router.post("/{project_id}/upload")
async def upload_documents(
    project_id: str,
    files: List[UploadFile] = File(...),
    user: dict = Depends(get_current_user),
):
    """
    Upload documents to a project for knowledge graph building.
    Supports PDF, TXT, CSV, XLSX, and Markdown files.
    Adapted from MiroFish's ontology/generate endpoint.
    """
    await _get_owned_project(project_id, user)

    file_data = []
    for f in files:
        if not f.filename:
            continue
        ext = f.filename.rsplit(".", 1)[-1].lower() if "." in f.filename else ""
        if ext not in ("pdf", "txt", "csv", "xlsx", "xls", "md", "markdown"):
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type: {f.filename}. Use PDF, TXT, CSV, XLSX, or Markdown."
            )
        content = await f.read()
        if len(content) > 20 * 1024 * 1024:  # 20MB limit
            raise HTTPException(status_code=400, detail=f"File too large: {f.filename}. Maximum 20MB.")
        file_data.append((f.filename, content))

    if not file_data:
        raise HTTPException(status_code=400, detail="No valid files provided")

    try:
        result = await orchestrator.upload_documents(project_id, file_data)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Phase 2: Knowledge Graph ─────────────────────────────────────────────────

@router.post("/{project_id}/build-graph")
async def build_knowledge_graph(project_id: str, user: dict = Depends(get_current_user)):
    """
    Start building a knowledge graph from uploaded documents.
    Returns a task_id for progress polling.
    Adapted from MiroFish's /graph/build endpoint.
    """
    project = await _get_owned_project(project_id, user)

    if not project.extracted_text:
        raise HTTPException(status_code=400, detail="No documents uploaded. Upload documents first.")

    try:
        task_id = await orchestrator.build_knowledge_graph(project_id)
        return {"task_id": task_id, "status": "building"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Phase 3: Agent Profiles ──────────────────────────────────────────────────

class GenerateProfilesRequest(BaseModel):
    use_llm: bool = True
    max_profiles: int = 20


@router.post("/{project_id}/generate-profiles")
async def generate_profiles(
    project_id: str,
    body: GenerateProfilesRequest,
    user: dict = Depends(get_current_user),
):
    """
    Generate agent profiles from knowledge graph entities.
    Returns a task_id for progress polling.
    Adapted from MiroFish's /simulation/prepare endpoint.
    """
    await _get_owned_project(project_id, user)

    try:
        task_id = await orchestrator.generate_profiles(
            project_id, body.use_llm, body.max_profiles
        )
        return {"task_id": task_id, "status": "generating"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{project_id}/profiles")
async def get_profiles(project_id: str, user: dict = Depends(get_current_user)):
    """Get generated agent profiles."""
    project = await _get_owned_project(project_id, user)
    return {"profiles": project.agent_profiles}


# ── Phase 4: Run Simulation ──────────────────────────────────────────────────

@router.post(
    "/{project_id}/run-simulation",
    dependencies=[Depends(require_expensive_rate_limit)],
)
async def run_project_simulation(
    project_id: str,
    body: RunSimulationRequest,
    user: dict = Depends(get_current_user),
):
    """
    Kick off the Monte Carlo simulation phase of the pipeline.

    Builds a SimulationConfig from the project (category, generated agent
    profiles, variables from overrides or category defaults), creates an
    owner-scoped ``simulations`` document, and runs the engine in a tracked
    background task. Returns immediately with a pollable task_id.

    Poll GET /api/projects/tasks/{task_id}; on completion task.result contains
    {"simulation_id": ...}. The simulation doc lives at /simulations/{id}.
    """
    await _get_owned_project(project_id, user)

    try:
        return await orchestrator.run_simulation_pipeline(
            project_id,
            num_runs=body.num_runs,
            time_horizon=body.time_horizon,
            variable_overrides=body.variable_overrides,
            user_id=user["uid"],
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Phase 5: Report Generation ───────────────────────────────────────────────

@router.post("/{project_id}/generate-report")
async def generate_report(project_id: str, user: dict = Depends(get_current_user)):
    """
    Generate an analysis report from simulation results.
    Returns a task_id for progress polling.
    Adapted from MiroFish's /report/generate endpoint.
    """
    project = await _get_owned_project(project_id, user)

    if not project.simulation_results:
        raise HTTPException(status_code=400, detail="No simulation results. Run simulation first.")

    try:
        task_id = await orchestrator.generate_report(project_id)
        return {"task_id": task_id, "status": "generating"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Phase 6: Chat ────────────────────────────────────────────────────────────

@router.post("/{project_id}/chat")
async def chat_with_report(
    project_id: str,
    body: ChatRequest,
    user: dict = Depends(get_current_user),
):
    """
    Chat about a project's report.
    Adapted from MiroFish's /report/chat endpoint.
    """
    await _get_owned_project(project_id, user)

    response = await orchestrator.chat_with_report(project_id, body.message)
    return {"response": response}


# ── Task Status ──────────────────────────────────────────────────────────────

@router.get("/tasks/{task_id}")
async def get_task_status(task_id: str, user: dict = Depends(get_current_user)):
    """
    Poll task progress.
    Adapted from MiroFish's /graph/task/<task_id> endpoint.
    """
    task = await orchestrator.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.user_id is not None and task.user_id != user["uid"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    return task.to_dict()
