"""
Run-history recording for completed simulation runs.

Every successful engine completion (regular run, SSE stream, and the project
pipeline) appends a document to the ``simulation_runs`` collection so users
can see how a simulation's outcomes evolved across runs.

Fields are snake_case to match the Admin SDK conventions used by the backend
(`firestore.rules` / `firestore.indexes.json` are reconciled to this casing).
"""
import logging
import uuid
from datetime import datetime
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

RUNS_COLLECTION = "simulation_runs"


async def record_run(
    sim_id: str,
    user_id: Optional[str],
    num_runs: int,
    results: Any,
    variable_overrides: Optional[Dict[str, float]] = None,
) -> Optional[str]:
    """Append a run-history document for a completed engine run.

    Best-effort: failures are logged, never raised, so history recording can
    never break the run path itself. Returns the run doc id, or None on
    failure.
    """
    run_id = str(uuid.uuid4())
    doc = {
        "id": run_id,
        "simulation_id": sim_id,
        "user_id": user_id,
        "created_at": datetime.utcnow().isoformat(),
        "num_runs": num_runs,
        "success_probability": getattr(results, "success_probability", None),
        "avg_revenue": getattr(results, "avg_revenue", None),
        "variable_overrides": dict(variable_overrides) if variable_overrides else None,
    }
    try:
        # Imported at call time so test patches on the source module apply.
        from app.services.firebase_admin import get_db
        db = get_db()
        await db.collection(RUNS_COLLECTION).document(run_id).set(doc)
        logger.info("Recorded run %s for simulation %s", run_id, sim_id)
        return run_id
    except Exception as exc:
        logger.warning("Failed to record run history for simulation %s: %s", sim_id, exc)
        return None
