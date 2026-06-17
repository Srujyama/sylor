"""
Wave D functional coverage for the previously under-tested routers:
graphs, context, upload, and reports.

Earlier waves covered auth/403/404 contracts (test_auth_rollout.py) and the
simulations-side endpoints (test_wave_c_endpoints.py). These tests exercise the
*happy paths* of the remaining routers with tiny, fully-mocked inputs:

- graphs:  get/nodes/edges/entity/search over a seeded in-memory graph
- context: /analyze and /analyze-prompt with the Anthropic streaming client mocked
- upload:  /parse over in-memory CSV and Excel files (+ validation errors)
- reports: generate-sync -> get -> progress -> sections -> download with the LLM mocked

The LLM is always mocked — these tests never make real Anthropic calls.
"""
import io
import json
from contextlib import asynccontextmanager
from unittest.mock import patch, AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.knowledge_graph import (
    graph_builder, KnowledgeGraph, GraphStatus, EntityNode, EntityEdge,
)
from app.services.report_agent import ReportAgent
from app.services.llm_client import LLMResponse


AUTH_HEADER = {"Authorization": "Bearer valid-token"}     # uid test-user-123
USER2_HEADER = {"Authorization": "Bearer user2-token"}     # uid user-2


@pytest.fixture(autouse=True)
def _clear_in_memory_stores():
    """Isolate module-level in-memory stores between tests."""
    graph_builder._graphs.clear()
    ReportAgent._reports.clear()
    ReportAgent._progress.clear()
    yield
    graph_builder._graphs.clear()
    ReportAgent._reports.clear()
    ReportAgent._progress.clear()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _seed_graph(user_id="test-user-123", graph_id="g-cov"):
    """Seed a small ready graph with two nodes (Company, Person) and one edge."""
    graph = KnowledgeGraph(
        graph_id=graph_id,
        name="Coverage Graph",
        status=GraphStatus.READY,
        user_id=user_id,
    )
    acme = EntityNode(
        uuid="entity_acme",
        name="Acme",
        entity_type="Company",
        summary="A SaaS company selling widgets.",
        attributes={"industry": "SaaS"},
    )
    jane = EntityNode(
        uuid="entity_jane",
        name="Jane Doe",
        entity_type="Person",
        summary="Founder and CEO of Acme.",
        attributes={"role": "CEO"},
    )
    edge = EntityEdge(
        uuid="edge_leads",
        source_uuid="entity_jane",
        target_uuid="entity_acme",
        relation_type="LEADS",
        description="Jane leads Acme.",
    )
    graph.nodes = {acme.uuid: acme, jane.uuid: jane}
    graph.edges = {edge.uuid: edge}
    graph_builder._graphs[graph_id] = graph
    return graph


@asynccontextmanager
async def _fake_anthropic_stream(text: str):
    """Async context manager mimicking anthropic's messages.stream(...)."""
    async def _text_stream():
        # Emit the payload in two chunks to exercise the join logic.
        mid = len(text) // 2
        yield text[:mid]
        yield text[mid:]

    stream_obj = MagicMock()
    stream_obj.text_stream = _text_stream()
    yield stream_obj


def _make_anthropic_mock(payload: dict):
    """Build a mock anthropic.AsyncAnthropic class returning *payload* as JSON."""
    text = json.dumps(payload)
    client = MagicMock()
    client.messages = MagicMock()
    client.messages.stream = MagicMock(side_effect=lambda **kw: _fake_anthropic_stream(text))
    cls = MagicMock(return_value=client)
    return cls


def _valid_context_payload():
    """A minimal but ContextAnalysisResponse-shaped payload."""
    return {
        "variables": [
            {"name": "mrr", "label": "MRR", "value": 50000, "min": 25000,
             "max": 100000, "unit": "$", "reasoning": "Stated MRR is $50K"},
            {"name": "churn", "label": "Churn", "value": 5, "min": 2,
             "max": 10, "unit": "%", "reasoning": "Typical SaaS churn"},
        ],
        "agents": [
            {"type": "customer", "label": "Users", "count": 100,
             "sensitivity": 0.7, "reasoning": "Mid-market base"},
        ],
        "assumptions": ["Growth holds steady", "No new competitors"],
        "success_criteria": "Reach $1M ARR within 18 months",
        "time_horizon": 18,
        "num_runs": 2000,
    }


# ---------------------------------------------------------------------------
# 1. Graphs router — functional happy paths
# ---------------------------------------------------------------------------

class TestGraphsFunctional:
    def test_get_graph_returns_statistics(self, mock_firebase):
        _seed_graph()
        client = TestClient(app)
        res = client.get("/api/graphs/g-cov", headers=AUTH_HEADER)
        assert res.status_code == 200
        stats = res.json()
        assert stats["graph_id"] == "g-cov"
        assert stats["total_nodes"] == 2
        assert stats["total_edges"] == 1
        assert stats["entity_types"] == {"Company": 1, "Person": 1}
        assert stats["edge_types"] == {"LEADS": 1}
        assert stats["status"] == "ready"

    def test_get_all_nodes(self, mock_firebase):
        _seed_graph()
        client = TestClient(app)
        res = client.get("/api/graphs/g-cov/nodes", headers=AUTH_HEADER)
        assert res.status_code == 200
        body = res.json()
        assert body["count"] == 2
        names = {n["name"] for n in body["nodes"]}
        assert names == {"Acme", "Jane Doe"}
        # Each node carries the full to_dict() shape
        for n in body["nodes"]:
            for key in ("uuid", "name", "entity_type", "summary", "attributes"):
                assert key in n

    def test_get_nodes_filtered_by_entity_type(self, mock_firebase):
        _seed_graph()
        client = TestClient(app)
        res = client.get(
            "/api/graphs/g-cov/nodes?entity_type=Company", headers=AUTH_HEADER
        )
        assert res.status_code == 200
        body = res.json()
        assert body["count"] == 1
        assert body["nodes"][0]["name"] == "Acme"
        # case-insensitive match
        res = client.get(
            "/api/graphs/g-cov/nodes?entity_type=person", headers=AUTH_HEADER
        )
        assert res.json()["nodes"][0]["name"] == "Jane Doe"

    def test_get_edges(self, mock_firebase):
        _seed_graph()
        client = TestClient(app)
        res = client.get("/api/graphs/g-cov/edges", headers=AUTH_HEADER)
        assert res.status_code == 200
        body = res.json()
        assert body["count"] == 1
        edge = body["edges"][0]
        assert edge["source_uuid"] == "entity_jane"
        assert edge["target_uuid"] == "entity_acme"
        assert edge["relation_type"] == "LEADS"

    def test_get_entity_with_context(self, mock_firebase):
        _seed_graph()
        client = TestClient(app)
        res = client.get("/api/graphs/g-cov/entities/entity_acme", headers=AUTH_HEADER)
        assert res.status_code == 200
        entity = res.json()
        assert entity["name"] == "Acme"
        assert entity["entity_type"] == "Company"

    def test_get_unknown_entity_returns_404(self, mock_firebase):
        _seed_graph()
        client = TestClient(app)
        res = client.get("/api/graphs/g-cov/entities/nope", headers=AUTH_HEADER)
        assert res.status_code == 404

    def test_search_uses_llm_relevance(self, mock_firebase):
        _seed_graph()
        client = TestClient(app)
        # LLM ranks Jane (the person) first
        with patch(
            "app.services.knowledge_graph.llm_client.chat_json",
            new=AsyncMock(return_value={"relevant_uuids": ["entity_jane"]}),
        ):
            res = client.post(
                "/api/graphs/g-cov/search",
                json={"query": "who runs the company", "limit": 5},
                headers=AUTH_HEADER,
            )
        assert res.status_code == 200
        body = res.json()
        assert body["query"] == "who runs the company"
        assert body["count"] == 1
        assert body["results"][0]["uuid"] == "entity_jane"

    def test_search_keyword_fallback_when_llm_fails(self, mock_firebase):
        _seed_graph()
        client = TestClient(app)
        # LLM raises -> keyword fallback. "widgets" only appears in Acme's
        # summary ("...selling widgets"), so exactly one node matches.
        with patch(
            "app.services.knowledge_graph.llm_client.chat_json",
            new=AsyncMock(side_effect=Exception("llm down")),
        ):
            res = client.post(
                "/api/graphs/g-cov/search",
                json={"query": "widgets", "limit": 5},
                headers=AUTH_HEADER,
            )
        assert res.status_code == 200
        body = res.json()
        assert body["count"] == 1
        assert body["results"][0]["name"] == "Acme"

    def test_list_returns_owner_graph_dict(self, mock_firebase):
        _seed_graph()
        client = TestClient(app)
        res = client.get("/api/graphs", headers=AUTH_HEADER)
        assert res.status_code == 200
        graphs = res.json()
        assert len(graphs) == 1
        assert graphs[0]["graph_id"] == "g-cov"
        assert graphs[0]["node_count"] == 2
        assert graphs[0]["edge_count"] == 1


# ---------------------------------------------------------------------------
# 2. Context router — /analyze and /analyze-prompt with mocked Anthropic stream
# ---------------------------------------------------------------------------

class TestContextAnalyze:
    """Context router now goes through the shared llm_client singleton.

    These tests patch ``app.routers.context.llm_client.stream_collect`` (the
    streaming collector the endpoints call) instead of a raw
    ``anthropic.AsyncAnthropic`` client. The robust JSON repair lives on the
    client's ``_extract_json``, so markdown-fenced / unparseable handling is
    exercised through that real code path.
    """

    def test_analyze_returns_valid_response(self, mock_firebase):
        client = TestClient(app)
        text = json.dumps(_valid_context_payload())
        with patch("app.routers.context.llm_client.stream_collect",
                   new=AsyncMock(return_value=text)), \
             patch("app.routers.context.settings.anthropic_api_key", "test-key"):
            res = client.post(
                "/api/context/analyze",
                json={"category": "startup",
                      "context": {"company": "Acme", "mrr": "$50K"}},
                headers=AUTH_HEADER,
            )
        assert res.status_code == 200, res.text
        data = res.json()
        assert len(data["variables"]) == 2
        assert data["variables"][0]["name"] == "mrr"
        assert data["agents"][0]["type"] == "customer"
        assert data["assumptions"] == ["Growth holds steady", "No new competitors"]
        assert data["success_criteria"] == "Reach $1M ARR within 18 months"
        assert data["time_horizon"] == 18
        assert data["num_runs"] == 2000

    def test_analyze_handles_markdown_fenced_json(self, mock_firebase):
        """The client's _extract_json should strip ```json fences."""
        client = TestClient(app)
        fenced_text = "```json\n" + json.dumps(_valid_context_payload()) + "\n```"

        with patch("app.routers.context.llm_client.stream_collect",
                   new=AsyncMock(return_value=fenced_text)), \
             patch("app.routers.context.settings.anthropic_api_key", "test-key"):
            res = client.post(
                "/api/context/analyze",
                json={"category": "finance", "context": {"capital": "$1M"}},
                headers=AUTH_HEADER,
            )
        assert res.status_code == 200, res.text
        assert res.json()["num_runs"] == 2000

    def test_analyze_no_api_key_returns_500(self, mock_firebase):
        client = TestClient(app)
        with patch("app.routers.context.settings.anthropic_api_key", ""):
            res = client.post(
                "/api/context/analyze",
                json={"category": "startup", "context": {"company": "Acme"}},
                headers=AUTH_HEADER,
            )
        assert res.status_code == 500

    def test_analyze_unparseable_response_returns_502(self, mock_firebase):
        client = TestClient(app)
        with patch("app.routers.context.llm_client.stream_collect",
                   new=AsyncMock(return_value="not json at all")), \
             patch("app.routers.context.settings.anthropic_api_key", "test-key"):
            res = client.post(
                "/api/context/analyze",
                json={"category": "startup", "context": {"company": "Acme"}},
                headers=AUTH_HEADER,
            )
        assert res.status_code == 502

    def test_analyze_api_error_returns_502(self, mock_firebase):
        """A raised LLM/API exception surfaces as a 502 (Claude API error)."""
        client = TestClient(app)
        with patch("app.routers.context.llm_client.stream_collect",
                   new=AsyncMock(side_effect=RuntimeError("upstream down"))), \
             patch("app.routers.context.settings.anthropic_api_key", "test-key"):
            res = client.post(
                "/api/context/analyze",
                json={"category": "startup", "context": {"company": "Acme"}},
                headers=AUTH_HEADER,
            )
        assert res.status_code == 502

    def test_analyze_prompt_returns_category_and_name(self, mock_firebase):
        client = TestClient(app)
        payload = _valid_context_payload()
        payload.update({
            "category": "startup",
            "name": "Acme SaaS Growth",
            "description": "Simulating Acme's path to $1M ARR.",
        })
        text = json.dumps(payload)
        with patch("app.routers.context.llm_client.stream_collect",
                   new=AsyncMock(return_value=text)), \
             patch("app.routers.context.settings.anthropic_api_key", "test-key"):
            res = client.post(
                "/api/context/analyze-prompt",
                json={"prompt": "Simulate Acme growing from $50K MRR to $1M ARR"},
                headers=AUTH_HEADER,
            )
        assert res.status_code == 200, res.text
        data = res.json()
        assert data["category"] == "startup"
        assert data["name"] == "Acme SaaS Growth"
        assert data["description"].startswith("Simulating")
        assert len(data["variables"]) == 2


# ---------------------------------------------------------------------------
# 3. Upload router — /parse over in-memory files
# ---------------------------------------------------------------------------

class TestUploadParse:
    def test_parse_csv_computes_stats(self, mock_firebase):
        client = TestClient(app)
        csv_bytes = (
            b"region,revenue,units\n"
            b"east,100.5,10\n"
            b"west,200.5,20\n"
            b"north,300.0,30\n"
        )
        res = client.post(
            "/api/upload/parse",
            files={"file": ("sales.csv", csv_bytes, "text/csv")},
            headers=AUTH_HEADER,
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["file_name"] == "sales.csv"
        assert body["row_count"] == 3
        cols = {c["name"]: c for c in body["columns"]}
        assert set(cols) == {"region", "revenue", "units"}

        # region is a string column
        assert cols["region"]["type"] == "string"
        assert cols["region"]["sample"] == "east"

        # revenue is float64 with computed stats
        rev = cols["revenue"]
        assert rev["type"] == "float64"
        assert rev["min"] == 100.5
        assert rev["max"] == 300.0
        assert rev["mean"] == pytest.approx(200.3333, abs=1e-3)
        assert rev["non_null_count"] == 3
        # numeric columns now expose the raw series (for calibration); string
        # columns do not.
        assert rev["values"] == [100.5, 200.5, 300.0]
        assert cols["region"]["values"] is None

        # units is detected as int64
        assert cols["units"]["type"] == "int64"
        assert cols["units"]["min"] == 10
        assert cols["units"]["max"] == 30

    def test_parse_rejects_unsupported_extension(self, mock_firebase):
        client = TestClient(app)
        res = client.post(
            "/api/upload/parse",
            files={"file": ("notes.txt", b"hello world", "text/plain")},
            headers=AUTH_HEADER,
        )
        assert res.status_code == 400
        assert "Unsupported file type" in res.json()["detail"]

    def test_parse_empty_csv_returns_400(self, mock_firebase):
        client = TestClient(app)
        res = client.post(
            "/api/upload/parse",
            files={"file": ("empty.csv", b"", "text/csv")},
            headers=AUTH_HEADER,
        )
        assert res.status_code == 400

    def test_parse_xlsx_in_memory(self, mock_firebase):
        client = TestClient(app)
        # openpyxl is pinned in requirements.txt (so present in CI/3.12); the
        # local relocated 3.11 venv may not have it — skip rather than fail.
        openpyxl = pytest.importorskip("openpyxl")
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.append(["name", "score"])
        ws.append(["alice", 90])
        ws.append(["bob", 80])
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)

        res = client.post(
            "/api/upload/parse",
            files={"file": ("scores.xlsx", buf.read(),
                            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            headers=AUTH_HEADER,
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["row_count"] == 2
        cols = {c["name"]: c for c in body["columns"]}
        assert set(cols) == {"name", "score"}
        assert cols["score"]["type"] == "int64"
        assert cols["score"]["min"] == 80
        assert cols["score"]["max"] == 90


# ---------------------------------------------------------------------------
# 4. Reports router — generate-sync -> progress -> sections -> download
# ---------------------------------------------------------------------------

def _completed_sim_data():
    return {
        "success_probability": 64.0,
        "confidence_interval": [55.0, 73.0],
        "avg_revenue": 120000,
        "avg_market_share": 1.2,
        "risk_factors": [{"factor": "churn", "severity": "high"}],
        "key_insights": ["Insight A", "Insight B"],
        "success_explanation": "Strong retention.",
        "failure_explanation": "Weak top-of-funnel.",
        "timeline_aggregated": [
            {"month": 1, "avg_revenue": 1000.0},
            {"month": 2, "avg_revenue": 2000.0},
            {"month": 3, "avg_revenue": 3000.0},
        ],
        "outcome_distribution": [{"range": "$0-$1k", "probability": 40.0}],
        "competitor_reactions": [],
    }


class TestReportsHappyPath:
    def test_generate_sync_then_fetch_progress_sections_download(self, mock_firebase):
        client = TestClient(app)

        # Plan outline: chat_json returns a 2-section outline.
        outline = {
            "title": "Acme Startup Analysis",
            "summary": "A focused look at Acme's runway.",
            "sections": [
                {"title": "Executive Summary", "focus": "Top-line results"},
                {"title": "Risk Analysis", "focus": "Key risks"},
            ],
        }
        # Each ReACT section: the agent calls 2 tools then writes a Final Answer.
        # We stub llm.chat to immediately return a Final Answer (the router
        # accepts a final answer after MIN_TOOL_CALLS, but a bare text response
        # with no tool calls is also accepted once min tools are met; to keep it
        # simple and deterministic we drive a tool call then a final answer).
        chat_responses = [
            # section 1
            LLMResponse(text='<tool_call>{"name": "get_statistics", "parameters": {}}</tool_call>',
                        model="m", input_tokens=1, output_tokens=1),
            LLMResponse(text='<tool_call>{"name": "analyze_results", "parameters": {"aspect": "success_factors"}}</tool_call>',
                        model="m", input_tokens=1, output_tokens=1),
            LLMResponse(text="Final Answer: Acme shows a 64% success probability with strong retention.",
                        model="m", input_tokens=1, output_tokens=1),
            # section 2
            LLMResponse(text='<tool_call>{"name": "get_statistics", "parameters": {}}</tool_call>',
                        model="m", input_tokens=1, output_tokens=1),
            LLMResponse(text='<tool_call>{"name": "analyze_results", "parameters": {"aspect": "risk_breakdown"}}</tool_call>',
                        model="m", input_tokens=1, output_tokens=1),
            LLMResponse(text="Final Answer: The dominant risk is high churn.",
                        model="m", input_tokens=1, output_tokens=1),
        ]

        with patch(
            "app.services.report_agent.llm_client.chat_json",
            new=AsyncMock(return_value=outline),
        ), patch(
            "app.services.report_agent.llm_client.chat",
            new=AsyncMock(side_effect=chat_responses),
        ):
            res = client.post(
                "/api/reports/generate-sync",
                json={
                    "simulation_id": "sim-cov",
                    "simulation_data": _completed_sim_data(),
                    "category": "startup",
                },
                headers=AUTH_HEADER,
            )

        assert res.status_code == 200, res.text
        report = res.json()
        report_id = report["report_id"]
        assert report["title"] == "Acme Startup Analysis"
        assert report["status"] == "completed"
        assert report["user_id"] == "test-user-123"
        assert len(report["sections"]) == 2
        assert report["sections"][0]["title"] == "Executive Summary"
        assert "64% success probability" in report["sections"][0]["content"]
        assert report["sections"][1]["status"] == "completed"

        # Progress reflects completion
        res = client.get(f"/api/reports/{report_id}/progress", headers=AUTH_HEADER)
        assert res.status_code == 200
        progress = res.json()
        assert progress["status"] == "completed"
        assert progress["percent"] == 100.0
        assert progress["total_sections"] == 2

        # Sections endpoint returns both sections
        res = client.get(f"/api/reports/{report_id}/sections", headers=AUTH_HEADER)
        assert res.status_code == 200
        sections = res.json()["sections"]
        assert [s["title"] for s in sections] == ["Executive Summary", "Risk Analysis"]

        # Download returns the assembled markdown
        res = client.get(f"/api/reports/{report_id}/download", headers=AUTH_HEADER)
        assert res.status_code == 200
        assert res.headers["content-type"].startswith("text/markdown")
        text = res.content.decode()
        assert "# Acme Startup Analysis" in text
        assert "## Executive Summary" in text
        assert "## Risk Analysis" in text

        # by-simulation lookup resolves the same report
        res = client.get("/api/reports/by-simulation/sim-cov", headers=AUTH_HEADER)
        assert res.status_code == 200
        assert res.json()["report_id"] == report_id

    def test_generate_sync_uses_fallback_outline_when_plan_fails(self, mock_firebase):
        """If plan_outline's LLM call fails, the agent falls back to a default
        outline and still produces a completed report."""
        client = TestClient(app)

        # plan_outline chat_json raises -> fallback outline (3 sections).
        # Section generation: bare-text response accepted after MIN_TOOL_CALLS.
        section_chat = [
            LLMResponse(text='<tool_call>{"name": "get_statistics", "parameters": {}}</tool_call>',
                        model="m", input_tokens=1, output_tokens=1),
            LLMResponse(text='<tool_call>{"name": "analyze_results", "parameters": {"aspect": "risk_breakdown"}}</tool_call>',
                        model="m", input_tokens=1, output_tokens=1),
            LLMResponse(text="Final Answer: Section body.",
                        model="m", input_tokens=1, output_tokens=1),
        ] * 3  # three fallback sections

        with patch(
            "app.services.report_agent.llm_client.chat_json",
            new=AsyncMock(side_effect=Exception("plan llm down")),
        ), patch(
            "app.services.report_agent.llm_client.chat",
            new=AsyncMock(side_effect=section_chat),
        ):
            res = client.post(
                "/api/reports/generate-sync",
                json={
                    "simulation_id": "sim-fallback",
                    "simulation_data": _completed_sim_data(),
                    "category": "startup",
                },
                headers=AUTH_HEADER,
            )

        assert res.status_code == 200, res.text
        report = res.json()
        assert report["status"] == "completed"
        # fallback outline has 3 sections
        assert len(report["sections"]) == 3
        assert report["title"].startswith("Startup")

    def test_chat_answers_from_report(self, mock_firebase):
        """Chat returns a direct answer when the LLM responds without a tool call."""
        client = TestClient(app)
        from app.services.report_agent import Report
        ReportAgent._reports["r-chat"] = Report(
            report_id="r-chat", simulation_id="sim-chat",
            user_id="test-user-123",
            full_markdown="# Report\nSuccess probability is 64%.",
            status="completed",
        )

        with patch(
            "app.services.report_agent.llm_client.chat",
            new=AsyncMock(return_value=LLMResponse(
                text="The success probability is 64%.",
                model="m", input_tokens=1, output_tokens=1,
            )),
        ):
            res = client.post(
                "/api/reports/chat",
                json={"report_id": "r-chat", "message": "What's the success rate?"},
                headers=AUTH_HEADER,
            )
        assert res.status_code == 200, res.text
        assert "64%" in res.json()["response"]
