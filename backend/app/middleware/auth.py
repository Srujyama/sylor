"""
Firebase Auth middleware for FastAPI.
Verifies ID tokens from the Authorization header and returns user claims.
"""
from fastapi import HTTPException, Header
from typing import Optional
from app.services.firebase_admin import verify_id_token


async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    """Extract and verify Firebase ID token from Authorization header.

    Returns decoded token claims with at minimum: uid, email.
    """
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")

    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authorization header must be Bearer token")

    token = authorization[7:]  # Strip "Bearer "
    if not token:
        raise HTTPException(status_code=401, detail="Empty token")

    try:
        claims = await verify_id_token(token)
        return claims
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


async def get_optional_user(authorization: Optional[str] = Header(None)) -> Optional[dict]:
    """Like get_current_user but returns None instead of 401 for unauthenticated requests."""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization[7:]
    if not token:
        return None
    try:
        claims = await verify_id_token(token)
        return claims
    except Exception:
        return None
