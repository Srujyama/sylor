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
        "/api/simulations/abc123/sweep",
        "/api/context/analyze",
        "/api/reports/generate",
        "/api/reports/generate-sync",
        "/api/reports/chat",
        "/api/projects/p1/build-graph",
        "/api/projects/p1/generate-profiles",
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
