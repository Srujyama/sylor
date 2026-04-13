"""Integration tests for API endpoints using FastAPI TestClient."""
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, AsyncMock

from app.main import app


AUTH_HEADER = {"Authorization": "Bearer valid-token"}
USER2_HEADER = {"Authorization": "Bearer user2-token"}


class TestAuthMiddleware:
    def test_missing_auth_returns_401(self, mock_firebase):
        client = TestClient(app)
        res = client.get("/api/simulations")
        assert res.status_code == 401

    def test_invalid_token_returns_401(self, mock_firebase):
        client = TestClient(app)
        res = client.get("/api/simulations", headers={"Authorization": "Bearer bad-token"})
        assert res.status_code == 401

    def test_no_bearer_prefix_returns_401(self, mock_firebase):
        client = TestClient(app)
        res = client.get("/api/simulations", headers={"Authorization": "valid-token"})
        assert res.status_code == 401

    def test_public_endpoints_dont_require_auth(self, mock_firebase):
        client = TestClient(app)
        assert client.get("/").status_code == 200
        assert client.get("/health").status_code == 200
        assert client.get("/api/templates").status_code == 200


class TestSimulationCRUD:
    def _create_sim(self, client):
        return client.post("/api/simulations", json={
            "config": {
                "name": "Test Startup",
                "category": "startup",
                "variables": [
                    {"name": "budget", "label": "Budget", "value": 50000, "type": "currency"},
                    {"name": "price_per_unit", "label": "Price", "value": 99, "type": "currency"},
                    {"name": "market_size", "label": "Market", "value": 1000000},
                ],
                "agents": [
                    {"type": "customer", "name": "Users", "count": 100, "sensitivity": 0.7},
                ],
                "num_runs": 20,
                "time_horizon": 6,
            },
            "user_id": "test-user-123",
        }, headers=AUTH_HEADER)

    def test_create_simulation(self, mock_firebase):
        client = TestClient(app)
        res = self._create_sim(client)
        assert res.status_code == 201
        data = res.json()
        assert data["name"] == "Test Startup"
        assert data["status"] == "draft"
        assert data["user_id"] == "test-user-123"

    def test_list_simulations(self, mock_firebase):
        client = TestClient(app)
        self._create_sim(client)
        res = client.get("/api/simulations", headers=AUTH_HEADER)
        assert res.status_code == 200
        assert isinstance(res.json(), list)

    def test_get_simulation(self, mock_firebase):
        client = TestClient(app)
        create_res = self._create_sim(client)
        sim_id = create_res.json()["id"]
        # Store the sim in mock so get_document finds it
        mock_firebase[f"simulations/{sim_id}"] = create_res.json()
        mock_firebase[f"simulations/{sim_id}"].pop("id", None)

        res = client.get(f"/api/simulations/{sim_id}", headers=AUTH_HEADER)
        assert res.status_code == 200
        assert res.json()["name"] == "Test Startup"

    def test_get_nonexistent_returns_404(self, mock_firebase):
        client = TestClient(app)
        res = client.get("/api/simulations/nonexistent", headers=AUTH_HEADER)
        assert res.status_code == 404

    def test_delete_simulation(self, mock_firebase):
        client = TestClient(app)
        create_res = self._create_sim(client)
        sim_id = create_res.json()["id"]
        mock_firebase[f"simulations/{sim_id}"] = create_res.json()
        mock_firebase[f"simulations/{sim_id}"].pop("id", None)

        res = client.delete(f"/api/simulations/{sim_id}", headers=AUTH_HEADER)
        assert res.status_code == 204

    def test_duplicate_simulation(self, mock_firebase):
        client = TestClient(app)
        create_res = self._create_sim(client)
        sim_id = create_res.json()["id"]
        mock_firebase[f"simulations/{sim_id}"] = create_res.json()
        mock_firebase[f"simulations/{sim_id}"].pop("id", None)

        res = client.post(f"/api/simulations/{sim_id}/duplicate", headers=AUTH_HEADER)
        assert res.status_code == 200
        assert res.json()["name"] == "Test Startup (copy)"
        assert res.json()["status"] == "draft"

    def test_other_user_cannot_access(self, mock_firebase):
        client = TestClient(app)
        create_res = self._create_sim(client)
        sim_id = create_res.json()["id"]
        mock_firebase[f"simulations/{sim_id}"] = create_res.json()
        mock_firebase[f"simulations/{sim_id}"].pop("id", None)

        res = client.get(f"/api/simulations/{sim_id}", headers=USER2_HEADER)
        assert res.status_code == 403


class TestSimulationImport:
    def test_import_valid_config(self, mock_firebase):
        client = TestClient(app)
        res = client.post("/api/simulations/import", json={
            "config": {
                "name": "Imported Sim",
                "category": "pricing",
                "variables": [{"name": "price", "label": "Price", "value": 49}],
                "agents": [{"type": "customer", "name": "Buyers", "count": 50, "sensitivity": 0.5}],
            },
        }, headers=AUTH_HEADER)
        assert res.status_code == 201
        assert res.json()["name"] == "Imported Sim"

    def test_import_invalid_config(self, mock_firebase):
        client = TestClient(app)
        res = client.post("/api/simulations/import", json={
            "config": {"bad": "data"},
        }, headers=AUTH_HEADER)
        assert res.status_code == 422


class TestSimulationCompare:
    def test_compare_requires_two_ids(self, mock_firebase):
        client = TestClient(app)
        res = client.post("/api/simulations/compare", json={
            "simulation_ids": ["only-one"],
        }, headers=AUTH_HEADER)
        assert res.status_code == 422  # Validation error: min_length=2

    def test_compare_missing_sim_returns_404(self, mock_firebase):
        client = TestClient(app)
        res = client.post("/api/simulations/compare", json={
            "simulation_ids": ["nonexistent-1", "nonexistent-2"],
        }, headers=AUTH_HEADER)
        assert res.status_code == 404


class TestUserProfile:
    def test_get_profile_auto_creates(self, mock_firebase):
        client = TestClient(app)
        res = client.get("/api/users/me", headers=AUTH_HEADER)
        assert res.status_code == 200
        data = res.json()
        assert data["uid"] == "test-user-123"
        assert data["plan"] == "free"

    def test_update_profile(self, mock_firebase):
        client = TestClient(app)
        # First create profile
        mock_firebase["profiles/test-user-123"] = {
            "uid": "test-user-123",
            "email": "test@example.com",
            "fullName": "Test",
            "plan": "free",
        }
        res = client.patch("/api/users/me", json={
            "fullName": "Updated Name",
            "preferences": {"defaultRuns": 500, "darkCharts": True},
        }, headers=AUTH_HEADER)
        assert res.status_code == 200
        assert res.json()["fullName"] == "Updated Name"

    def test_update_empty_fields_returns_400(self, mock_firebase):
        client = TestClient(app)
        mock_firebase["profiles/test-user-123"] = {"uid": "test-user-123", "fullName": "Test"}
        res = client.patch("/api/users/me", json={}, headers=AUTH_HEADER)
        assert res.status_code == 400

    def test_get_usage(self, mock_firebase):
        client = TestClient(app)
        res = client.get("/api/users/me/usage", headers=AUTH_HEADER)
        assert res.status_code == 200
        data = res.json()
        assert "total_simulations" in data
        assert "avg_success_rate" in data

    def test_delete_account(self, mock_firebase):
        client = TestClient(app)
        mock_firebase["profiles/test-user-123"] = {"uid": "test-user-123"}
        res = client.delete("/api/users/me", headers=AUTH_HEADER)
        assert res.status_code == 204


class TestExport:
    def test_export_no_data_returns_404(self, mock_firebase):
        client = TestClient(app)
        res = client.get("/api/export/simulations?format=json", headers=AUTH_HEADER)
        assert res.status_code == 404

    def test_export_json(self, mock_firebase):
        client = TestClient(app)
        mock_firebase["simulations/sim-1"] = {
            "user_id": "test-user-123",
            "name": "Export Test",
            "category": "startup",
            "status": "completed",
            "config": {},
            "results": {"success_probability": 65, "timeline_aggregated": []},
            "run_count": 1,
            "created_at": "2025-01-01",
            "updated_at": "2025-01-01",
        }
        res = client.get("/api/export/simulations?format=json", headers=AUTH_HEADER)
        assert res.status_code == 200
        assert "application/json" in res.headers["content-type"]

    def test_export_csv(self, mock_firebase):
        client = TestClient(app)
        mock_firebase["simulations/sim-1"] = {
            "user_id": "test-user-123",
            "name": "CSV Test",
            "category": "startup",
            "status": "completed",
            "config": {},
            "results": {
                "success_probability": 65,
                "avg_revenue": 100000,
                "avg_market_share": 5.2,
                "confidence_interval": [55, 75],
                "timeline_aggregated": [
                    {"month": 1, "avg_revenue": 5000, "p10_revenue": 1000, "p90_revenue": 10000, "avg_customers": 50, "avg_market_share": 1.0},
                ],
            },
            "run_count": 1,
            "created_at": "2025-01-01",
            "updated_at": "2025-01-01",
        }
        res = client.get("/api/export/simulations?format=csv", headers=AUTH_HEADER)
        assert res.status_code == 200
        assert "text/csv" in res.headers["content-type"]

    def test_export_unauthorized(self, mock_firebase):
        client = TestClient(app)
        res = client.get("/api/export/simulations", headers={"Authorization": "Bearer bad-token"})
        assert res.status_code == 401


class TestHealthAndRoot:
    def test_root(self, mock_firebase):
        client = TestClient(app)
        res = client.get("/")
        assert res.status_code == 200
        assert res.json()["service"] == "Sylor API"

    def test_health(self, mock_firebase):
        client = TestClient(app)
        res = client.get("/health")
        assert res.status_code == 200
        assert res.json()["status"] == "ok"
