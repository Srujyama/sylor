"""
Tests for the sliding-window rate limiter middleware.

Validates per-IP limits, per-user limits, 429 responses with
Retry-After headers, cleanup of expired entries, and exemptions
for health/docs endpoints.
"""
import time
import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient

from app.main import app
from app.middleware import rate_limit as rl_module


# We need to reset the rate limiter's internal state between tests so
# bucket counts from one test don't leak into the next.

@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """Clear all rate-limit buckets before and after each test."""
    rl_module._buckets.clear()
    rl_module._last_cleanup = 0.0
    yield
    rl_module._buckets.clear()
    rl_module._last_cleanup = 0.0


# Use the mock_firebase fixture from conftest so auth middleware is mocked.
AUTH_HEADER = {"Authorization": "Bearer valid-token"}


# ---------------------------------------------------------------------------
# Requests under the limit
# ---------------------------------------------------------------------------

class TestUnderLimit:
    def test_single_request_passes(self, mock_firebase):
        """One request should go through with a 200, not 429."""
        client = TestClient(app)
        res = client.get("/api/simulations", headers=AUTH_HEADER)
        assert res.status_code == 200

    def test_multiple_requests_under_auth_limit(self, mock_firebase):
        """Up to AUTH_LIMIT (60) requests in a window should all pass."""
        client = TestClient(app)
        for _ in range(10):
            res = client.get("/api/simulations", headers=AUTH_HEADER)
            assert res.status_code == 200


# ---------------------------------------------------------------------------
# Exceeding per-IP (unauthenticated) limit
# ---------------------------------------------------------------------------

class TestExceedUnauthLimit:
    def test_unauth_requests_get_429_after_limit(self, mock_firebase):
        """After UNAUTH_LIMIT requests without auth, subsequent requests should get 429."""
        client = TestClient(app)
        # Unauthenticated requests go to a public endpoint that doesn't need auth
        # We'll hit /api/templates which is public
        for i in range(rl_module.UNAUTH_LIMIT):
            res = client.get("/api/templates")
            assert res.status_code == 200, f"Request {i+1} should pass but got {res.status_code}"

        # Next request should be rate limited
        res = client.get("/api/templates")
        assert res.status_code == 429

    def test_429_response_has_retry_after_header(self, mock_firebase):
        """The 429 response should include a Retry-After header."""
        client = TestClient(app)
        for _ in range(rl_module.UNAUTH_LIMIT):
            client.get("/api/templates")
        res = client.get("/api/templates")
        assert res.status_code == 429
        assert "retry-after" in res.headers
        retry_after = int(res.headers["retry-after"])
        assert retry_after > 0
        assert retry_after <= rl_module.DEFAULT_WINDOW + 1

    def test_429_body_has_detail_message(self, mock_firebase):
        """The 429 response body should contain an explanatory message."""
        client = TestClient(app)
        for _ in range(rl_module.UNAUTH_LIMIT):
            client.get("/api/templates")
        res = client.get("/api/templates")
        assert res.status_code == 429
        body = res.json()
        assert "detail" in body
        assert "too many" in body["detail"].lower() or "rate limit" in body["detail"].lower()


# ---------------------------------------------------------------------------
# Exceeding per-user (authenticated) limit
# ---------------------------------------------------------------------------

class TestExceedAuthLimit:
    def test_auth_requests_get_429_after_limit(self, mock_firebase):
        """After AUTH_LIMIT requests with auth, subsequent requests should get 429."""
        client = TestClient(app)
        for i in range(rl_module.AUTH_LIMIT):
            res = client.get("/api/simulations", headers=AUTH_HEADER)
            assert res.status_code == 200, f"Request {i+1} should pass"

        res = client.get("/api/simulations", headers=AUTH_HEADER)
        assert res.status_code == 429


# ---------------------------------------------------------------------------
# Health/docs endpoints are excluded
# ---------------------------------------------------------------------------

class TestExcludedEndpoints:
    def test_health_not_rate_limited(self, mock_firebase):
        """The /health endpoint should never be rate limited."""
        client = TestClient(app)
        # Exhaust the unauthenticated limit on a normal endpoint
        for _ in range(rl_module.UNAUTH_LIMIT + 5):
            client.get("/api/templates")

        # /health should still work
        res = client.get("/health")
        assert res.status_code == 200

    def test_root_not_rate_limited(self, mock_firebase):
        """The / root endpoint should never be rate limited."""
        client = TestClient(app)
        for _ in range(rl_module.UNAUTH_LIMIT + 5):
            client.get("/api/templates")

        res = client.get("/")
        assert res.status_code == 200

    def test_docs_not_rate_limited(self, mock_firebase):
        """The /docs endpoint should never be rate limited."""
        client = TestClient(app)
        for _ in range(rl_module.UNAUTH_LIMIT + 5):
            client.get("/api/templates")

        res = client.get("/docs")
        # /docs redirects or returns 200; either way not 429
        assert res.status_code != 429


# ---------------------------------------------------------------------------
# Cleanup of expired entries
# ---------------------------------------------------------------------------

class TestBucketCleanup:
    def test_cleanup_removes_old_timestamps(self):
        """Timestamps older than the window should be purged during cleanup."""
        now = time.monotonic()
        key = ("ip:127.0.0.1", "unauth")
        # Inject old timestamps directly
        rl_module._buckets[key] = [now - rl_module.DEFAULT_WINDOW - 10, now - rl_module.DEFAULT_WINDOW - 5]
        # Force cleanup by setting last_cleanup far in the past
        rl_module._last_cleanup = 0.0

        rl_module._cleanup_expired()

        # Old timestamps should be gone
        assert len(rl_module._buckets.get(key, [])) == 0

    def test_cleanup_preserves_recent_timestamps(self):
        """Timestamps within the window should survive cleanup."""
        now = time.monotonic()
        key = ("ip:127.0.0.1", "unauth")
        rl_module._buckets[key] = [now - 5, now - 1]  # recent
        rl_module._last_cleanup = 0.0

        rl_module._cleanup_expired()

        assert len(rl_module._buckets[key]) == 2


# ---------------------------------------------------------------------------
# _is_expensive_path helper
# ---------------------------------------------------------------------------

class TestIsExpensivePath:
    @pytest.mark.parametrize("path", [
        "/api/simulations/abc123/run",
        "/api/simulations/abc123/run/stream",
        "/api/simulations/abc123/sweep",
        "/api/context/analyze",
        "/api/reports/generate",
        "/api/reports/generate-sync",
        "/api/reports/chat",
        "/api/projects/p1/build-graph",
        "/api/projects/p1/generate-profiles",
        "/api/projects/p1/run-simulation",
        "/api/projects/p1/generate-report",
        "/api/projects/p1/chat",
    ])
    def test_expensive_paths_detected(self, path):
        """Known expensive operation paths should be detected."""
        assert rl_module._is_expensive_path(path) is True

    @pytest.mark.parametrize("path", [
        "/api/simulations",
        "/api/simulations/abc123",
        "/api/templates",
        "/health",
        "/api/users/me",
    ])
    def test_normal_paths_not_expensive(self, path):
        """Regular CRUD paths should not be flagged as expensive."""
        assert rl_module._is_expensive_path(path) is False


# ---------------------------------------------------------------------------
# Verified-token identity (anti-spoofing)
# ---------------------------------------------------------------------------

class TestVerifiedIdentity:
    def test_authenticated_bucket_keyed_by_uid(self, mock_firebase):
        """The rate-limit key must be the VERIFIED uid, not the raw token."""
        client = TestClient(app)
        res = client.get("/api/simulations", headers=AUTH_HEADER)
        assert res.status_code == 200
        keys = [k for k in rl_module._buckets if k[1] == "auth"]
        assert keys == [("user:test-user-123", "auth")]

    def test_rotating_fake_tokens_share_the_ip_bucket(self, mock_firebase):
        """Spoofed bearer tokens cannot escape the per-IP unauthenticated limit."""
        client = TestClient(app)
        for i in range(rl_module.UNAUTH_LIMIT):
            res = client.get(
                "/api/templates",
                headers={"Authorization": f"Bearer fake-token-{i}"},
            )
            assert res.status_code == 200, f"Request {i+1} should pass"

        # Even with yet another fresh token, the shared per-IP bucket is full
        res = client.get(
            "/api/templates",
            headers={"Authorization": "Bearer fake-token-final"},
        )
        assert res.status_code == 429

    def test_verification_result_is_cached(self, mock_firebase):
        """Repeat requests with the same token must not re-verify every time."""
        from unittest.mock import patch as mock_patch
        from unittest.mock import AsyncMock

        client = TestClient(app)
        verify = AsyncMock(return_value={"uid": "test-user-123"})
        with mock_patch("app.middleware.rate_limit.verify_id_token", verify):
            for _ in range(5):
                client.get("/api/simulations", headers=AUTH_HEADER)
        assert verify.await_count == 1

    def test_x_forwarded_for_first_entry_not_trusted(self, mock_firebase):
        """Clients cannot reset their bucket by spoofing the XFF first entry."""
        client = TestClient(app)
        for i in range(rl_module.UNAUTH_LIMIT):
            res = client.get(
                "/api/templates",
                headers={"x-forwarded-for": f"10.0.0.{i}, 198.51.100.7"},
            )
            assert res.status_code == 200, f"Request {i+1} should pass"

        # Rotating the client-controlled first hop doesn't help: the
        # proxy-appended last hop is what gets keyed.
        res = client.get(
            "/api/templates",
            headers={"x-forwarded-for": "10.99.99.99, 198.51.100.7"},
        )
        assert res.status_code == 429


# ---------------------------------------------------------------------------
# Expensive-tier double-counting regression
# ---------------------------------------------------------------------------

class TestExpensiveNotDoubleCounted:
    """require_expensive_rate_limit must not consume a second slot for paths
    the middleware already classifies as expensive (would halve the limit)."""

    @pytest.mark.asyncio
    async def test_dependency_is_noop_on_expensive_path(self, mock_firebase):
        from unittest.mock import MagicMock
        from app.middleware.rate_limit import require_expensive_rate_limit

        rl_module._buckets.clear()
        req = MagicMock()
        req.url.path = "/api/simulations/abc123/run"
        # Expensive path: the middleware owns enforcement, so the dependency
        # must add nothing to the expensive bucket.
        await require_expensive_rate_limit(req)
        expensive_keys = [k for k in rl_module._buckets if k[1] == "expensive"]
        assert expensive_keys == []

    @pytest.mark.asyncio
    async def test_dependency_still_enforces_on_non_suffix_path(self, mock_firebase):
        from unittest.mock import MagicMock
        from app.middleware.rate_limit import require_expensive_rate_limit

        rl_module._buckets.clear()
        req = MagicMock()
        req.url.path = "/api/some/future/endpoint"  # not in _EXPENSIVE_SUFFIXES
        req.headers = {}
        req.client = MagicMock()
        req.client.host = "203.0.113.5"
        await require_expensive_rate_limit(req)
        expensive_keys = [k for k in rl_module._buckets if k[1] == "expensive"]
        assert len(expensive_keys) == 1
