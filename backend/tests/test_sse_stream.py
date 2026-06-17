"""
End-to-end test for the real-time SSE streaming endpoint.

Validates that progress events flow and a terminal `complete` event is emitted
with the documented shape (sim_id + success_probability), and that the existing
event shapes are preserved.
"""
import pytest
from fastapi.testclient import TestClient

from app.main import app

AUTH_HEADER = {"Authorization": "Bearer valid-token"}


def _seed_sim(store, sim_id="sse-sim", user_id="test-user-123"):
    store[f"simulations/{sim_id}"] = {
        "user_id": user_id,
        "name": "SSE Sim",
        "category": "startup",
        "config": {
            "name": "SSE Sim",
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
            "time_horizon": 3,
        },
        "status": "draft",
        "results": None,
        "run_count": 0,
        "created_at": "2026-01-01",
        "updated_at": "2026-01-01",
    }
    return sim_id


class TestSSEStream:
    def test_stream_emits_progress_and_complete(self, mock_firebase):
        sim_id = _seed_sim(mock_firebase)
        client = TestClient(app)
        res = client.post(
            f"/api/simulations/{sim_id}/run/stream",
            json={"num_runs": 20},
            headers=AUTH_HEADER,
        )
        assert res.status_code == 200
        body = res.text
        # Progress events flow during the run (the first one is sent immediately).
        assert "event: progress" in body
        # Terminal complete event with documented payload keys.
        assert "event: complete" in body
        assert "sim_id" in body
        assert "success_probability" in body
        # The simulation doc was written to completed with results.
        assert mock_firebase[f"simulations/{sim_id}"]["status"] == "completed"
        assert mock_firebase[f"simulations/{sim_id}"]["results"] is not None

    def test_stream_requires_auth(self, mock_firebase):
        sim_id = _seed_sim(mock_firebase)
        client = TestClient(app)
        res = client.post(f"/api/simulations/{sim_id}/run/stream", json={"num_runs": 20})
        assert res.status_code == 401

    def test_stream_cross_user_returns_403(self, mock_firebase):
        sim_id = _seed_sim(mock_firebase)
        client = TestClient(app)
        res = client.post(
            f"/api/simulations/{sim_id}/run/stream",
            json={"num_runs": 20},
            headers={"Authorization": "Bearer user2-token"},
        )
        assert res.status_code == 403
