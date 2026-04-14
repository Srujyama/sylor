"""
API-level tests for the sweep (sensitivity analysis) and compare endpoints.

These exercise the full HTTP path through FastAPI, with Firebase mocked
and the simulation engine running real Monte Carlo computations.
"""
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, AsyncMock

from app.main import app
from app.middleware import rate_limit as rl_module


AUTH_HEADER = {"Authorization": "Bearer valid-token"}
USER2_HEADER = {"Authorization": "Bearer user2-token"}


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """Prevent rate-limit spill-over between tests."""
    rl_module._buckets.clear()
    rl_module._last_cleanup = 0.0
    yield
    rl_module._buckets.clear()
    rl_module._last_cleanup = 0.0


def _create_sim_payload():
    """Return a minimal valid simulation creation payload."""
    return {
        "config": {
            "name": "Sweep Test Sim",
            "category": "startup",
            "variables": [
                {"name": "budget", "label": "Budget", "value": 50000, "type": "currency"},
                {"name": "price_per_unit", "label": "Price", "value": 99, "type": "currency"},
                {"name": "market_size", "label": "Market Size", "value": 1000000},
                {"name": "conversion_rate", "label": "Conversion", "type": "percentage", "value": 5},
                {"name": "churn_rate", "label": "Churn", "type": "percentage", "value": 3},
            ],
            "agents": [
                {"type": "customer", "name": "Users", "count": 100, "sensitivity": 0.7},
            ],
            "num_runs": 20,
            "time_horizon": 6,
        },
        "user_id": "test-user-123",
    }


def _insert_sim(mock_firebase, sim_data, sim_id):
    """Helper to plant a simulation into the mock Firebase store."""
    store_data = dict(sim_data)
    store_data.pop("id", None)
    mock_firebase[f"simulations/{sim_id}"] = store_data


# ---------------------------------------------------------------------------
# Sweep endpoint
# ---------------------------------------------------------------------------

class TestSweepEndpoint:
    def test_sweep_invalid_variable_returns_422(self, mock_firebase):
        """Sweeping a variable that doesn't exist in the config should return 422."""
        client = TestClient(app)
        # Create a simulation
        res = client.post("/api/simulations", json=_create_sim_payload(), headers=AUTH_HEADER)
        assert res.status_code == 201
        sim_id = res.json()["id"]
        _insert_sim(mock_firebase, res.json(), sim_id)

        # Sweep with a bogus variable name
        res = client.post(
            f"/api/simulations/{sim_id}/sweep",
            json={
                "variable_name": "nonexistent_variable",
                "min_value": 0,
                "max_value": 100,
                "steps": 3,
                "num_runs": 10,
            },
            headers=AUTH_HEADER,
        )
        assert res.status_code == 422

    def test_sweep_nonexistent_sim_returns_404(self, mock_firebase):
        """Sweeping a simulation that doesn't exist should return 404."""
        client = TestClient(app)
        res = client.post(
            "/api/simulations/nonexistent-id/sweep",
            json={
                "variable_name": "budget",
                "min_value": 0,
                "max_value": 100000,
                "steps": 3,
                "num_runs": 10,
            },
            headers=AUTH_HEADER,
        )
        assert res.status_code == 404

    def test_sweep_other_users_sim_returns_403(self, mock_firebase):
        """Sweeping another user's simulation should return 403."""
        client = TestClient(app)
        res = client.post("/api/simulations", json=_create_sim_payload(), headers=AUTH_HEADER)
        sim_id = res.json()["id"]
        _insert_sim(mock_firebase, res.json(), sim_id)

        res = client.post(
            f"/api/simulations/{sim_id}/sweep",
            json={
                "variable_name": "budget",
                "min_value": 10000,
                "max_value": 100000,
                "steps": 3,
                "num_runs": 10,
            },
            headers=USER2_HEADER,
        )
        assert res.status_code == 403

    def test_sweep_valid_returns_points(self, mock_firebase):
        """A valid sweep should return a list of SweepPoint objects with the correct length."""
        client = TestClient(app)
        res = client.post("/api/simulations", json=_create_sim_payload(), headers=AUTH_HEADER)
        assert res.status_code == 201
        sim_id = res.json()["id"]
        _insert_sim(mock_firebase, res.json(), sim_id)

        steps = 3
        res = client.post(
            f"/api/simulations/{sim_id}/sweep",
            json={
                "variable_name": "budget",
                "min_value": 10000,
                "max_value": 100000,
                "steps": steps,
                "num_runs": 10,
            },
            headers=AUTH_HEADER,
        )
        assert res.status_code == 200
        data = res.json()
        assert isinstance(data, list)
        assert len(data) == steps
        for point in data:
            assert "value" in point
            assert "success_probability" in point
            assert "avg_revenue" in point
            assert 0 <= point["success_probability"] <= 100

    def test_sweep_bounds_min_equals_max(self, mock_firebase):
        """When min_value == max_value, all sweep points should have the same value."""
        client = TestClient(app)
        res = client.post("/api/simulations", json=_create_sim_payload(), headers=AUTH_HEADER)
        sim_id = res.json()["id"]
        _insert_sim(mock_firebase, res.json(), sim_id)

        res = client.post(
            f"/api/simulations/{sim_id}/sweep",
            json={
                "variable_name": "budget",
                "min_value": 50000,
                "max_value": 50000,
                "steps": 3,
                "num_runs": 10,
            },
            headers=AUTH_HEADER,
        )
        assert res.status_code == 200
        data = res.json()
        # All points should have the same value (50000)
        values = [p["value"] for p in data]
        assert all(v == values[0] for v in values)


# ---------------------------------------------------------------------------
# Compare endpoint
# ---------------------------------------------------------------------------

class TestCompareEndpoint:
    def _make_completed_sim(self, mock_firebase, name="Sim A"):
        """Plant a completed simulation in mock Firebase and return its id."""
        import uuid
        sim_id = str(uuid.uuid4())
        mock_firebase[f"simulations/{sim_id}"] = {
            "user_id": "test-user-123",
            "name": name,
            "category": "startup",
            "status": "completed",
            "config": {},
            "results": {
                "success_probability": 65,
                "avg_revenue": 100000,
                "avg_market_share": 5.2,
                "confidence_interval": [55, 75],
                "risk_factors": [{"name": "Test Risk", "severity": "medium", "probability": 40}],
                "key_insights": ["Insight 1"],
            },
            "run_count": 1,
            "created_at": "2025-01-01",
            "updated_at": "2025-01-01",
        }
        return sim_id

    def _make_draft_sim(self, mock_firebase, name="Draft Sim"):
        """Plant a draft simulation (no results) in mock Firebase."""
        import uuid
        sim_id = str(uuid.uuid4())
        mock_firebase[f"simulations/{sim_id}"] = {
            "user_id": "test-user-123",
            "name": name,
            "category": "startup",
            "status": "draft",
            "config": {},
            "results": None,
            "run_count": 0,
            "created_at": "2025-01-01",
            "updated_at": "2025-01-01",
        }
        return sim_id

    def test_compare_two_completed_sims(self, mock_firebase):
        """Comparing two completed simulations should return proper comparison structure."""
        client = TestClient(app)
        sid_a = self._make_completed_sim(mock_firebase, "Sim A")
        sid_b = self._make_completed_sim(mock_firebase, "Sim B")

        res = client.post(
            "/api/simulations/compare",
            json={"simulation_ids": [sid_a, sid_b]},
            headers=AUTH_HEADER,
        )
        assert res.status_code == 200
        data = res.json()
        assert "comparisons" in data
        assert len(data["comparisons"]) == 2

        for comp in data["comparisons"]:
            assert comp["status"] == "completed"
            assert comp["success_probability"] == 65
            assert comp["avg_revenue"] == 100000
            assert comp["confidence_interval"] is not None

    def test_compare_three_sims(self, mock_firebase):
        """Comparing three simulations at once should work."""
        client = TestClient(app)
        sid_a = self._make_completed_sim(mock_firebase, "A")
        sid_b = self._make_completed_sim(mock_firebase, "B")
        sid_c = self._make_completed_sim(mock_firebase, "C")

        res = client.post(
            "/api/simulations/compare",
            json={"simulation_ids": [sid_a, sid_b, sid_c]},
            headers=AUTH_HEADER,
        )
        assert res.status_code == 200
        assert len(res.json()["comparisons"]) == 3

    def test_compare_with_draft_sim(self, mock_firebase):
        """Comparing a completed sim with a draft sim should return null result fields for the draft."""
        client = TestClient(app)
        sid_completed = self._make_completed_sim(mock_firebase, "Completed")
        sid_draft = self._make_draft_sim(mock_firebase, "Draft")

        res = client.post(
            "/api/simulations/compare",
            json={"simulation_ids": [sid_completed, sid_draft]},
            headers=AUTH_HEADER,
        )
        assert res.status_code == 200
        comparisons = res.json()["comparisons"]

        # The completed sim should have results
        completed = next(c for c in comparisons if c["id"] == sid_completed)
        assert completed["success_probability"] == 65

        # The draft sim should have null result fields
        draft = next(c for c in comparisons if c["id"] == sid_draft)
        assert draft["success_probability"] is None
        assert draft["avg_revenue"] is None

    def test_compare_requires_at_least_two(self, mock_firebase):
        """Passing fewer than 2 simulation IDs should be rejected with 422."""
        client = TestClient(app)
        res = client.post(
            "/api/simulations/compare",
            json={"simulation_ids": ["only-one"]},
            headers=AUTH_HEADER,
        )
        assert res.status_code == 422

    def test_compare_missing_sim_returns_404(self, mock_firebase):
        """If any simulation ID doesn't exist, compare should return 404."""
        client = TestClient(app)
        sid = self._make_completed_sim(mock_firebase, "Real")
        res = client.post(
            "/api/simulations/compare",
            json={"simulation_ids": [sid, "nonexistent-id"]},
            headers=AUTH_HEADER,
        )
        assert res.status_code == 404

    def test_compare_other_users_sim_returns_403(self, mock_firebase):
        """If a simulation belongs to another user, compare should return 403."""
        import uuid as _uuid
        client = TestClient(app)
        sid_mine = self._make_completed_sim(mock_firebase, "Mine")

        # Create a sim owned by user-2
        sid_theirs = str(_uuid.uuid4())
        mock_firebase[f"simulations/{sid_theirs}"] = {
            "user_id": "user-2",
            "name": "Theirs",
            "category": "startup",
            "status": "completed",
            "config": {},
            "results": {"success_probability": 50},
            "run_count": 1,
        }

        res = client.post(
            "/api/simulations/compare",
            json={"simulation_ids": [sid_mine, sid_theirs]},
            headers=AUTH_HEADER,
        )
        assert res.status_code == 403
