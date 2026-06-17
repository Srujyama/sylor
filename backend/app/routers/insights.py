"""
Narrative dashboard digest.

POST /api/insights/digest builds a cheap, friendly summary of what changed in
the authenticated user's simulations since their last visit. It is pure
aggregation over the user's simulation documents plus ONE llm_client.chat call
that turns the item list into a single headline sentence (deterministic
template fallback). NO per-simulation LLM calls are made.
"""
import logging
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.middleware.auth import get_current_user
from app.services.llm_client import llm_client
from app.services.firebase_admin import query_collection

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/insights", tags=["insights"])

COLLECTION = "simulations"

# Simulations untouched for longer than this are flagged "stale".
_STALE_DAYS = 14
# Cap how many stale items we surface so the digest stays terse.
_MAX_STALE = 3


class DigestRequest(BaseModel):
    # The client's stored last-visit timestamp (ISO 8601). When omitted, every
    # completed simulation counts as "updated since last seen".
    last_seen_at: Optional[str] = None


def _parse_iso(value: Optional[str]) -> Optional[datetime]:
    """Parse an ISO timestamp leniently; return None on failure/absence."""
    if not value:
        return None
    try:
        # Tolerate a trailing 'Z' (UTC) which fromisoformat rejects pre-3.11 edge cases.
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def _naive(dt: datetime) -> datetime:
    """Drop tzinfo so naive (utcnow-style) and aware timestamps compare cleanly."""
    return dt.replace(tzinfo=None) if dt.tzinfo is not None else dt


@router.post("/digest")
async def dashboard_digest(
    request: DigestRequest,
    user: dict = Depends(get_current_user),
):
    """Build a narrative digest of the user's simulation activity.

    Items:
      - "completed": simulations updated since ``last_seen_at`` that are
        completed (carrying their success %).
      - "stale": simulations not updated in more than 14 days (capped at 3).

    One LLM chat call composes a single friendly headline from the items
    (template fallback on failure). Cheap aggregation; owner-scoped.
    """
    sims = await query_collection(COLLECTION, [("user_id", "==", user["uid"])])

    last_seen = _parse_iso(request.last_seen_at)
    last_seen = _naive(last_seen) if last_seen else None
    now = datetime.utcnow()
    stale_cutoff = now - timedelta(days=_STALE_DAYS)

    completed_items: List[dict] = []
    stale_items: List[dict] = []

    for sim in sims:
        updated = _parse_iso(sim.get("updated_at"))
        updated = _naive(updated) if updated else None
        status = sim.get("status")
        name = sim.get("name") or "Untitled simulation"
        sim_id = sim.get("id")

        # Completed runs updated since the client's last visit.
        is_recent = last_seen is None or (updated is not None and updated > last_seen)
        if status == "completed" and is_recent:
            results = sim.get("results")
            success = (
                results.get("success_probability")
                if isinstance(results, dict) else None
            )
            # Guard against a legacy/corrupted non-numeric value so one bad
            # document can't 500 the whole digest (mirrors analytics.py).
            if isinstance(success, (int, float)):
                text = f"{name} finished with a {float(success):.0f}% success probability."
            else:
                text = f"{name} finished running."
            completed_items.append({
                "type": "completed",
                "text": text,
                "sim_id": sim_id,
                "_updated": updated,
            })

        # Stale simulations untouched for > _STALE_DAYS.
        if updated is not None and updated < stale_cutoff:
            days = (now - updated).days
            stale_items.append({
                "type": "stale",
                "text": f"{name} hasn't been touched in {days} days.",
                "sim_id": sim_id,
                "_updated": updated,
            })

    # Newest completed first; oldest (most stale) first, capped.
    completed_items.sort(key=lambda i: i["_updated"] or datetime.min, reverse=True)
    stale_items.sort(key=lambda i: i["_updated"] or datetime.min)
    stale_items = stale_items[:_MAX_STALE]

    items = [
        {k: v for k, v in i.items() if k != "_updated"}
        for i in completed_items + stale_items
    ]

    # ── Headline: ONE LLM call over the aggregated items (template fallback) ──
    n_completed = len(completed_items)
    n_stale = len(stale_items)
    if not items:
        fallback_headline = "No new simulation activity — start a run to see insights here."
    elif n_completed and n_stale:
        fallback_headline = (
            f"{n_completed} simulation{'s' if n_completed != 1 else ''} finished recently, "
            f"and {n_stale} {'are' if n_stale != 1 else 'is'} going stale."
        )
    elif n_completed:
        fallback_headline = (
            f"{n_completed} simulation{'s' if n_completed != 1 else ''} finished since your last visit."
        )
    else:
        fallback_headline = (
            f"{n_stale} simulation{'s' if n_stale != 1 else ''} {'have' if n_stale != 1 else 'has'} "
            "gone quiet — time for a fresh run?"
        )

    headline = fallback_headline
    try:
        item_lines = "\n".join(f"- {i['text']}" for i in items)
        resp = await llm_client.chat(
            messages=[{
                "role": "user",
                "content": (
                    "Here is a list of recent updates on a user's simulation "
                    f"dashboard:\n{item_lines}\n\n"
                    "Write ONE short, friendly headline sentence summarizing this "
                    "activity for the user. No preamble, just the sentence."
                ),
            }],
            temperature=0.6,
            max_tokens=80,
        )
        if resp.text.strip():
            headline = resp.text.strip()
    except Exception as exc:
        logger.warning("Digest headline generation failed for user %s: %s", user["uid"], exc)

    return {"headline": headline, "items": items}
