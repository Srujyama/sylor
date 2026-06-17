"""
Per-user analytics: pure Python aggregation over the user's simulations and
run history. No LLM involvement.
"""
import logging
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends

from app.middleware.auth import get_current_user
from app.services.firebase_admin import query_collection
from app.services.run_history import RUNS_COLLECTION

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/analytics", tags=["analytics"])

SIMULATIONS_COLLECTION = "simulations"
_TREND_WINDOW_DAYS = 30


def _success_probability(sim: dict) -> Optional[float]:
    results = sim.get("results")
    if isinstance(results, dict):
        value = results.get("success_probability")
        if isinstance(value, (int, float)):
            return float(value)
    return None


def _parse_iso(value) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None


@router.get("/summary")
async def analytics_summary(user: dict = Depends(get_current_user)):
    """Aggregate stats over the calling user's simulations."""
    sims = await query_collection(
        SIMULATIONS_COLLECTION, [("user_id", "==", user["uid"])]
    )
    runs = await query_collection(
        RUNS_COLLECTION, [("user_id", "==", user["uid"])]
    )

    completed = [s for s in sims if s.get("status") == "completed"]
    success_values = [
        p for p in (_success_probability(s) for s in completed) if p is not None
    ]
    avg_success_rate = (
        round(sum(success_values) / len(success_values), 1) if success_values else 0.0
    )

    totals = {
        "simulations": len(sims),
        "completed": len(completed),
        "total_runs": len(runs),
        "avg_success_rate": avg_success_rate,
    }

    # ── by_category ──────────────────────────────────────────────────
    cat_counts: dict = defaultdict(lambda: {"count": 0, "successes": []})
    for s in sims:
        cat = s.get("category") or "custom"
        cat_counts[cat]["count"] += 1
        p = _success_probability(s)
        if p is not None:
            cat_counts[cat]["successes"].append(p)
    by_category = [
        {
            "category": cat,
            "count": entry["count"],
            "avg_success": (
                round(sum(entry["successes"]) / len(entry["successes"]), 1)
                if entry["successes"] else 0.0
            ),
        }
        for cat, entry in sorted(cat_counts.items())
    ]

    # ── success_trend (last 30 days, grouped by sim updated_at) ─────
    cutoff = datetime.utcnow() - timedelta(days=_TREND_WINDOW_DAYS)
    trend_buckets: dict = defaultdict(list)
    for s in completed:
        p = _success_probability(s)
        if p is None:
            continue
        updated = _parse_iso(s.get("updated_at"))
        if updated is None or updated < cutoff:
            continue
        trend_buckets[updated.strftime("%Y-%m-%d")].append(p)
    success_trend = [
        {
            "date": date,
            "avg_success": round(sum(values) / len(values), 1),
            "count": len(values),
        }
        for date, values in sorted(trend_buckets.items())
    ]

    # ── recent (10 newest by updated_at) ─────────────────────────────
    newest = sorted(sims, key=lambda s: s.get("updated_at") or "", reverse=True)[:10]
    recent = [
        {
            "id": s.get("id"),
            "name": s.get("name"),
            "category": s.get("category"),
            "status": s.get("status"),
            "success_probability": _success_probability(s),
            "updated_at": s.get("updated_at"),
        }
        for s in newest
    ]

    return {
        "totals": totals,
        "by_category": by_category,
        "success_trend": success_trend,
        "recent": recent,
    }
