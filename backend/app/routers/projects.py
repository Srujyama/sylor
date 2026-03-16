"""
Project Orchestration API.
Exposes the unified MiroFish-inspired pipeline through RESTful endpoints.
Combines document upload, knowledge graph, profile generation, simulation,
and report generation into a single project workflow.
"""
import asyncio
from typing import List, Optional
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, BackgroundTasks
from pydantic import BaseModel

from app.services.simulation_orchestrator import orchestrator, ProjectStatus

router = APIRouter(prefix="/api/projects", tags=["projects"])


# ── Request/Response Models ──────────────────────────────────────────────────

class CreateProjectRequest(BaseModel):
    name: str
    category: str = "startup"


class ChatRequest(BaseModel):
    message: str


# ── Project CRUD ─────────────────────────────────────────────────────────────

@router.post("", status_code=201)
async def create_project(body: CreateProjectRequest):
    """Create a new orchestration project."""
    project = orchestrator.create_project(body.name, body.category)
    return project.to_dict()


@router.get("")
async def list_projects():
    """List all projects."""
    return orchestrator.list_projects()


@router.get("/{project_id}")
async def get_project(project_id: str):
    """Get project details."""
    project = orchestrator.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project.to_dict()


@router.delete("/{project_id}", status_code=204)
async def delete_project(project_id: str):
    """Delete a project and all associated resources."""
    if not orchestrator.delete_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")


# ── Phase 1: Document Upload ─────────────────────────────────────────────────

@router.post("/{project_id}/upload")
async def upload_documents(
    project_id: str,
    files: List[UploadFile] = File(...),
):
    """
    Upload documents to a project for knowledge graph building.
    Supports PDF, TXT, CSV, XLSX, and Markdown files.
    Adapted from MiroFish's ontology/generate endpoint.
    """
    project = orchestrator.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

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
async def build_knowledge_graph(project_id: str):
    """
    Start building a knowledge graph from uploaded documents.
    Returns a task_id for progress polling.
    Adapted from MiroFish's /graph/build endpoint.
    """
    project = orchestrator.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

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
async def generate_profiles(project_id: str, body: GenerateProfilesRequest):
    """
    Generate agent profiles from knowledge graph entities.
    Returns a task_id for progress polling.
    Adapted from MiroFish's /simulation/prepare endpoint.
    """
    project = orchestrator.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    try:
        task_id = await orchestrator.generate_profiles(
            project_id, body.use_llm, body.max_profiles
        )
        return {"task_id": task_id, "status": "generating"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{project_id}/profiles")
async def get_profiles(project_id: str):
    """Get generated agent profiles."""
    project = orchestrator.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"profiles": project.agent_profiles}


# ── Phase 5: Report Generation ───────────────────────────────────────────────

@router.post("/{project_id}/generate-report")
async def generate_report(project_id: str):
    """
    Generate an analysis report from simulation results.
    Returns a task_id for progress polling.
    Adapted from MiroFish's /report/generate endpoint.
    """
    project = orchestrator.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if not project.simulation_results:
        raise HTTPException(status_code=400, detail="No simulation results. Run simulation first.")

    try:
        task_id = await orchestrator.generate_report(project_id)
        return {"task_id": task_id, "status": "generating"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Phase 6: Chat ────────────────────────────────────────────────────────────

@router.post("/{project_id}/chat")
async def chat_with_report(project_id: str, body: ChatRequest):
    """
    Chat about a project's report.
    Adapted from MiroFish's /report/chat endpoint.
    """
    project = orchestrator.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    response = await orchestrator.chat_with_report(project_id, body.message)
    return {"response": response}


# ── Task Status ──────────────────────────────────────────────────────────────

@router.get("/tasks/{task_id}")
async def get_task_status(task_id: str):
    """
    Poll task progress.
    Adapted from MiroFish's /graph/task/<task_id> endpoint.
    """
    task = orchestrator.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task.to_dict()
