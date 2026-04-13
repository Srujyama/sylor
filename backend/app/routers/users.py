"""
User profile endpoints.
Manages user profiles and preferences stored in Firestore.
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

from app.middleware.auth import get_current_user
from app.services.firebase_admin import get_document, update_document, delete_document, query_collection, get_db

router = APIRouter(prefix="/api/users", tags=["users"])

PROFILES = "profiles"
SIMULATIONS = "simulations"


class ProfileUpdate(BaseModel):
    fullName: Optional[str] = None
    avatarUrl: Optional[str] = None
    preferences: Optional[dict] = None  # defaultRuns, defaultHorizon, autoRunOnCreate, etc.
    notifications: Optional[dict] = None  # emailOnComplete, emailOnFail, weeklyDigest


@router.get("/me")
async def get_my_profile(user: dict = Depends(get_current_user)):
    profile = await get_document(PROFILES, user["uid"])
    if not profile:
        # Auto-create minimal profile if missing
        db = get_db()
        profile_data = {
            "uid": user["uid"],
            "email": user.get("email", ""),
            "fullName": user.get("name", ""),
            "avatarUrl": "",
            "plan": "free",
            "simulationCount": 0,
            "preferences": {},
            "notifications": {},
            "createdAt": datetime.utcnow().isoformat(),
            "updatedAt": datetime.utcnow().isoformat(),
        }
        await db.collection(PROFILES).document(user["uid"]).set(profile_data)
        return {"id": user["uid"], **profile_data}
    return profile


@router.patch("/me")
async def update_my_profile(update: ProfileUpdate, user: dict = Depends(get_current_user)):
    profile = await get_document(PROFILES, user["uid"])
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    data = {}
    if update.fullName is not None:
        data["fullName"] = update.fullName
    if update.avatarUrl is not None:
        data["avatarUrl"] = update.avatarUrl
    if update.preferences is not None:
        data["preferences"] = update.preferences
    if update.notifications is not None:
        data["notifications"] = update.notifications

    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")

    data["updatedAt"] = datetime.utcnow().isoformat()
    await update_document(PROFILES, user["uid"], data)
    return {**profile, **data}


@router.get("/me/usage")
async def get_my_usage(user: dict = Depends(get_current_user)):
    sims = await query_collection(SIMULATIONS, [("user_id", "==", user["uid"])])
    completed = [s for s in sims if s.get("status") == "completed"]
    categories = list(set(s.get("category", "custom") for s in sims))

    total_runs = sum(s.get("run_count", 0) for s in sims)
    avg_success = 0.0
    if completed:
        probs = [s.get("results", {}).get("success_probability", 0) for s in completed if s.get("results")]
        avg_success = sum(probs) / len(probs) if probs else 0.0

    return {
        "total_simulations": len(sims),
        "completed_simulations": len(completed),
        "total_runs": total_runs,
        "avg_success_rate": round(avg_success, 1),
        "categories_used": categories,
        "last_active": max((s.get("updated_at", "") for s in sims), default=None),
    }


@router.delete("/me", status_code=204)
async def delete_my_account(user: dict = Depends(get_current_user)):
    # Delete all user simulations
    sims = await query_collection(SIMULATIONS, [("user_id", "==", user["uid"])])
    for sim in sims:
        await delete_document(SIMULATIONS, sim["id"])

    # Delete profile
    try:
        await delete_document(PROFILES, user["uid"])
    except Exception:
        pass
