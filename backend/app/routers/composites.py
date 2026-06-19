"""
Cross-domain composite simulations router.

A composite is a DAG of sub-simulations linked by metric->variable edges. See
``app.services.composite`` for the execution model (per-path uncertainty
propagation for per-path links, mean-passing for aggregate links).

All endpoints are owner-scoped (Bearer auth via ``get_current_user`` + explicit
403). Composites live in the owner-scoped ``composites`` Firestore collection,
written exclusively by the Admin SDK. ``POST /{id}/run`` is expensive (the
``run`` suffix is already classified by the rate-limit middleware).
"""
import logging
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.middleware.auth import get_current_user
from app.middleware.rate_limit import require_expensive_rate_limit
from app.services.composite import (
    CompositeConfig,
    CompositeValidationError,
    MAX_NODES,
    MAX_NUM_RUNS,
    MIN_NUM_RUNS,
    narrate_composite,
    run_composite,
    validate_dag,
)
from app.services.firebase_admin import (
    delete_document,
    get_db,
    get_document,
    query_collection,
    update_document,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/composites", tags=["composites"])

COLLECTION = "composites"


class RunCompositeRequest(BaseModel):
    num_runs: Optional[int] = Field(default=None, ge=MIN_NUM_RUNS, le=MAX_NUM_RUNS)


def _parse_config(raw: dict) -> CompositeConfig:
    """Parse + structurally validate a composite payload, raising 422 on error.

    Validates sub-sim configs (``SimulationConfig``), node count + num_runs
    bounds, and the DAG (unknown refs / cycle). Returns the parsed config.
    """
    try:
        composite = CompositeConfig.from_dict(raw)
    except CompositeValidationError:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Invalid composite config: {exc}")

    if not composite.nodes:
        raise HTTPException(status_code=422, detail="Composite must have at least one node.")
    if len(composite.nodes) > MAX_NODES:
        raise HTTPException(
            status_code=422,
            detail=f"Composite has too many nodes ({len(composite.nodes)}); max is {MAX_NODES}.",
        )
    if composite.num_runs < MIN_NUM_RUNS or composite.num_runs > MAX_NUM_RUNS:
        raise HTTPException(
            status_code=422,
            detail=f"num_runs must be between {MIN_NUM_RUNS} and {MAX_NUM_RUNS}.",
        )

    # DAG validation (unknown node_id / to_variable refs, cycles -> 422).
    try:
        validate_dag(composite)
    except CompositeValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    return composite


@router.post("", status_code=201)
async def create_composite(payload: dict, user: dict = Depends(get_current_user)):
    """Create + persist a composite. 422 on bad refs / cycle / bounds."""
    try:
        composite = _parse_config(payload)
    except CompositeValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    composite_id = f"comp_{uuid.uuid4().hex[:12]}"
    now = datetime.utcnow().isoformat()
    doc = {
        "id": composite_id,
        "composite_id": composite_id,
        "user_id": user["uid"],
        "name": composite.name,
        "config": composite.to_dict(),
        "status": "created",
        "results": None,
        "node_count": len(composite.nodes),
        "created_at": now,
        "updated_at": now,
    }

    db = get_db()
    await db.collection(COLLECTION).document(composite_id).set(doc)
    return {"composite_id": composite_id, "status": "created"}


@router.get("")
async def list_composites(user: dict = Depends(get_current_user)):
    """List the caller's composites (summary view)."""
    docs = await query_collection(COLLECTION, [("user_id", "==", user["uid"])])
    composites = [
        {
            "composite_id": d.get("composite_id") or d.get("id"),
            "name": d.get("name"),
            "status": d.get("status"),
            "node_count": d.get("node_count", len((d.get("config") or {}).get("nodes", []))),
            "created_at": d.get("created_at"),
        }
        for d in docs
    ]
    composites.sort(key=lambda c: c.get("created_at") or "", reverse=True)
    return {"composites": composites}


async def _load_owned(composite_id: str, user: dict) -> dict:
    """Fetch a composite, enforcing existence (404) and ownership (403)."""
    doc = await get_document(COLLECTION, composite_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Composite not found")
    if doc.get("user_id") != user["uid"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    return doc


@router.get("/{composite_id}")
async def get_composite(composite_id: str, user: dict = Depends(get_current_user)):
    """Return the full stored composite (incl. results if run).

    The composite's nodes/links/num_runs are stored nested under ``config``;
    lift them to the top level so clients can read them directly (the stored
    ``config`` block is preserved for reference).
    """
    doc = await _load_owned(composite_id, user)
    config = doc.get("config") or {}
    # Spread config fields (nodes/links/num_runs/name) to the top level without
    # clobbering top-level keys the doc already owns (id, status, results, ...).
    return {**config, **doc}


@router.delete("/{composite_id}", status_code=204)
async def delete_composite(composite_id: str, user: dict = Depends(get_current_user)):
    await _load_owned(composite_id, user)
    await delete_document(COLLECTION, composite_id)


@router.post("/{composite_id}/run", dependencies=[Depends(require_expensive_rate_limit)])
async def run_composite_endpoint(
    composite_id: str,
    request: RunCompositeRequest,
    user: dict = Depends(get_current_user),
):
    """Run the composite, persist results, and return them.

    Per-path uncertainty propagation for per-path links; mean-passing for
    aggregate links. ``num_runs`` overrides the stored default (capped at
    ``MAX_NUM_RUNS``). 409 if the composite has no nodes.
    """
    doc = await _load_owned(composite_id, user)

    try:
        composite = CompositeConfig.from_dict(doc.get("config") or {})
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Stored composite config is invalid: {exc}")

    if not composite.nodes:
        raise HTTPException(status_code=409, detail="Composite has no nodes to run.")

    try:
        response = run_composite(composite, num_runs=request.num_runs)
    except CompositeValidationError as exc:
        # A previously-valid composite could only fail validation if mutated;
        # surface as 422 rather than a 500.
        raise HTTPException(status_code=422, detail=str(exc))

    # One LLM call for the narrative (template fallback inside).
    response["summary"] = await narrate_composite(response, composite.name)

    response["composite_id"] = composite_id

    now = datetime.utcnow().isoformat()
    try:
        await update_document(COLLECTION, composite_id, {
            "status": "completed",
            "results": response,
            "updated_at": now,
        })
    except Exception as exc:
        logger.warning("Failed to persist composite results %s: %s", composite_id, exc)

    return response
