"""
Tests for project Firestore persistence and the run-simulation pipeline phase.
"""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.simulation_orchestrator import (
    orchestrator, Project, ProjectStatus,
)


AUTH_HEADER = {"Authorization": "Bearer valid-token"}     # uid test-user-123
USER2_HEADER = {"Authorization": "Bearer user2-token"}    # uid user-2


@pytest.fixture(autouse=True)
def _clear_stores():
    orchestrator._projects.clear()
    orchestrator._tasks.clear()
    yield
    orchestrator._projects.clear()
    orchestrator._tasks.clear()


# ── Pure (de)serialization roundtrip ──────────────────────────────────────────

class TestProjectFirestoreRoundtrip:
    def test_roundtrip_preserves_fields(self):
        project = Project(
            project_id="proj-1",
            name="Roundtrip",
            status=ProjectStatus.COMPLETED,
            simulation_category="finance",
            user_id="test-user-123",
            documents=[{"filename": "x.txt", "size": 10}],
            extracted_text="hello world",
            text_stats={"total_words": 2},
            graph_id="graph-9",
            ontology={"domain": "finance"},
            agent_profiles=[{"agent_type": "trader", "name": "T", "sensitivity": 0.7}],
            simulation_id="sim-42",
            simulation_config={"name": "cfg"},
            simulation_results={"success_probability": 61.0},
            report_id="report-7",
            created_at="2026-01-01T00:00:00",
            updated_at="2026-01-02T00:00:00",
            error=None,
        )
        data = project.to_firestore_dict()
        restored = Project.from_firestore_dict(data)

        assert restored.project_id == project.project_id
        assert restored.name == project.name
        assert restored.status == ProjectStatus.COMPLETED
        assert restored.simulation_category == "finance"
        assert restored.user_id == "test-user-123"
        assert restored.extracted_text == "hello world"
        assert restored.graph_id == "graph-9"
        assert restored.agent_profiles == project.agent_profiles
        assert restored.simulation_id == "sim-42"
        assert restored.simulation_results == {"success_probability": 61.0}
        assert restored.report_id == "report-7"
        assert restored.created_at == "2026-01-01T00:00:00"


# ── Orchestrator persistence (mock firestore) ────────────────────────────────

class TestOrchestratorPersistence:
    @pytest.mark.asyncio
    async def test_create_persists_to_firestore(self, mock_firebase):
        project = await orchestrator.create_project("Persisted", "startup", user_id="test-user-123")
        key = f"projects/{project.project_id}"
        assert key in mock_firebase
        assert mock_firebase[key]["user_id"] == "test-user-123"
        assert mock_firebase[key]["name"] == "Persisted"

    @pytest.mark.asyncio
    async def test_get_project_loads_on_cache_miss(self, mock_firebase):
        # Seed Firestore directly, then evict the cache.
        project = await orchestrator.create_project("CacheMiss", "startup", user_id="test-user-123")
        pid = project.project_id
        orchestrator._projects.clear()
        assert pid not in orchestrator._projects

        loaded = await orchestrator.get_project(pid)
        assert loaded is not None
        assert loaded.project_id == pid
        assert loaded.user_id == "test-user-123"
        # Now cached
        assert pid in orchestrator._projects

    @pytest.mark.asyncio
    async def test_list_projects_queries_firestore(self, mock_firebase):
        await orchestrator.create_project("Mine", "startup", user_id="test-user-123")
        await orchestrator.create_project("Theirs", "startup", user_id="user-2")
        orchestrator._projects.clear()

        mine = await orchestrator.list_projects(user_id="test-user-123")
        theirs = await orchestrator.list_projects(user_id="user-2")
        assert len(mine) == 1
        assert mine[0]["name"] == "Mine"
        assert len(theirs) == 1
        assert theirs[0]["name"] == "Theirs"

    @pytest.mark.asyncio
    async def test_delete_removes_firestore_doc(self, mock_firebase):
        project = await orchestrator.create_project("ToDelete", "startup", user_id="test-user-123")
        key = f"projects/{project.project_id}"
        assert key in mock_firebase
        await orchestrator.delete_project(project.project_id)
        assert key not in mock_firebase


# ── run-simulation endpoint contract ──────────────────────────────────────────

class TestRunSimulationContract:
    def _create_project(self, client, headers=AUTH_HEADER):
        res = client.post("/api/projects", json={"name": "Sim Project", "category": "startup"}, headers=headers)
        assert res.status_code == 201
        return res.json()

    def test_run_simulation_returns_contract_shape(self, mock_firebase):
        client = TestClient(app)
        project = self._create_project(client)
        res = client.post(
            f"/api/projects/{project['project_id']}/run-simulation",
            json={"num_runs": 10, "time_horizon": 3},
            headers=AUTH_HEADER,
        )
        assert res.status_code == 200
        body = res.json()
        assert isinstance(body["task_id"], str) and body["task_id"]
        assert isinstance(body["simulation_id"], str) and body["simulation_id"]
        assert body["status"] == "running"
        assert isinstance(body["message"], str) and body["message"]

    def test_run_simulation_creates_owner_scoped_sim_doc(self, mock_firebase):
        client = TestClient(app)
        project = self._create_project(client)
        res = client.post(
            f"/api/projects/{project['project_id']}/run-simulation",
            json={"num_runs": 10, "time_horizon": 3},
            headers=AUTH_HEADER,
        )
        sim_id = res.json()["simulation_id"]
        sim_doc = mock_firebase.get(f"simulations/{sim_id}")
        assert sim_doc is not None
        assert sim_doc["user_id"] == "test-user-123"
        # Cross-link: sim -> project
        assert sim_doc["project_id"] == project["project_id"]
        # ISO timestamps + running status present, like wizard-created sims
        assert sim_doc["status"] in ("running", "completed")
        assert "created_at" in sim_doc and "updated_at" in sim_doc

    def test_run_simulation_requires_auth(self, mock_firebase):
        client = TestClient(app)
        res = client.post("/api/projects/proj-x/run-simulation", json={"num_runs": 10})
        assert res.status_code == 401

    def test_run_simulation_cross_user_returns_403(self, mock_firebase):
        client = TestClient(app)
        project = self._create_project(client)  # owned by test-user-123
        res = client.post(
            f"/api/projects/{project['project_id']}/run-simulation",
            json={"num_runs": 10},
            headers=USER2_HEADER,
        )
        assert res.status_code == 403

    def test_run_simulation_missing_project_returns_404(self, mock_firebase):
        client = TestClient(app)
        res = client.post(
            "/api/projects/does-not-exist/run-simulation",
            json={"num_runs": 10},
            headers=AUTH_HEADER,
        )
        assert res.status_code == 404

    def test_run_simulation_validates_num_runs_bounds(self, mock_firebase):
        client = TestClient(app)
        project = self._create_project(client)
        res = client.post(
            f"/api/projects/{project['project_id']}/run-simulation",
            json={"num_runs": 5},  # below minimum of 10
            headers=AUTH_HEADER,
        )
        assert res.status_code == 422
