"""
Zero-signup demo endpoints.

``POST /api/demo/run`` is PUBLIC (no auth) — it runs the engine inline on one of
three hardcoded preset configs and returns the results WITHOUT persisting them
to any user. Because it is anonymous it relies on the per-IP unauthenticated
rate-limit tier already enforced by ``RateLimitMiddleware`` (anon requests fall
to per-IP in ``_identify``). It is also classified expensive via the '/api/demo/run'
prefix in the middleware.

``POST /api/demo/claim`` is AUTHED — once a visitor signs in, it persists the
demo they just ran as a normal owner-scoped ``simulations`` document.
"""
import logging
import secrets
import uuid
from datetime import datetime
from typing import Dict, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.models.simulation import SimulationConfig, SimulationResults, SimulationStatus
from app.services.simulation_engine import SimulationEngine
from app.middleware.auth import get_current_user
from app.services.firebase_admin import get_db, query_collection

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/demo", tags=["demo"])

COLLECTION = "simulations"

# Hard cap on demo runs to keep the public endpoint cheap.
_DEMO_MAX_RUNS = 500

# ---------------------------------------------------------------------------
# Preset configs (module constants)
# ---------------------------------------------------------------------------

_PRESET_SAAS: Dict = {
    "name": "SaaS Startup (demo)",
    "description": "A seed-stage SaaS company seeking product-market fit.",
    "category": "startup",
    "variables": [
        {"name": "budget", "label": "Monthly Budget", "type": "currency",
         "value": 50000, "min": 10000, "max": 200000, "unit": "$"},
        {"name": "price_per_unit", "label": "Price / Seat", "type": "currency",
         "value": 99, "min": 19, "max": 499, "unit": "$"},
        {"name": "market_size", "label": "Addressable Market", "type": "number",
         "value": 1000000, "min": 100000, "max": 10000000},
        {"name": "conversion_rate", "label": "Conversion Rate", "type": "percentage",
         "value": 5, "min": 1, "max": 15, "unit": "%"},
        {"name": "churn_rate", "label": "Monthly Churn", "type": "percentage",
         "value": 4, "min": 1, "max": 12, "unit": "%"},
    ],
    "agents": [
        {"type": "customer", "name": "Subscribers", "count": 200, "sensitivity": 0.7},
        {"type": "competitor", "name": "Incumbent", "count": 1, "sensitivity": 0.6},
        {"type": "market", "name": "Macro Climate", "count": 1, "sensitivity": 0.5},
        {"type": "investor", "name": "Seed VC", "count": 1, "sensitivity": 0.6},
    ],
    "num_runs": 300,
    "time_horizon": 12,
}

_PRESET_PRICING: Dict = {
    "name": "Pricing Experiment (demo)",
    "description": "A pricing-power study for an established SaaS product.",
    "category": "pricing",
    "variables": [
        {"name": "budget", "label": "Monthly Budget", "type": "currency",
         "value": 80000, "min": 20000, "max": 300000, "unit": "$"},
        {"name": "price_per_unit", "label": "Price / Seat", "type": "currency",
         "value": 149, "min": 49, "max": 599, "unit": "$"},
        {"name": "market_size", "label": "Addressable Market", "type": "number",
         "value": 2000000, "min": 200000, "max": 20000000},
        {"name": "conversion_rate", "label": "Conversion Rate", "type": "percentage",
         "value": 4, "min": 1, "max": 12, "unit": "%"},
        {"name": "churn_rate", "label": "Monthly Churn", "type": "percentage",
         "value": 3, "min": 1, "max": 10, "unit": "%"},
    ],
    "agents": [
        {"type": "customer", "name": "Buyers", "count": 400, "sensitivity": 0.85},
        {"type": "competitor", "name": "Price Rival", "count": 1, "sensitivity": 0.75},
        {"type": "market", "name": "Macro Climate", "count": 1, "sensitivity": 0.5},
    ],
    "num_runs": 300,
    "time_horizon": 12,
}

_PRESET_PORTFOLIO: Dict = {
    "name": "Portfolio Strategy (demo)",
    "description": "A diversified trading portfolio under market volatility.",
    "category": "finance",
    "variables": [
        {"name": "portfolio_value", "label": "Starting Capital", "type": "currency",
         "value": 100000, "min": 10000, "max": 1000000, "unit": "$"},
        {"name": "volatility", "label": "Annual Volatility", "type": "percentage",
         "value": 20, "min": 5, "max": 60, "unit": "%"},
        {"name": "num_assets", "label": "Number of Assets", "type": "number",
         "value": 5, "min": 1, "max": 30},
        {"name": "risk_tolerance", "label": "Target Return", "type": "percentage",
         "value": 50, "min": 10, "max": 100, "unit": "%"},
    ],
    "agents": [
        {"type": "trader", "name": "Momentum Desk", "count": 5, "sensitivity": 0.7},
        {"type": "market_maker", "name": "Liquidity Provider", "count": 1, "sensitivity": 0.6},
        {"type": "market", "name": "Macro Climate", "count": 1, "sensitivity": 0.5},
    ],
    "num_runs": 300,
    "time_horizon": 12,
}

_PRESETS: Dict[str, Dict] = {
    "saas": _PRESET_SAAS,
    "pricing": _PRESET_PRICING,
    "portfolio": _PRESET_PORTFOLIO,
}


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class DemoRunRequest(BaseModel):
    preset: Literal["saas", "pricing", "portfolio"]
    overrides: Optional[Dict[str, float]] = None


class DemoClaimRequest(BaseModel):
    demo_id: str = Field(min_length=1, max_length=64)
    config: Dict
    results: Dict


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/run")
async def run_demo(request: DemoRunRequest):
    """PUBLIC: run a preset simulation inline and return results unpersisted.

    No auth — anonymous requests are rate-limited per-IP by the middleware. The
    engine runs inline with num_runs hard-capped at 500.
    """
    preset_dict = _PRESETS.get(request.preset)
    if preset_dict is None:  # pragma: no cover - guarded by Literal
        raise HTTPException(status_code=422, detail="Unknown preset")

    # Build the config from the preset, applying numeric overrides onto matching
    # variables. Hard-cap num_runs at 500 to keep the public endpoint cheap.
    config_dict = dict(preset_dict)
    config_dict["num_runs"] = min(int(config_dict.get("num_runs", 300)), _DEMO_MAX_RUNS)

    try:
        config = SimulationConfig(**config_dict)
    except Exception as exc:
        logger.warning("Demo preset %s failed validation: %s", request.preset, exc)
        raise HTTPException(status_code=500, detail="Demo preset is misconfigured")

    overrides = None
    if request.overrides:
        valid_names = {v.name for v in config.variables}
        overrides = {
            k: float(v) for k, v in request.overrides.items() if k in valid_names
        }
        overrides = overrides or None

    engine = SimulationEngine(config)
    results = await engine.run(num_runs=config.num_runs, variable_overrides=overrides)

    demo_id = secrets.token_urlsafe(8)
    return {
        "results": results.model_dump(mode="json"),
        "config": config.model_dump(mode="json"),
        "demo_id": demo_id,
    }


@router.post("/claim")
async def claim_demo(request: DemoClaimRequest, user: dict = Depends(get_current_user)):
    """AUTHED: persist a previously-run demo as an owner-scoped simulation.

    The client-supplied config AND results are both validated against the
    engine's models so a caller cannot persist forged/oversized data as a
    "completed" simulation. The claim is idempotent on (user_id, demo_id): a
    repeat claim (e.g. after a dropped response) returns the existing sim id
    instead of creating a duplicate.
    """
    try:
        config = SimulationConfig(**request.config)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Invalid demo config: {exc}")

    # Validate results against the engine contract — rejects forged shapes and
    # implicitly bounds the payload to the model's fixed fields.
    try:
        results = SimulationResults(**request.results)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Invalid demo results: {exc}")

    # A demo claim never needs uploaded data or freeform company context; drop
    # them so an oversized claim body can't be persisted via those open dicts.
    config.uploaded_data = None
    config.company_context = None

    # Idempotency: if this user already claimed this demo_id, return it.
    existing = await query_collection(
        COLLECTION,
        [("user_id", "==", user["uid"]), ("demo_id", "==", request.demo_id)],
    )
    if existing:
        return {"simulation_id": existing[0].get("id")}

    sim_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    sim = {
        "id": sim_id,
        "user_id": user["uid"],
        "demo_id": request.demo_id,
        "name": config.name,
        "description": config.description,
        "category": config.category.value,
        "config": config.model_dump(mode="json"),
        "status": SimulationStatus.COMPLETED.value,
        "results": results.model_dump(mode="json"),
        "created_at": now,
        "updated_at": now,
        "run_count": 1,
        # A claimed demo is its own root in the scenario tree.
        "parent_id": None,
        "root_id": sim_id,
        "branch_label": None,
    }

    db = get_db()
    await db.collection(COLLECTION).document(sim_id).set(sim)
    return {"simulation_id": sim_id}
