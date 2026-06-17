"""
Report Generation API.
Exposes the ReACT report agent through REST endpoints.
Adapted from MiroFish's report.py with streaming support.

All endpoints require authentication. Reports that carry a user_id are
only readable/deletable by their owner; the list endpoint is always
scoped to the authenticated user.
"""
import asyncio
import logging
import uuid
from typing import Optional, Literal
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.middleware.auth import get_current_user
from app.services.report_agent import ReportAgent, Report, report_agent

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/reports", tags=["reports"])

# Strong references to in-flight generation tasks. asyncio only keeps weak
# references to tasks, so without this set a background generation could be
# garbage-collected mid-flight. Tasks remove themselves on completion.
_generation_tasks: set = set()


class GenerateReportRequest(BaseModel):
    simulation_id: str
    simulation_data: dict
    category: str = "startup"
    graph_id: Optional[str] = None


class MemoRequest(BaseModel):
    simulation_id: str
    audience: Literal["exec", "technical"] = "exec"


class ChatRequest(BaseModel):
    report_id: str
    message: str
    simulation_data: Optional[dict] = None


async def _get_owned_report(report_id: str, user: dict) -> Report:
    """404 if the report is missing, 403 if it belongs to another user."""
    report = await ReportAgent.get_report(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    if report.user_id is not None and report.user_id != user["uid"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    return report


# ── Report Generation ────────────────────────────────────────────────────────

@router.post("/generate")
async def generate_report(body: GenerateReportRequest, user: dict = Depends(get_current_user)):
    """
    Start asynchronous report generation.
    Returns report_id for progress polling.
    Adapted from MiroFish's /report/generate endpoint.
    """
    agent = ReportAgent(graph_id=body.graph_id)
    report_id = f"report_{uuid.uuid4().hex[:12]}"

    async def run():
        try:
            await agent.generate_report(
                simulation_id=body.simulation_id,
                simulation_data=body.simulation_data,
                category=body.category,
                graph_id=body.graph_id,
                user_id=user["uid"],
                report_id=report_id,
            )
        except Exception:
            logger.exception("Background report generation failed for %s", report_id)

    task = asyncio.create_task(run())
    _generation_tasks.add(task)
    task.add_done_callback(_generation_tasks.discard)

    return {
        "report_id": report_id,
        "status": "generating",
        "progress_url": f"/api/reports/{report_id}/progress",
        "report_url": f"/api/reports/{report_id}",
        "message": f"Report generation started. Poll /api/reports/{report_id}/progress for status.",
    }


@router.post("/memo")
async def generate_memo(body: MemoRequest, user: dict = Depends(get_current_user)):
    """
    Build a fixed-section executive decision memo from a simulation's stored
    results. Returns the report_id immediately and runs generation in a
    tracked background task; pollable via the existing progress endpoint and
    viewable at /api/reports/{report_id}.

    404 if the simulation is missing or owned by another user.
    409 if the simulation has no results yet.
    """
    # Imported at call time so test patches on the source module apply.
    from app.services.firebase_admin import get_document
    sim = await get_document("simulations", body.simulation_id)
    if not sim or sim.get("user_id") != user["uid"]:
        # Do not distinguish missing from forbidden — both surface as 404 so a
        # caller cannot probe for the existence of other users' simulations.
        raise HTTPException(status_code=404, detail="Simulation not found")

    results = sim.get("results")
    if not results:
        raise HTTPException(
            status_code=409,
            detail="Simulation has no results yet. Run the simulation before requesting a memo.",
        )

    category = sim.get("category") or "startup"
    report_id = f"report_{uuid.uuid4().hex[:12]}"
    agent = ReportAgent()

    async def run():
        try:
            await agent.generate_memo(
                report_id=report_id,
                simulation_id=body.simulation_id,
                simulation_data=results,
                audience=body.audience,
                category=category,
                user_id=user["uid"],
            )
        except Exception:
            logger.exception("Background memo generation failed for %s", report_id)

    task = asyncio.create_task(run())
    _generation_tasks.add(task)
    task.add_done_callback(_generation_tasks.discard)

    return {
        "report_id": report_id,
        "status": "generating",
        "progress_url": f"/api/reports/{report_id}/progress",
        "report_url": f"/api/reports/{report_id}",
    }


@router.post("/generate-sync")
async def generate_report_sync(body: GenerateReportRequest, user: dict = Depends(get_current_user)):
    """
    Synchronous report generation (waits for completion).
    Useful for smaller simulations.
    """
    agent = ReportAgent(graph_id=body.graph_id)

    try:
        report = await agent.generate_report(
            simulation_id=body.simulation_id,
            simulation_data=body.simulation_data,
            category=body.category,
            graph_id=body.graph_id,
            user_id=user["uid"],
        )
        return report.to_dict()
    except Exception as e:
        logger.exception("Synchronous report generation failed")
        raise HTTPException(status_code=500, detail=f"Report generation failed: {str(e)}")


# ── Report CRUD ──────────────────────────────────────────────────────────────

@router.get("")
async def list_reports(
    simulation_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """List the authenticated user's reports, optionally filtered by simulation ID."""
    return await ReportAgent.list_reports(simulation_id=simulation_id, user_id=user["uid"])


@router.get("/{report_id}")
async def get_report(report_id: str, user: dict = Depends(get_current_user)):
    """Get a specific report."""
    report = await _get_owned_report(report_id, user)
    return report.to_dict()


@router.get("/{report_id}/progress")
async def get_report_progress(report_id: str, user: dict = Depends(get_current_user)):
    """
    Get real-time generation progress.
    Adapted from MiroFish's /<report_id>/progress endpoint.
    """
    # Ownership check against the report record (created at generation start)
    report = await ReportAgent.get_report(report_id)
    if report and report.user_id is not None and report.user_id != user["uid"]:
        raise HTTPException(status_code=403, detail="Not authorized")

    progress = ReportAgent.get_progress(report_id)
    if not progress:
        raise HTTPException(status_code=404, detail="Report not found")
    return {
        "report_id": progress.report_id,
        "status": progress.status,
        "current_section": progress.current_section,
        "total_sections": progress.total_sections,
        "percent": progress.percent,
        "message": progress.message,
        "sections_completed": progress.sections_completed,
    }


@router.get("/{report_id}/sections")
async def get_report_sections(report_id: str, user: dict = Depends(get_current_user)):
    """Get all generated sections (supports incremental polling)."""
    report = await _get_owned_report(report_id, user)
    return {
        "sections": [
            {"index": s.index, "title": s.title, "content": s.content, "status": s.status}
            for s in report.sections
        ]
    }


@router.get("/{report_id}/download")
async def download_report(report_id: str, user: dict = Depends(get_current_user)):
    """Download report as markdown file."""
    report = await _get_owned_report(report_id, user)
    if not report.full_markdown:
        raise HTTPException(status_code=404, detail="Report not found or not complete")

    return StreamingResponse(
        iter([report.full_markdown.encode()]),
        media_type="text/markdown",
        headers={"Content-Disposition": f"attachment; filename={report_id}.md"},
    )


@router.get("/by-simulation/{simulation_id}")
async def get_report_by_simulation(simulation_id: str, user: dict = Depends(get_current_user)):
    """Get report by simulation ID."""
    report = await ReportAgent.get_report_by_simulation(simulation_id)
    if not report:
        raise HTTPException(status_code=404, detail="No report found for this simulation")
    if report.user_id is not None and report.user_id != user["uid"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    return report.to_dict()


@router.delete("/{report_id}", status_code=204)
async def delete_report(report_id: str, user: dict = Depends(get_current_user)):
    """Delete a report."""
    await _get_owned_report(report_id, user)
    if not await ReportAgent.delete_report(report_id):
        raise HTTPException(status_code=404, detail="Report not found")


# ── Chat ─────────────────────────────────────────────────────────────────────

@router.post("/chat")
async def chat_with_report(body: ChatRequest, user: dict = Depends(get_current_user)):
    """
    Chat with the report agent about a generated report.
    Uses a simplified ReACT loop with tool access.
    Adapted from MiroFish's /report/chat endpoint.
    """
    # Ownership check when the referenced report exists and is owned
    report = await ReportAgent.get_report(body.report_id)
    if report and report.user_id is not None and report.user_id != user["uid"]:
        raise HTTPException(status_code=403, detail="Not authorized")

    agent = ReportAgent()
    response = await agent.chat(
        report_id=body.report_id,
        message=body.message,
        simulation_data=body.simulation_data,
    )
    return {"response": response}
