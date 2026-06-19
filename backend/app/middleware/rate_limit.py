"""
In-memory sliding-window rate limiter for FastAPI.

Three tiers:
  - Unauthenticated (per-IP): 30 req/min
  - Authenticated (per-user): 60 req/min
  - Expensive operations (per-user): 10 req/min

Identity: bearer tokens are VERIFIED (via Firebase) before being used as a
rate-limit key, so attackers cannot escape per-IP limits by rotating fake
tokens. Verification results are cached by sha256(token) with a short TTL
to avoid re-verifying on every request.
"""
import hashlib
import logging
import time
from collections import defaultdict
from typing import Optional

from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from app.services.firebase_admin import verify_id_token

logger = logging.getLogger(__name__)

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
    "/api/simulations/{sim_id}/run/stream",
    "/api/simulations/{sim_id}/sweep",
    "/api/simulations/{sim_id}/tornado",
    "/api/simulations/{sim_id}/whatif",
    "/api/simulations/{sim_id}/diff",
    "/api/simulations/{sim_id}/explain",
    "/api/context/analyze",
    "/api/reports/generate",
    "/api/reports/generate-sync",
    "/api/reports/memo",
    "/api/reports/chat",
    "/api/simulations/{sim_id}/branch",
    "/api/simulations/{sim_id}/copilot",
    "/api/simulations/{sim_id}/calibrate",
    "/api/simulations/{sim_id}/hero-run",
    "/api/graphs/{graph_id}/intervene",
    "/api/demo/run",
    "/api/projects/{project_id}/build-graph",
    "/api/projects/{project_id}/generate-profiles",
    "/api/projects/{project_id}/run-simulation",
    "/api/projects/{project_id}/generate-report",
    "/api/projects/{project_id}/chat",
)

# Concrete path segments that signal an expensive operation (matched after
# stripping dynamic IDs). We match on the *last* path segment, the last two
# joined with "-" (e.g. "generate-profiles"), or the last two joined with
# "/" (e.g. "run/stream").
_EXPENSIVE_SUFFIXES = {
    "run", "sweep", "analyze", "generate", "generate-sync",
    "chat", "build-graph", "generate-profiles", "generate-report",
    "run-simulation", "run/stream", "tornado", "whatif",
    "memo", "branch", "copilot", "diff", "explain",
    "calibrate", "intervene", "optimize", "hero-run",
}

# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------
# NOTE: all rate-limit state below is in-memory and therefore PER-PROCESS.
# With multiple workers (uvicorn --workers N) or multiple machines, each
# process enforces its own independent window, so the effective global limit
# is roughly N x the configured limit. Move to a shared store (e.g. Redis)
# if strict global enforcement is ever needed.
#
# _buckets maps (identifier, tier) -> list of request timestamps
_buckets: dict[tuple[str, str], list[float]] = defaultdict(list)
_last_cleanup: float = 0.0
_CLEANUP_INTERVAL = 120  # seconds between full garbage-collection sweeps

# Token-verification cache: sha256(token) -> (uid or None, verified_at).
# A None uid means verification failed; those requests fall back to the
# per-IP unauthenticated tier. Per-process, like the buckets above.
_token_cache: dict[str, tuple[Optional[str], float]] = {}
_TOKEN_CACHE_TTL = 300   # seconds a verification result stays valid
_TOKEN_CACHE_MAX = 5000  # hard cap to bound memory


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
    # Also prune expired token-verification entries
    token_cutoff = now - _TOKEN_CACHE_TTL
    for digest in [d for d, (_, ts) in _token_cache.items() if ts < token_cutoff]:
        del _token_cache[digest]


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
    if len(parts) >= 2:
        # Check last two segments joined (e.g. "generate-profiles")
        combo = f"{parts[-2]}-{parts[-1]}"
        if combo in _EXPENSIVE_SUFFIXES:
            return True
        # Check last two segments as a sub-path (e.g. "run/stream")
        combo_path = f"{parts[-2]}/{parts[-1]}"
        if combo_path in _EXPENSIVE_SUFFIXES:
            return True
    return False


def _get_client_ip(request: Request) -> str:
    """Best-effort client IP extraction.

    The first entry of x-forwarded-for is client-controlled and trivially
    spoofable, so it is NOT used. We prefer, in order:
      1. fly-client-ip — set by the Fly.io edge proxy (deploy target).
      2. The LAST x-forwarded-for entry — appended by the proxy closest
         to this app, not by the client.
      3. The direct socket peer address.
    """
    fly_ip = request.headers.get("fly-client-ip")
    if fly_ip:
        return fly_ip.strip()
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[-1].strip()
    if request.client:
        return request.client.host
    return "unknown"


async def _resolve_uid(token: str) -> Optional[str]:
    """Verify a bearer token and return its uid, with sha256-keyed caching.

    Returns None when verification fails (caller should treat the request
    as anonymous / per-IP).
    """
    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    now = time.monotonic()
    cached = _token_cache.get(digest)
    if cached is not None and now - cached[1] < _TOKEN_CACHE_TTL:
        return cached[0]

    uid: Optional[str] = None
    try:
        claims = await verify_id_token(token)
        uid = claims.get("uid")
    except Exception as exc:
        logger.debug("Rate limiter token verification failed: %s", exc)

    if len(_token_cache) >= _TOKEN_CACHE_MAX:
        _token_cache.clear()
    _token_cache[digest] = (uid, now)
    return uid


async def _identify(request: Request) -> tuple[str, str, int]:
    """Resolve a request to (identifier, tier, limit).

    Only VERIFIED tokens get the per-user authenticated tier; anything
    else (no token, malformed token, failed verification) is keyed by
    client IP at the stricter unauthenticated limit.
    """
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer ") and len(auth_header) > 7:
        uid = await _resolve_uid(auth_header[7:])
        if uid:
            return f"user:{uid}", "auth", AUTH_LIMIT
    return f"ip:{_get_client_ip(request)}", "unauth", UNAUTH_LIMIT


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

        identifier, tier, base_limit = await _identify(request)

        # --- General rate limit ---
        allowed, retry_after = _is_allowed(identifier, tier, base_limit)
        if not allowed:
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests. Please slow down."},
                headers={"Retry-After": str(retry_after)},
            )

        # --- Expensive-endpoint rate limit ---
        if _is_expensive_path(path):
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

    Use this on individual endpoints to document intent and to protect any
    endpoint whose path is NOT in ``_EXPENSIVE_SUFFIXES``. When the middleware
    already classifies this path as expensive it has consumed a slot from the
    ``(identifier, "expensive")`` bucket, so we MUST NOT consume a second one
    here — doing so would silently halve the effective limit (e.g. 5/min
    instead of 10/min) for endpoints that carry both. In that case this is a
    no-op and the middleware is the single enforcement point.
    """
    if _is_expensive_path(request.url.path):
        return  # already counted by the middleware — avoid double counting

    identifier, _tier, _limit = await _identify(request)

    allowed, retry_after = _is_allowed(identifier, "expensive", EXPENSIVE_LIMIT)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded for this operation. Please wait.",
            headers={"Retry-After": str(retry_after)},
        )
