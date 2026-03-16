"""
Report Generation API.
Exposes the ReACT report agent through REST endpoints.
Adapted from MiroFish's report.py with streaming support.
"""
from typing import Optional
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.services.report_agent import ReportAgent, report_agent

router = APIRouter(prefix="/api/reports", tags=["reports"])


class GenerateReportRequest(BaseModel):
    simulation_id: str
    simulation_data: dict
    category: str = "startup"
    graph_id: Optional[str] = None


class ChatRequest(BaseModel):
    report_id: str
    message: str
    simulation_data: Optional[dict] = None


# ── Report Generation ────────────────────────────────────────────────────────

@router.post("/generate")
async def generate_report(body: GenerateReportRequest):
    """
    Start asynchronous report generation.
    Returns report_id for progress polling.
    Adapted from MiroFish's /report/generate endpoint.
    """
    import asyncio

    agent = ReportAgent(graph_id=body.graph_id)

    # Start generation in background
    async def run():
        await agent.generate_report(
            simulation_id=body.simulation_id,
            simulation_data=body.simulation_data,
            category=body.category,
            graph_id=body.graph_id,
        )

    task = asyncio.create_task(run())

    # Return immediately with a report_id hint
    # The actual report_id will be available when we poll
    return {
        "status": "generating",
        "message": "Report generation started. Poll /api/reports/list to find it.",
    }


@router.post("/generate-sync")
async def generate_report_sync(body: GenerateReportRequest):
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
        )
        return report.to_dict()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Report generation failed: {str(e)}")


# ── Report CRUD ──────────────────────────────────────────────────────────────

@router.get("")
async def list_reports(simulation_id: Optional[str] = None):
    """List reports, optionally filtered by simulation ID."""
    return ReportAgent.list_reports(simulation_id)


@router.get("/{report_id}")
async def get_report(report_id: str):
    """Get a specific report."""
    report = ReportAgent.get_report(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    return report.to_dict()


@router.get("/{report_id}/progress")
async def get_report_progress(report_id: str):
    """
    Get real-time generation progress.
    Adapted from MiroFish's /<report_id>/progress endpoint.
    """
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
async def get_report_sections(report_id: str):
    """Get all generated sections (supports incremental polling)."""
    report = ReportAgent.get_report(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    return {
        "sections": [
            {"index": s.index, "title": s.title, "content": s.content, "status": s.status}
            for s in report.sections
        ]
    }


@router.get("/{report_id}/download")
async def download_report(report_id: str):
    """Download report as markdown file."""
    report = ReportAgent.get_report(report_id)
    if not report or not report.full_markdown:
        raise HTTPException(status_code=404, detail="Report not found or not complete")

    return StreamingResponse(
        iter([report.full_markdown.encode()]),
        media_type="text/markdown",
        headers={"Content-Disposition": f"attachment; filename={report_id}.md"},
    )


@router.get("/by-simulation/{simulation_id}")
async def get_report_by_simulation(simulation_id: str):
    """Get report by simulation ID."""
    report = ReportAgent.get_report_by_simulation(simulation_id)
    if not report:
        raise HTTPException(status_code=404, detail="No report found for this simulation")
    return report.to_dict()


@router.delete("/{report_id}", status_code=204)
async def delete_report(report_id: str):
    """Delete a report."""
    if not ReportAgent.delete_report(report_id):
        raise HTTPException(status_code=404, detail="Report not found")


# ── Chat ─────────────────────────────────────────────────────────────────────

@router.post("/chat")
async def chat_with_report(body: ChatRequest):
    """
    Chat with the report agent about a generated report.
    Uses a simplified ReACT loop with tool access.
    Adapted from MiroFish's /report/chat endpoint.
    """
    agent = ReportAgent()
    response = await agent.chat(
        report_id=body.report_id,
        message=body.message,
        simulation_data=body.simulation_data,
    )
    return {"response": response}
