"""
In-memory sliding-window rate limiter for FastAPI.

Three tiers:
  - Unauthenticated (per-IP): 30 req/min
  - Authenticated (per-user): 60 req/min
  - Expensive operations (per-user): 10 req/min
"""
import time
import asyncio
from collections import defaultdict
from typing import Optional

from fastapi import Request, HTTPException, Depends
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
DEFAULT_WINDOW = 60  # seconds
UNAUTH_LIMIT = 30   # requests per window for unauthenticated
AUTH_LIMIT = 60      # requests per window for authenticated
EXPENSIVE_LIMIT = 10 # requests per window for expensive operations

# Paths (prefix-matched) that count as expensive operations
EXPENSIVE_PREFIXES = (
    "/api/simulations/{sim_id}/run",
    "/api/simulations/{sim_id}/sweep",
    "/api/context/analyze",
    "/api/reports/generate",
    "/api/reports/generate-sync",
    "/api/reports/chat",
    "/api/projects/{project_id}/build-graph",
    "/api/projects/{project_id}/generate-profiles",
    "/api/projects/{project_id}/generate-report",
    "/api/projects/{project_id}/chat",
)

# Concrete path segments that signal an expensive operation (matched after
# stripping dynamic IDs). We match on the *last* path segment or the last two.
_EXPENSIVE_SUFFIXES = {
    "run", "sweep", "analyze", "generate", "generate-sync",
    "chat", "build-graph", "generate-profiles", "generate-report",
}

# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------
# _buckets maps (identifier, tier) -> list of request timestamps
_buckets: dict[tuple[str, str], list[float]] = defaultdict(list)
_last_cleanup: float = 0.0
_CLEANUP_INTERVAL = 120  # seconds between full garbage-collection sweeps


def _cleanup_expired() -> None:
    """Remove timestamps older than the window from all buckets."""
    global _last_cleanup
    now = time.monotonic()
    if now - _last_cleanup < _CLEANUP_INTERVAL:
        return
    _last_cleanup = now
    cutoff = now - DEFAULT_WINDOW
    dead_keys = []
    for key, timestamps in _buckets.items():
        _buckets[key] = [t for t in timestamps if t > cutoff]
        if not _buckets[key]:
            dead_keys.append(key)
    for key in dead_keys:
        del _buckets[key]


def _is_allowed(identifier: str, tier: str, limit: int) -> tuple[bool, int]:
    """Check whether *identifier* may proceed under *tier*.

    Returns (allowed, retry_after_seconds).
    """
    _cleanup_expired()
    now = time.monotonic()
    cutoff = now - DEFAULT_WINDOW
    key = (identifier, tier)
    timestamps = _buckets[key]
    # Prune stale entries for this key
    timestamps[:] = [t for t in timestamps if t > cutoff]
    if len(timestamps) >= limit:
        oldest = timestamps[0]
        retry_after = int(oldest + DEFAULT_WINDOW - now) + 1
        return False, max(retry_after, 1)
    timestamps.append(now)
    return True, 0


def _is_expensive_path(path: str) -> bool:
    """Return True if *path* maps to an expensive operation."""
    parts = path.rstrip("/").split("/")
    # Check last segment
    if parts and parts[-1] in _EXPENSIVE_SUFFIXES:
        return True
    # Check last two segments joined (e.g. "generate-profiles")
    if len(parts) >= 2:
        combo = f"{parts[-2]}-{parts[-1]}"
        if combo in _EXPENSIVE_SUFFIXES:
            return True
    return False


def _get_client_ip(request: Request) -> str:
    """Best-effort client IP extraction."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return "unknown"


# ---------------------------------------------------------------------------
# Middleware (applies globally)
# ---------------------------------------------------------------------------

class RateLimitMiddleware(BaseHTTPMiddleware):
    """Sliding-window rate limiter applied as ASGI middleware."""

    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # Skip rate limiting for docs / health / root
        if path in ("/", "/health", "/docs", "/redoc", "/openapi.json"):
            return await call_next(request)

        # Determine identity: prefer user uid from auth state (set downstream),
        # but at middleware level we only have headers, so peek at the token
        # presence to decide tier.
        auth_header = request.headers.get("authorization", "")
        has_token = auth_header.startswith("Bearer ") and len(auth_header) > 7

        if has_token:
            # Use the token's first 32 chars as a stable per-user key
            # (full token is long; first 32 is unique enough for bucketing)
            identifier = f"user:{auth_header[7:39]}"
            base_limit = AUTH_LIMIT
            tier = "auth"
        else:
            identifier = f"ip:{_get_client_ip(request)}"
            base_limit = UNAUTH_LIMIT
            tier = "unauth"

        # --- General rate limit ---
        allowed, retry_after = _is_allowed(identifier, tier, base_limit)
        if not allowed:
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests. Please slow down."},
                headers={"Retry-After": str(retry_after)},
            )

        # --- Expensive-endpoint rate limit (authenticated only) ---
        if has_token and _is_expensive_path(path):
            allowed, retry_after = _is_allowed(identifier, "expensive", EXPENSIVE_LIMIT)
            if not allowed:
                return JSONResponse(
                    status_code=429,
                    content={
                        "detail": "Rate limit exceeded for expensive operations. Please wait before running more simulations or analyses.",
                    },
                    headers={"Retry-After": str(retry_after)},
                )

        response = await call_next(request)
        return response


# ---------------------------------------------------------------------------
# Dependency alternative (can be injected per-router for fine control)
# ---------------------------------------------------------------------------

async def require_expensive_rate_limit(request: Request):
    """FastAPI dependency that enforces the strict expensive-operation limit.

    Use this on individual endpoints when you want belt-and-suspenders
    protection on top of the middleware.
    """
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer ") and len(auth_header) > 7:
        identifier = f"user:{auth_header[7:39]}"
    else:
        identifier = f"ip:{_get_client_ip(request)}"

    allowed, retry_after = _is_allowed(identifier, "expensive", EXPENSIVE_LIMIT)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded for this operation. Please wait.",
            headers={"Retry-After": str(retry_after)},
        )
