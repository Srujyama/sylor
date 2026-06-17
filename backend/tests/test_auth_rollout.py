"""
Auth rollout tests for the projects, graphs, reports, context, and upload
routers: 401 for unauthenticated access, 403 for cross-user access, and
the reports/generate contract (returns report_id immediately).
"""
import io
import pytest
from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient

from app.main import app
from app.services.simulation_orchestrator import orchestrator, Task
from app.services.knowledge_graph import graph_builder, KnowledgeGraph
from app.services.report_agent import ReportAgent, Report


AUTH_HEADER = {"Authorization": "Bearer valid-token"}     # uid test-user-123
USER2_HEADER = {"Authorization": "Bearer user2-token"}    # uid user-2


@pytest.fixture(autouse=True)
def _clear_in_memory_stores():
    """Isolate module-level in-memory stores between tests."""
    orchestrator._projects.clear()
    orchestrator._tasks.clear()
    graph_builder._graphs.clear()
    ReportAgent._reports.clear()
    ReportAgent._progress.clear()
    yield
    orchestrator._projects.clear()
    orchestrator._tasks.clear()
    graph_builder._graphs.clear()
    ReportAgent._reports.clear()
    ReportAgent._progress.clear()


# ---------------------------------------------------------------------------
# 401: unauthenticated access is rejected on every newly-authed router
# ---------------------------------------------------------------------------

class TestUnauthenticatedReturns401:
    @pytest.mark.parametrize("method,path,kwargs", [
        ("post",   "/api/projects", {"json": {"name": "P1"}}),
        ("get",    "/api/projects", {}),
        ("get",    "/api/projects/proj-x", {}),
        ("delete", "/api/projects/proj-x", {}),
        ("post",   "/api/projects/proj-x/build-graph", {}),
        ("post",   "/api/projects/proj-x/generate-profiles", {"json": {}}),
        ("get",    "/api/projects/proj-x/profiles", {}),
        ("post",   "/api/projects/proj-x/generate-report", {}),
        ("post",   "/api/projects/proj-x/chat", {"json": {"message": "hi"}}),
        ("get",    "/api/projects/tasks/task-x", {}),
        ("get",    "/api/graphs", {}),
        ("get",    "/api/graphs/g1", {}),
        ("get",    "/api/graphs/g1/nodes", {}),
        ("get",    "/api/graphs/g1/edges", {}),
        ("post",   "/api/graphs/g1/search", {"json": {"query": "q"}}),
        ("delete", "/api/graphs/g1", {}),
        ("get",    "/api/reports", {}),
        ("get",    "/api/reports/r1", {}),
        ("get",    "/api/reports/r1/progress", {}),
        ("get",    "/api/reports/r1/sections", {}),
        ("get",    "/api/reports/r1/download", {}),
        ("get",    "/api/reports/by-simulation/s1", {}),
        ("delete", "/api/reports/r1", {}),
        ("post",   "/api/reports/generate",
         {"json": {"simulation_id": "s1", "simulation_data": {}}}),
        ("post",   "/api/reports/generate-sync",
         {"json": {"simulation_id": "s1", "simulation_data": {}}}),
        ("post",   "/api/reports/chat",
         {"json": {"report_id": "r1", "message": "hi"}}),
        ("post",   "/api/context/analyze",
         {"json": {"category": "startup", "context": {"company": "X"}}}),
        ("post",   "/api/context/analyze-prompt", {"json": {"prompt": "simulate"}}),
        ("post",   "/api/upload/parse",
         {"files": {"file": ("data.csv", b"a,b\n1,2\n", "text/csv")}}),
    ])
    def test_endpoint_requires_auth(self, mock_firebase, method, path, kwargs):
        client = TestClient(app)
        res = getattr(client, method)(path, **kwargs)
        assert res.status_code == 401, f"{method.upper()} {path} returned {res.status_code}"

    def test_invalid_token_returns_401(self, mock_firebase):
        client = TestClient(app)
        res = client.get("/api/projects", headers={"Authorization": "Bearer bogus"})
        assert res.status_code == 401

    def test_templates_stays_public(self, mock_firebase):
        client = TestClient(app)
        assert client.get("/api/templates").status_code == 200


# ---------------------------------------------------------------------------
# Projects: ownership scoping
# ---------------------------------------------------------------------------

class TestProjectOwnership:
    def _create(self, client, headers=AUTH_HEADER):
        res = client.post("/api/projects", json={"name": "Mine"}, headers=headers)
        assert res.status_code == 201
        return res.json()

    def test_create_sets_owner(self, mock_firebase):
        client = TestClient(app)
        project = self._create(client)
        assert project["user_id"] == "test-user-123"

    def test_owner_can_read(self, mock_firebase):
        client = TestClient(app)
        project = self._create(client)
        res = client.get(f"/api/projects/{project['project_id']}", headers=AUTH_HEADER)
        assert res.status_code == 200

    def test_cross_user_read_returns_403(self, mock_firebase):
        client = TestClient(app)
        project = self._create(client)
        res = client.get(f"/api/projects/{project['project_id']}", headers=USER2_HEADER)
        assert res.status_code == 403

    def test_cross_user_delete_returns_403(self, mock_firebase):
        client = TestClient(app)
        project = self._create(client)
        res = client.delete(f"/api/projects/{project['project_id']}", headers=USER2_HEADER)
        assert res.status_code == 403
        # Still exists for the owner
        res = client.get(f"/api/projects/{project['project_id']}", headers=AUTH_HEADER)
        assert res.status_code == 200

    def test_cross_user_profiles_returns_403(self, mock_firebase):
        client = TestClient(app)
        project = self._create(client)
        res = client.get(f"/api/projects/{project['project_id']}/profiles", headers=USER2_HEADER)
        assert res.status_code == 403

    def test_list_is_scoped_to_owner(self, mock_firebase):
        client = TestClient(app)
        self._create(client)
        mine = client.get("/api/projects", headers=AUTH_HEADER).json()
        theirs = client.get("/api/projects", headers=USER2_HEADER).json()
        assert len(mine) == 1
        assert theirs == []

    def test_missing_project_returns_404(self, mock_firebase):
        client = TestClient(app)
        res = client.get("/api/projects/nope", headers=AUTH_HEADER)
        assert res.status_code == 404

    def test_cross_user_task_returns_403(self, mock_firebase):
        client = TestClient(app)
        orchestrator._tasks["task-owned"] = Task(
            task_id="task-owned", task_type="graph_build", user_id="test-user-123",
        )
        res = client.get("/api/projects/tasks/task-owned", headers=USER2_HEADER)
        assert res.status_code == 403
        res = client.get("/api/projects/tasks/task-owned", headers=AUTH_HEADER)
        assert res.status_code == 200
        assert res.json()["task_id"] == "task-owned"


# ---------------------------------------------------------------------------
# Graphs: ownership scoping
# ---------------------------------------------------------------------------

class TestGraphOwnership:
    def _seed_graph(self, user_id="test-user-123"):
        graph = KnowledgeGraph(graph_id="g-owned", name="G", user_id=user_id)
        graph_builder._graphs["g-owned"] = graph
        return graph

    def test_owner_can_read(self, mock_firebase):
        client = TestClient(app)
        self._seed_graph()
        res = client.get("/api/graphs/g-owned", headers=AUTH_HEADER)
        assert res.status_code == 200
        assert res.json()["graph_id"] == "g-owned"

    def test_cross_user_read_returns_403(self, mock_firebase):
        client = TestClient(app)
        self._seed_graph()
        assert client.get("/api/graphs/g-owned", headers=USER2_HEADER).status_code == 403
        assert client.get("/api/graphs/g-owned/nodes", headers=USER2_HEADER).status_code == 403
        assert client.get("/api/graphs/g-owned/edges", headers=USER2_HEADER).status_code == 403
        assert client.delete("/api/graphs/g-owned", headers=USER2_HEADER).status_code == 403

    def test_list_is_scoped_to_owner(self, mock_firebase):
        client = TestClient(app)
        self._seed_graph()
        mine = client.get("/api/graphs", headers=AUTH_HEADER).json()
        theirs = client.get("/api/graphs", headers=USER2_HEADER).json()
        assert [g["graph_id"] for g in mine] == ["g-owned"]
        assert theirs == []

    def test_missing_graph_returns_404(self, mock_firebase):
        client = TestClient(app)
        res = client.get("/api/graphs/missing", headers=AUTH_HEADER)
        assert res.status_code == 404


# ---------------------------------------------------------------------------
# Reports: ownership scoping + generate contract
# ---------------------------------------------------------------------------

class TestReportOwnership:
    def _seed_report(self, user_id="test-user-123"):
        report = Report(report_id="r-owned", simulation_id="s1", user_id=user_id)
        ReportAgent._reports["r-owned"] = report
        return report

    def test_owner_can_read(self, mock_firebase):
        client = TestClient(app)
        self._seed_report()
        res = client.get("/api/reports/r-owned", headers=AUTH_HEADER)
        assert res.status_code == 200
        assert res.json()["report_id"] == "r-owned"

    def test_cross_user_read_returns_403(self, mock_firebase):
        client = TestClient(app)
        self._seed_report()
        assert client.get("/api/reports/r-owned", headers=USER2_HEADER).status_code == 403
        assert client.get("/api/reports/r-owned/sections", headers=USER2_HEADER).status_code == 403
        assert client.delete("/api/reports/r-owned", headers=USER2_HEADER).status_code == 403

    def test_cross_user_by_simulation_returns_403(self, mock_firebase):
        client = TestClient(app)
        self._seed_report()
        res = client.get("/api/reports/by-simulation/s1", headers=USER2_HEADER)
        assert res.status_code == 403

    def test_list_is_scoped_to_owner(self, mock_firebase):
        client = TestClient(app)
        self._seed_report()
        mine = client.get("/api/reports", headers=AUTH_HEADER).json()
        theirs = client.get("/api/reports", headers=USER2_HEADER).json()
        assert [r["report_id"] for r in mine] == ["r-owned"]
        assert theirs == []

    def test_missing_report_returns_404(self, mock_firebase):
        client = TestClient(app)
        res = client.get("/api/reports/missing", headers=AUTH_HEADER)
        assert res.status_code == 404


class TestReportGenerate:
    def test_generate_returns_report_id(self, mock_firebase):
        client = TestClient(app)
        with patch(
            "app.routers.reports.ReportAgent.generate_report",
            new_callable=AsyncMock,
        ) as mock_generate:
            res = client.post("/api/reports/generate", json={
                "simulation_id": "s1",
                "simulation_data": {"success_probability": 70},
                "category": "startup",
            }, headers=AUTH_HEADER)

        assert res.status_code == 200
        body = res.json()
        assert body["status"] == "generating"
        assert body["report_id"].startswith("report_")
        # Self-referencing URLs must point at real paths
        assert body["progress_url"] == f"/api/reports/{body['report_id']}/progress"
        assert body["report_url"] == f"/api/reports/{body['report_id']}"
        # The background task receives the same report_id and the owner uid
        mock_generate.assert_awaited_once()
        kwargs = mock_generate.await_args.kwargs
        assert kwargs["report_id"] == body["report_id"]
        assert kwargs["user_id"] == "test-user-123"


# ---------------------------------------------------------------------------
# Upload: authenticated requests still work
# ---------------------------------------------------------------------------

class TestUploadAuthenticated:
    def test_parse_csv_with_auth(self, mock_firebase):
        client = TestClient(app)
        csv_bytes = b"name,revenue\nacme,100\nbeta,250\n"
        res = client.post(
            "/api/upload/parse",
            files={"file": ("data.csv", csv_bytes, "text/csv")},
            headers=AUTH_HEADER,
        )
        assert res.status_code == 200
        body = res.json()
        assert body["row_count"] == 2
        assert [c["name"] for c in body["columns"]] == ["name", "revenue"]
