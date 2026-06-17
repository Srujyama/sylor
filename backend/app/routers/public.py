"""
Public, unauthenticated platform stats.

Aggregates anonymized counts over the simulations collection. NEVER exposes
names, document ids, or user ids. The full response is cached in-process for
~5 minutes to keep this endpoint cheap under load.
"""
import logging
import time
from datetime import datetime, timedelta
from typing import Optional, Tuple

from fastapi import APIRouter

from app.services.firebase_admin import query_collection

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/public", tags=["public"])

SIMULATIONS_COLLECTION = "simulations"

# Module-level (value, monotonic_timestamp) cache — per-process, ~5 min TTL.
_CACHE_TTL_SECONDS = 300
_stats_cache: Optional[Tuple[dict, float]] = None


def _parse_iso(value) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None


@router.get("/stats")
async def public_stats():
    """PUBLIC: anonymized platform-wide stats (cached ~5 minutes)."""
    global _stats_cache

    now = time.monotonic()
    if _stats_cache is not None and now - _stats_cache[1] < _CACHE_TTL_SECONDS:
        return _stats_cache[0]

    sims = await query_collection(SIMULATIONS_COLLECTION, [])

    total_simulations = len(sims)
    total_runs = 0
    for s in sims:
        try:
            total_runs += int(s.get("run_count") or 0)
        except (TypeError, ValueError):
            continue

    week_cutoff = datetime.utcnow() - timedelta(days=7)
    sims_this_week = 0
    for s in sims:
        created = _parse_iso(s.get("created_at"))
        if created is not None and created >= week_cutoff:
            sims_this_week += 1

    # Last 10 completed sims, anonymized: category + success + recency only.
    completed = [
        s for s in sims
        if s.get("status") == "completed" and isinstance(s.get("results"), dict)
    ]
    completed.sort(key=lambda s: s.get("updated_at") or "", reverse=True)

    now_dt = datetime.utcnow()
    recent = []
    for s in completed:
        if len(recent) >= 10:
            break
        updated = _parse_iso(s.get("updated_at"))
        if updated is None:
            continue
        recent.append({
            "category": s.get("category"),
            "success_probability": s["results"].get("success_probability"),
            "minutes_ago": max(0, int((now_dt - updated).total_seconds() // 60)),
        })

    payload = {
        "total_simulations": total_simulations,
        "total_runs": total_runs,
        "sims_this_week": sims_this_week,
        "recent": recent,
    }
    _stats_cache = (payload, now)
    return payload
