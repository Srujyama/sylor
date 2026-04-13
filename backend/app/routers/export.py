"""
Data export endpoints.
Supports JSON and CSV export of user simulation data.
"""
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from typing import Optional
import io
import csv
import json
from datetime import datetime

from app.middleware.auth import get_current_user
from app.services.firebase_admin import query_collection, get_document

router = APIRouter(prefix="/api/export", tags=["export"])

SIMULATIONS = "simulations"


@router.get("/simulations")
async def export_simulations(
    format: str = "json",
    user: dict = Depends(get_current_user),
):
    sims = await query_collection(SIMULATIONS, [("user_id", "==", user["uid"])])

    if not sims:
        raise HTTPException(status_code=404, detail="No simulations found")

    if format == "csv":
        return _export_csv(sims)
    else:
        return _export_json(sims)


@router.get("/simulation/{sim_id}")
async def export_single_simulation(
    sim_id: str,
    format: str = "json",
    user: dict = Depends(get_current_user),
):
    sim = await get_document(SIMULATIONS, sim_id)
    if not sim:
        raise HTTPException(status_code=404, detail="Simulation not found")
    if sim.get("user_id") != user["uid"]:
        raise HTTPException(status_code=403, detail="Not authorized")

    if format == "csv":
        return _export_csv([sim])
    else:
        return _export_json([sim])


def _export_json(sims: list) -> StreamingResponse:
    # Clean up Firestore metadata
    clean = []
    for s in sims:
        entry = {
            "id": s.get("id"),
            "name": s.get("name"),
            "description": s.get("description"),
            "category": s.get("category"),
            "status": s.get("status"),
            "config": s.get("config"),
            "results": s.get("results"),
            "run_count": s.get("run_count", 0),
            "created_at": s.get("created_at"),
            "updated_at": s.get("updated_at"),
        }
        clean.append(entry)

    content = json.dumps(clean, indent=2, default=str)
    return StreamingResponse(
        io.BytesIO(content.encode()),
        media_type="application/json",
        headers={"Content-Disposition": f"attachment; filename=simulations_{datetime.utcnow().strftime('%Y%m%d')}.json"},
    )


def _export_csv(sims: list) -> StreamingResponse:
    output = io.StringIO()
    writer = csv.writer(output)

    # Header: simulation metadata + flattened timeline
    writer.writerow([
        "simulation_id", "name", "category", "status",
        "success_probability", "avg_revenue", "avg_market_share", "confidence_interval_low", "confidence_interval_high",
        "month", "avg_monthly_revenue", "p10_revenue", "p90_revenue", "avg_customers", "avg_market_share_monthly",
    ])

    for sim in sims:
        results = sim.get("results") or {}
        ci = results.get("confidence_interval", [None, None])
        ci_low = ci[0] if isinstance(ci, (list, tuple)) and len(ci) > 0 else None
        ci_high = ci[1] if isinstance(ci, (list, tuple)) and len(ci) > 1 else None

        timeline = results.get("timeline_aggregated", [])
        if not timeline:
            writer.writerow([
                sim.get("id"), sim.get("name"), sim.get("category"), sim.get("status"),
                results.get("success_probability"), results.get("avg_revenue"),
                results.get("avg_market_share"), ci_low, ci_high,
                "", "", "", "", "", "",
            ])
        else:
            for point in timeline:
                writer.writerow([
                    sim.get("id"), sim.get("name"), sim.get("category"), sim.get("status"),
                    results.get("success_probability"), results.get("avg_revenue"),
                    results.get("avg_market_share"), ci_low, ci_high,
                    point.get("month"), point.get("avg_revenue"),
                    point.get("p10_revenue"), point.get("p90_revenue"),
                    point.get("avg_customers"), point.get("avg_market_share"),
                ])

    content = output.getvalue()
    return StreamingResponse(
        io.BytesIO(content.encode()),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=simulations_{datetime.utcnow().strftime('%Y%m%d')}.csv"},
    )
