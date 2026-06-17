"""
Share links: frozen public snapshots of simulation results.

Owners create/revoke shares (authed); anyone with the share link can read the
frozen snapshot via GET /api/shared/{share_id} — no auth, no live data, and
never any names/ids beyond the share_id itself.

The `shares` Firestore collection is Admin-SDK-only (deny-all in
firestore.rules); all access flows through this router.
"""
import logging
import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException

from app.middleware.auth import get_current_user
from app.services.firebase_admin import (
    get_document, delete_document, query_collection, get_db,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["shares"])

SHARES_COLLECTION = "shares"
SIMULATIONS_COLLECTION = "simulations"


def _build_snapshot(share_id: str, sim: dict, created_at: str) -> dict:
    """Freeze the sim's stored results into a public snapshot at share time."""
    results = sim.get("results") or {}
    config = sim.get("config") or {}
    try:
        num_runs = int(config.get("num_runs") or 1000)
    except (TypeError, ValueError):
        num_runs = 1000

    outcome_distribution = []
    for bucket in results.get("outcome_distribution") or []:
        probability = bucket.get("probability", 0)
        count = bucket.get("count")
        if count is None:
            count = round((probability or 0) / 100 * num_runs)
        outcome_distribution.append({
            "range": bucket.get("range"),
            "probability": probability,
            "count": count,
        })

    timeline = [
        {
            "month": point.get("month"),
            "avgRevenue": point.get("avg_revenue"),
            "p10Revenue": point.get("p10_revenue"),
            "p90Revenue": point.get("p90_revenue"),
        }
        for point in results.get("timeline_aggregated") or []
    ]

    confidence_interval = results.get("confidence_interval") or []

    return {
        "share_id": share_id,
        "name": sim.get("name"),
        "category": sim.get("category"),
        "created_at": created_at,
        "success_probability": results.get("success_probability"),
        "confidence_interval": list(confidence_interval),
        "avg_revenue": results.get("avg_revenue"),
        "outcome_distribution": outcome_distribution,
        "timeline": timeline,
        "key_insights": results.get("key_insights") or [],
        "domain_metadata": results.get("domain_metadata"),
    }


@router.post("/api/simulations/{sim_id}/share", status_code=201)
async def create_share(sim_id: str, user: dict = Depends(get_current_user)):
    """Create a public share link with a snapshot frozen at share time."""
    sim = await get_document(SIMULATIONS_COLLECTION, sim_id)
    if not sim:
        raise HTTPException(status_code=404, detail="Simulation not found")
    if sim.get("user_id") != user["uid"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    if not sim.get("results"):
        raise HTTPException(
            status_code=409,
            detail="Simulation has no results to share. Run it first.",
        )

    share_id = secrets.token_urlsafe(8)
    now = datetime.utcnow().isoformat()
    doc = {
        "id": share_id,
        "share_id": share_id,
        "simulation_id": sim_id,
        "user_id": user["uid"],
        "created_at": now,
        "snapshot": _build_snapshot(share_id, sim, now),
    }

    db = get_db()
    await db.collection(SHARES_COLLECTION).document(share_id).set(doc)
    logger.info("Created share %s for simulation %s", share_id, sim_id)

    return {"share_id": share_id, "path": f"/s/{share_id}"}


@router.delete("/api/simulations/{sim_id}/share", status_code=204)
async def revoke_shares(sim_id: str, user: dict = Depends(get_current_user)):
    """Revoke ALL shares this owner created for the simulation."""
    shares = await query_collection(SHARES_COLLECTION, [
        ("simulation_id", "==", sim_id),
        ("user_id", "==", user["uid"]),
    ])
    for share in shares:
        await delete_document(SHARES_COLLECTION, share["id"])
    logger.info("Revoked %d share(s) for simulation %s", len(shares), sim_id)


@router.get("/api/shared/{share_id}")
async def get_shared_snapshot(share_id: str):
    """PUBLIC: fetch a frozen share snapshot. 404 if revoked or unknown."""
    share = await get_document(SHARES_COLLECTION, share_id)
    if not share or not share.get("snapshot"):
        raise HTTPException(status_code=404, detail="Share not found")
    return share["snapshot"]
