"""
Wave E endpoint tests: decision memo (contract A), scenario tree / branching
(contract B), and the context-router unification onto the shared llm_client.

Firebase is mocked via the shared ``mock_firebase`` fixture; LLM calls are
mocked per-test (AsyncMock). Engine-backed branch runs use tiny num_runs.
"""
from datetime import datetime
from unittest.mock import patch, AsyncMock

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.report_agent import ReportAgent
from app.services.llm_client import LLMResponse

AUTH_HEADER = {"Authorization": "Bearer valid-token"}     # uid test-user-123
USER2_HEADER = {"Authorization": "Bearer user2-token"}     # uid user-2


@pytest.fixture(autouse=True)
def _clear_report_stores():
    ReportAgent._reports.clear()
    ReportAgent._progress.clear()
    yield
    ReportAgent._reports.clear()
    ReportAgent._progress.clear()


def _now_iso() -> str:
    return datetime.utcnow().isoformat()


def _sim_config(num_runs=20):
    return {
        "name": "Wave E Sim",
        "category": "startup",
        "variables": [
            {"name": "budget", "label": "Budget", "value": 50000, "type": "currency"},
            {"name": "price_per_unit", "label": "Price", "value": 99, "type": "currency"},
            {"name": "conversion_rate", "label": "Conversion", "type": "percentage",
             "value": 5, "min": 4.5, "max": 5.5},
        ],
        "agents": [
            {"type": "customer", "name": "Users", "count": 100, "sensitivity": 0.7},
        ],
        "num_runs": num_runs,
        "time_horizon": 3,
    }


def _completed_results():
    return {
        "success_probability": 64.0,
        "confidence_interval": [55.0, 73.0],
        "avg_revenue": 120000,
        "avg_market_share": 1.2,
        "avg_breakeven_month": 4.2,
        "risk_factors": [{"name": "churn", "severity": "high", "probability": 0.4,
                          "description": "Churn risk", "mitigation": "Improve onboarding"}],
        "key_insights": ["Insight A", "Insight B"],
        "timeline_aggregated": [
            {"month": 1, "avg_revenue": 1000.0},
            {"month": 2, "avg_revenue": 2000.0},
            {"month": 3, "avg_revenue": 3000.0},
        ],
        "outcome_distribution": [{"range": "$0-$1k", "probability": 40.0}],
        "competitor_reactions": [],
        "success_explanation": "Strong retention.",
        "failure_explanation": "Weak top-of-funnel.",
    }


def _seed_sim(store, sim_id="wave-e-sim", user_id="test-user-123", status="completed",
              results=None, root_id=None, parent_id=None, branch_label=None,
              name="Wave E Sim"):
    store[f"simulations/{sim_id}"] = {
        "id": sim_id,
        "user_id": user_id,
        "name": name,
        "category": "startup",
        "config": _sim_config(),
        "status": status,
        "results": results if results is not None else (_completed_results() if status == "completed" else None),
        "run_count": 1 if status == "completed" else 0,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
        "parent_id": parent_id,
        "root_id": root_id or sim_id,
        "branch_label": branch_label,
    }
    return sim_id


# Six fixed memo sections, each: 2 tool calls then a Final Answer.
def _memo_chat_responses():
    one_section = [
        LLMResponse(text='<tool_call>{"name": "get_statistics", "parameters": {}}</tool_call>',
                    model="m", input_tokens=1, output_tokens=1),
        LLMResponse(text='<tool_call>{"name": "analyze_results", "parameters": {"aspect": "success_factors"}}</tool_call>',
                    model="m", input_tokens=1, output_tokens=1),
        LLMResponse(text="Final Answer: Section body with the numbers.",
                    model="m", input_tokens=1, output_tokens=1),
    ]
    return one_section * 6  # six fixed memo sections


# ---------------------------------------------------------------------------
# A. Decision memo
# ---------------------------------------------------------------------------

class TestDecisionMemo:
    def test_memo_returns_report_id_and_builds_memo(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="sim-memo")
        client = TestClient(app)

        with patch(
            "app.services.report_agent.llm_client.chat",
            new=AsyncMock(side_effect=_memo_chat_responses()),
        ):
            res = client.post(
                "/api/reports/memo",
                json={"simulation_id": "sim-memo", "audience": "exec"},
                headers=AUTH_HEADER,
            )
            assert res.status_code == 200, res.text
            body = res.json()
            report_id = body["report_id"]
            assert body["status"] == "generating"
            assert body["progress_url"] == f"/api/reports/{report_id}/progress"
            assert body["report_url"] == f"/api/reports/{report_id}"

            # Background memo task runs in-process; poll for completion.
            res = client.get(f"/api/reports/{report_id}", headers=AUTH_HEADER)
            assert res.status_code == 200, res.text
            report = res.json()

        assert report["status"] == "completed"
        assert report["metadata"]["type"] == "memo"
        assert report["metadata"]["audience"] == "exec"
        # The six fixed memo sections in order.
        titles = [s["title"] for s in report["sections"]]
        assert titles == [
            "Recommendation", "Evidence", "Sensitivities",
            "Risks", "Dissent / Counterpoint", "Next Questions",
        ]
        assert "## Recommendation" in report["full_markdown"]

    def test_memo_default_audience_is_exec(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="sim-memo-default")
        client = TestClient(app)
        with patch(
            "app.services.report_agent.llm_client.chat",
            new=AsyncMock(side_effect=_memo_chat_responses()),
        ):
            res = client.post(
                "/api/reports/memo",
                json={"simulation_id": "sim-memo-default"},
                headers=AUTH_HEADER,
            )
            assert res.status_code == 200
            report_id = res.json()["report_id"]
            report = client.get(f"/api/reports/{report_id}", headers=AUTH_HEADER).json()
        assert report["metadata"]["audience"] == "exec"

    def test_memo_409_when_no_results(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="sim-noresults", status="draft", results=None)
        client = TestClient(app)
        res = client.post(
            "/api/reports/memo",
            json={"simulation_id": "sim-noresults"},
            headers=AUTH_HEADER,
        )
        assert res.status_code == 409

    def test_memo_404_when_missing(self, mock_firebase):
        client = TestClient(app)
        res = client.post(
            "/api/reports/memo",
            json={"simulation_id": "does-not-exist"},
            headers=AUTH_HEADER,
        )
        assert res.status_code == 404

    def test_memo_404_cross_user(self, mock_firebase):
        # Owned by user-2; test-user-123 must not see it (surfaced as 404).
        _seed_sim(mock_firebase, sim_id="sim-other", user_id="user-2")
        client = TestClient(app)
        res = client.post(
            "/api/reports/memo",
            json={"simulation_id": "sim-other"},
            headers=AUTH_HEADER,
        )
        assert res.status_code == 404

    def test_memo_progress_pollable(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="sim-progress")
        client = TestClient(app)
        with patch(
            "app.services.report_agent.llm_client.chat",
            new=AsyncMock(side_effect=_memo_chat_responses()),
        ):
            res = client.post(
                "/api/reports/memo",
                json={"simulation_id": "sim-progress"},
                headers=AUTH_HEADER,
            )
            report_id = res.json()["report_id"]
            prog = client.get(f"/api/reports/{report_id}/progress", headers=AUTH_HEADER)
        assert prog.status_code == 200
        data = prog.json()
        assert data["status"] == "completed"
        assert data["total_sections"] == 6


# ---------------------------------------------------------------------------
# B. Scenario tree / branching
# ---------------------------------------------------------------------------

class TestScenarioTree:
    def test_create_sets_root_self(self, mock_firebase):
        client = TestClient(app)
        res = client.post(
            "/api/simulations",
            json={"config": _sim_config(), "user_id": "test-user-123"},
            headers=AUTH_HEADER,
        )
        assert res.status_code == 201, res.text
        sim = res.json()
        assert sim["parent_id"] is None
        assert sim["root_id"] == sim["id"]
        assert sim["branch_label"] is None

    def test_duplicate_sets_parent_and_inherits_root(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="root-sim", root_id="root-sim")
        client = TestClient(app)
        res = client.post("/api/simulations/root-sim/duplicate", headers=AUTH_HEADER)
        assert res.status_code == 200, res.text
        dup = res.json()
        assert dup["parent_id"] == "root-sim"
        assert dup["root_id"] == "root-sim"
        assert dup["branch_label"] == "copy"

    def test_branch_creates_child_and_runs(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="branch-root", root_id="branch-root")
        client = TestClient(app)

        with patch(
            "app.routers.simulations.generate_ai_insights",
            new=AsyncMock(side_effect=Exception("skip insights")),
        ):
            res = client.post(
                "/api/simulations/branch-root/branch",
                json={"variable_overrides": {"price_per_unit": 150}, "label": "higher price",
                      "num_runs": 20},
                headers=AUTH_HEADER,
            )
        assert res.status_code == 201, res.text
        child_id = res.json()["simulation_id"]

        child = mock_firebase[f"simulations/{child_id}"]
        assert child["parent_id"] == "branch-root"
        assert child["root_id"] == "branch-root"
        assert child["branch_label"] == "higher price"
        # Overrides baked into the child config.
        var_values = {v["name"]: v["value"] for v in child["config"]["variables"]}
        assert var_values["price_per_unit"] == 150
        # Background run completed and wrote results.
        assert child["status"] == "completed"
        assert child["results"] is not None
        # Run history recorded for the branch.
        run_docs = [v for k, v in mock_firebase.items()
                    if k.startswith("simulation_runs/")]
        assert any(r["simulation_id"] == child_id for r in run_docs)

    def test_branch_results_pollable(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="branch-poll", root_id="branch-poll")
        client = TestClient(app)
        with patch(
            "app.routers.simulations.generate_ai_insights",
            new=AsyncMock(side_effect=Exception("skip insights")),
        ):
            res = client.post(
                "/api/simulations/branch-poll/branch",
                json={"variable_overrides": {"budget": 75000}, "num_runs": 20},
                headers=AUTH_HEADER,
            )
            child_id = res.json()["simulation_id"]
            poll = client.get(f"/api/simulations/{child_id}/results", headers=AUTH_HEADER)
        assert poll.status_code == 200
        assert poll.json()["status"] == "completed"

    def test_branch_invalid_override_key_422(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="branch-bad", root_id="branch-bad")
        client = TestClient(app)
        res = client.post(
            "/api/simulations/branch-bad/branch",
            json={"variable_overrides": {"nonexistent": 1.0}},
            headers=AUTH_HEADER,
        )
        assert res.status_code == 422

    def test_branch_404_missing(self, mock_firebase):
        client = TestClient(app)
        res = client.post(
            "/api/simulations/missing/branch",
            json={"variable_overrides": {"budget": 1.0}},
            headers=AUTH_HEADER,
        )
        assert res.status_code == 404

    def test_branch_403_cross_user(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="branch-owned", user_id="user-2",
                  root_id="branch-owned")
        client = TestClient(app)
        res = client.post(
            "/api/simulations/branch-owned/branch",
            json={"variable_overrides": {"budget": 1.0}},
            headers=AUTH_HEADER,
        )
        assert res.status_code == 403

    def test_tree_returns_family(self, mock_firebase):
        # Root + two children sharing root_id.
        _seed_sim(mock_firebase, sim_id="tree-root", root_id="tree-root", name="Root")
        _seed_sim(mock_firebase, sim_id="tree-child-1", root_id="tree-root",
                  parent_id="tree-root", branch_label="copy", name="Root (copy)")
        _seed_sim(mock_firebase, sim_id="tree-child-2", root_id="tree-root",
                  parent_id="tree-root", branch_label="cheaper", name="Root — cheaper",
                  status="running", results=None)
        # An unrelated sim with a different root must NOT appear.
        _seed_sim(mock_firebase, sim_id="other-root", root_id="other-root")

        client = TestClient(app)
        res = client.get("/api/simulations/tree-child-1/tree", headers=AUTH_HEADER)
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["root_id"] == "tree-root"
        ids = {n["id"] for n in body["nodes"]}
        assert ids == {"tree-root", "tree-child-1", "tree-child-2"}

        by_id = {n["id"]: n for n in body["nodes"]}
        assert by_id["tree-root"]["parent_id"] is None
        assert by_id["tree-child-1"]["parent_id"] == "tree-root"
        assert by_id["tree-child-1"]["branch_label"] == "copy"
        # Completed node exposes success_probability; running node is None.
        assert by_id["tree-root"]["success_probability"] == 64.0
        assert by_id["tree-child-2"]["success_probability"] is None
        assert by_id["tree-child-2"]["status"] == "running"

    def test_tree_owner_scoped_403(self, mock_firebase):
        _seed_sim(mock_firebase, sim_id="tree-private", user_id="user-2",
                  root_id="tree-private")
        client = TestClient(app)
        res = client.get("/api/simulations/tree-private/tree", headers=AUTH_HEADER)
        assert res.status_code == 403

    def test_tree_404_missing(self, mock_firebase):
        client = TestClient(app)
        res = client.get("/api/simulations/missing/tree", headers=AUTH_HEADER)
        assert res.status_code == 404

    def test_legacy_root_without_root_id_appears_in_own_tree(self, mock_firebase):
        """A sim created before the scenario-tree feature has no root_id field;
        the equality query can't match it, so /tree must still include it."""
        # Legacy root: seed then strip the root_id field entirely.
        _seed_sim(mock_firebase, sim_id="legacy-root", root_id="legacy-root",
                  name="Legacy")
        del mock_firebase["simulations/legacy-root"]["root_id"]
        # A child created after the feature points its root_id at the legacy root.
        _seed_sim(mock_firebase, sim_id="legacy-child", root_id="legacy-root",
                  parent_id="legacy-root", branch_label="branch", name="Legacy branch")

        client = TestClient(app)
        res = client.get("/api/simulations/legacy-root/tree", headers=AUTH_HEADER)
        assert res.status_code == 200, res.text
        ids = {n["id"] for n in res.json()["nodes"]}
        # The legacy root must not be missing from its own family.
        assert ids == {"legacy-root", "legacy-child"}
