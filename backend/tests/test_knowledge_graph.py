"""
Unit tests for the knowledge graph service.

Tests the ontology generator, graph builder, entity search,
and statistics -- all with mocked LLM calls (no real API traffic).
"""
import pytest
import asyncio
from unittest.mock import AsyncMock, patch, MagicMock

from app.services.knowledge_graph import (
    OntologyGenerator,
    KnowledgeGraphBuilder,
    KnowledgeGraph,
    GraphStatus,
    EntityNode,
    EntityEdge,
    Ontology,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mock_llm():
    """Return a mock LLMClient whose chat_json always fails (forces fallback)."""
    llm = MagicMock()
    llm.chat_json = AsyncMock(side_effect=Exception("LLM unavailable"))
    return llm


def _mock_llm_returning(payload):
    """Return a mock LLMClient whose chat_json returns *payload*."""
    llm = MagicMock()
    llm.chat_json = AsyncMock(return_value=payload)
    return llm


def _sample_node(name="Acme Corp", entity_type="Company", uuid_val="node-1"):
    return EntityNode(
        uuid=uuid_val,
        name=name,
        entity_type=entity_type,
        summary=f"{name} is a test entity",
        attributes={"industry": "tech"},
    )


def _sample_edge(source_uuid="node-1", target_uuid="node-2", uuid_val="edge-1"):
    return EntityEdge(
        uuid=uuid_val,
        source_uuid=source_uuid,
        target_uuid=target_uuid,
        relation_type="COMPETES_WITH",
        description="They compete",
    )


# ---------------------------------------------------------------------------
# OntologyGenerator._default_ontology
# ---------------------------------------------------------------------------

class TestDefaultOntology:
    """Verify that every supported domain returns a well-formed default ontology."""

    @pytest.mark.parametrize("domain", ["startup", "finance", "biology", "trend", "policy", "general"])
    def test_default_ontology_has_entity_and_edge_types(self, domain):
        """Each domain's default ontology should have at least one entity type and one edge type."""
        gen = OntologyGenerator(client=_mock_llm())
        ontology = gen._default_ontology(domain)
        assert isinstance(ontology, Ontology)
        assert len(ontology.entity_types) >= 2, f"Domain '{domain}' has too few entity types"
        assert len(ontology.edge_types) >= 1, f"Domain '{domain}' has too few edge types"

    def test_startup_ontology_includes_company(self):
        """The startup ontology should have a Company entity type."""
        gen = OntologyGenerator(client=_mock_llm())
        ontology = gen._default_ontology("startup")
        type_names = [et["name"] for et in ontology.entity_types]
        assert "Company" in type_names

    def test_finance_ontology_includes_asset(self):
        """The finance ontology should have an Asset entity type."""
        gen = OntologyGenerator(client=_mock_llm())
        ontology = gen._default_ontology("finance")
        type_names = [et["name"] for et in ontology.entity_types]
        assert "Asset" in type_names

    def test_unknown_domain_falls_back_to_general(self):
        """A domain not in the explicit map should return the general ontology."""
        gen = OntologyGenerator(client=_mock_llm())
        ontology = gen._default_ontology("nonexistent_domain_xyz")
        type_names = [et["name"] for et in ontology.entity_types]
        assert "Person" in type_names
        assert "Organization" in type_names


# ---------------------------------------------------------------------------
# OntologyGenerator._validate_ontology
# ---------------------------------------------------------------------------

class TestValidateOntology:
    """Edge cases in LLM-produced ontology validation."""

    def test_adds_missing_person_and_organization(self):
        """If the LLM omits Person/Organization, validation should add them."""
        gen = OntologyGenerator(client=_mock_llm())
        raw = {
            "entity_types": [
                {"name": "Widget", "description": "A widget", "attributes": []},
            ],
            "edge_types": [
                {"name": "USES", "description": "Uses relationship", "source_types": ["Widget"], "target_types": ["Widget"]},
            ],
        }
        ontology = gen._validate_ontology(raw, "general")
        type_names = {et["name"].lower() for et in ontology.entity_types}
        assert "person" in type_names
        assert "organization" in type_names

    def test_enforces_max_10_entity_types(self):
        """More than 10 entity types should be trimmed to 10."""
        gen = OntologyGenerator(client=_mock_llm())
        raw = {
            "entity_types": [{"name": f"Type{i}", "description": "x", "attributes": []} for i in range(15)],
            "edge_types": [],
        }
        ontology = gen._validate_ontology(raw, "general")
        assert len(ontology.entity_types) <= 10

    def test_enforces_max_10_edge_types(self):
        """More than 10 edge types should be trimmed to 10."""
        gen = OntologyGenerator(client=_mock_llm())
        raw = {
            "entity_types": [{"name": "Person", "description": "x"}, {"name": "Organization", "description": "x"}],
            "edge_types": [{"name": f"EDGE_{i}", "description": "x"} for i in range(15)],
        }
        ontology = gen._validate_ontology(raw, "general")
        assert len(ontology.edge_types) <= 10

    def test_truncates_long_descriptions(self):
        """Descriptions over 100 chars should be truncated."""
        gen = OntologyGenerator(client=_mock_llm())
        long_desc = "A" * 200
        raw = {
            "entity_types": [
                {"name": "Person", "description": long_desc},
                {"name": "Organization", "description": "short"},
            ],
            "edge_types": [{"name": "RELATED", "description": long_desc}],
        }
        ontology = gen._validate_ontology(raw, "general")
        for et in ontology.entity_types:
            assert len(et.get("description", "")) <= 100
        for et in ontology.edge_types:
            assert len(et.get("description", "")) <= 100

    def test_empty_result_gets_fallbacks(self):
        """Completely empty LLM output should still get Person and Organization."""
        gen = OntologyGenerator(client=_mock_llm())
        ontology = gen._validate_ontology({}, "general")
        type_names = {et["name"].lower() for et in ontology.entity_types}
        assert "person" in type_names
        assert "organization" in type_names


# ---------------------------------------------------------------------------
# OntologyGenerator.generate -- fallback when LLM fails
# ---------------------------------------------------------------------------

class TestOntologyGenerateFallback:
    @pytest.mark.asyncio
    async def test_llm_failure_falls_back_to_default(self):
        """When the LLM call throws, generate() should return the default ontology."""
        gen = OntologyGenerator(client=_mock_llm())  # always raises
        ontology = await gen.generate("Some document text", simulation_category="startup")
        assert isinstance(ontology, Ontology)
        assert ontology.domain == "startup"


# ---------------------------------------------------------------------------
# KnowledgeGraphBuilder.create_graph + in-memory storage
# ---------------------------------------------------------------------------

class TestGraphBuilderCreateGraph:
    @pytest.mark.asyncio
    async def test_create_graph_returns_graph_object(self):
        """create_graph should return a KnowledgeGraph with CREATED status."""
        builder = KnowledgeGraphBuilder(client=_mock_llm())
        with patch.object(builder, "_persist_graph", new_callable=AsyncMock):
            graph = await builder.create_graph("Test Graph", domain="startup", user_id="u1")
        assert isinstance(graph, KnowledgeGraph)
        assert graph.status == GraphStatus.CREATED
        assert graph.name == "Test Graph"
        assert graph.user_id == "u1"

    @pytest.mark.asyncio
    async def test_created_graph_stored_in_memory(self):
        """After creation, the graph should be retrievable from the builder's cache."""
        builder = KnowledgeGraphBuilder(client=_mock_llm())
        with patch.object(builder, "_persist_graph", new_callable=AsyncMock):
            graph = await builder.create_graph("Cached Graph")
        assert graph.graph_id in builder._graphs


# ---------------------------------------------------------------------------
# _find_entity case insensitivity
# ---------------------------------------------------------------------------

class TestFindEntity:
    def test_exact_match(self):
        """Finding entity by exact name should work."""
        builder = KnowledgeGraphBuilder(client=_mock_llm())
        graph = KnowledgeGraph(graph_id="g1", name="test")
        node = _sample_node(name="Acme Corp")
        graph.nodes[node.uuid] = node
        assert builder._find_entity(graph, "Acme Corp") is node

    def test_case_insensitive_match(self):
        """Entity lookup should be case insensitive."""
        builder = KnowledgeGraphBuilder(client=_mock_llm())
        graph = KnowledgeGraph(graph_id="g1", name="test")
        node = _sample_node(name="Acme Corp")
        graph.nodes[node.uuid] = node
        assert builder._find_entity(graph, "acme corp") is node
        assert builder._find_entity(graph, "ACME CORP") is node

    def test_whitespace_trimmed(self):
        """Leading/trailing whitespace in the query should be ignored."""
        builder = KnowledgeGraphBuilder(client=_mock_llm())
        graph = KnowledgeGraph(graph_id="g1", name="test")
        node = _sample_node(name="Acme Corp")
        graph.nodes[node.uuid] = node
        assert builder._find_entity(graph, "  Acme Corp  ") is node

    def test_not_found_returns_none(self):
        """Looking up a name that doesn't exist should return None."""
        builder = KnowledgeGraphBuilder(client=_mock_llm())
        graph = KnowledgeGraph(graph_id="g1", name="test")
        assert builder._find_entity(graph, "Nonexistent") is None


# ---------------------------------------------------------------------------
# _enrich_entities
# ---------------------------------------------------------------------------

class TestEnrichEntities:
    def test_enrichment_adds_related_nodes_and_edges(self):
        """After enrichment, source should have target in related_nodes and vice-versa."""
        builder = KnowledgeGraphBuilder(client=_mock_llm())
        graph = KnowledgeGraph(graph_id="g1", name="test")

        node_a = _sample_node(name="Alpha", uuid_val="n1")
        node_b = _sample_node(name="Beta", uuid_val="n2")
        graph.nodes["n1"] = node_a
        graph.nodes["n2"] = node_b

        edge = _sample_edge(source_uuid="n1", target_uuid="n2", uuid_val="e1")
        graph.edges["e1"] = edge

        builder._enrich_entities(graph)

        # Source should reference target
        assert any(rn["uuid"] == "n2" for rn in node_a.related_nodes)
        assert any(re["uuid"] == "e1" for re in node_a.related_edges)

        # Target should reference source (inverse)
        assert any(rn["uuid"] == "n1" for rn in node_b.related_nodes)
        assert any(re["uuid"] == "e1" for re in node_b.related_edges)

    def test_enrichment_with_dangling_edge(self):
        """An edge whose source or target doesn't exist should not crash enrichment."""
        builder = KnowledgeGraphBuilder(client=_mock_llm())
        graph = KnowledgeGraph(graph_id="g1", name="test")

        node_a = _sample_node(name="Alpha", uuid_val="n1")
        graph.nodes["n1"] = node_a

        # Edge references a nonexistent target
        edge = _sample_edge(source_uuid="n1", target_uuid="n_missing", uuid_val="e1")
        graph.edges["e1"] = edge

        builder._enrich_entities(graph)  # Should not raise
        # Source still gets the edge added
        assert len(node_a.related_edges) >= 1


# ---------------------------------------------------------------------------
# get_graph_statistics
# ---------------------------------------------------------------------------

class TestGetGraphStatistics:
    @pytest.mark.asyncio
    async def test_statistics_of_populated_graph(self):
        """Statistics should count nodes, edges, and types correctly."""
        builder = KnowledgeGraphBuilder(client=_mock_llm())
        graph = KnowledgeGraph(graph_id="g1", name="Stats Test", status=GraphStatus.READY)
        graph.nodes["n1"] = _sample_node(name="A", entity_type="Company", uuid_val="n1")
        graph.nodes["n2"] = _sample_node(name="B", entity_type="Company", uuid_val="n2")
        graph.nodes["n3"] = _sample_node(name="C", entity_type="Person", uuid_val="n3")
        graph.edges["e1"] = _sample_edge(source_uuid="n1", target_uuid="n2", uuid_val="e1")
        builder._graphs["g1"] = graph

        stats = await builder.get_graph_statistics("g1")
        assert stats["total_nodes"] == 3
        assert stats["total_edges"] == 1
        assert stats["entity_types"]["Company"] == 2
        assert stats["entity_types"]["Person"] == 1
        assert stats["status"] == "ready"

    @pytest.mark.asyncio
    async def test_statistics_of_missing_graph(self):
        """Requesting stats for a nonexistent graph should return empty dict."""
        builder = KnowledgeGraphBuilder(client=_mock_llm())
        builder._graphs.clear()
        with patch.object(builder, "_load_graph_from_firestore", new_callable=AsyncMock, return_value=None):
            stats = await builder.get_graph_statistics("no-such-graph")
        assert stats == {}


# ---------------------------------------------------------------------------
# search_graph -- keyword fallback when LLM fails
# ---------------------------------------------------------------------------

class TestSearchGraphKeywordFallback:
    @pytest.mark.asyncio
    async def test_keyword_fallback_finds_by_name(self):
        """When the LLM fails, search should fall back to keyword matching on name."""
        builder = KnowledgeGraphBuilder(client=_mock_llm())  # LLM always fails
        graph = KnowledgeGraph(graph_id="g1", name="Search Test", status=GraphStatus.READY)
        graph.nodes["n1"] = _sample_node(name="Machine Learning", entity_type="Concept", uuid_val="n1")
        graph.nodes["n2"] = _sample_node(name="Database", entity_type="Technology", uuid_val="n2")
        builder._graphs["g1"] = graph

        results = await builder.search_graph("g1", "machine")
        assert len(results) >= 1
        assert results[0].name == "Machine Learning"

    @pytest.mark.asyncio
    async def test_keyword_fallback_finds_by_summary(self):
        """Keyword fallback should also match against entity summaries."""
        builder = KnowledgeGraphBuilder(client=_mock_llm())
        graph = KnowledgeGraph(graph_id="g1", name="Search Test")
        node = EntityNode(
            uuid="n1", name="Widget", entity_type="Product",
            summary="A revolutionary quantum computing device",
        )
        graph.nodes["n1"] = node
        builder._graphs["g1"] = graph

        results = await builder.search_graph("g1", "quantum")
        assert len(results) >= 1
        assert results[0].uuid == "n1"

    @pytest.mark.asyncio
    async def test_search_empty_graph_returns_empty(self):
        """Searching an empty graph should return an empty list."""
        builder = KnowledgeGraphBuilder(client=_mock_llm())
        graph = KnowledgeGraph(graph_id="g1", name="Empty")
        builder._graphs["g1"] = graph

        results = await builder.search_graph("g1", "anything")
        assert results == []


# ---------------------------------------------------------------------------
# Empty graph -- all query methods return empty
# ---------------------------------------------------------------------------

class TestEmptyGraph:
    @pytest.mark.asyncio
    async def test_get_nodes_empty(self):
        """get_nodes on an empty graph should return empty list."""
        builder = KnowledgeGraphBuilder(client=_mock_llm())
        graph = KnowledgeGraph(graph_id="g1", name="Empty")
        builder._graphs["g1"] = graph
        nodes = await builder.get_nodes("g1")
        assert nodes == []

    @pytest.mark.asyncio
    async def test_get_edges_empty(self):
        """get_edges on an empty graph should return empty list."""
        builder = KnowledgeGraphBuilder(client=_mock_llm())
        graph = KnowledgeGraph(graph_id="g1", name="Empty")
        builder._graphs["g1"] = graph
        edges = await builder.get_edges("g1")
        assert edges == []

    @pytest.mark.asyncio
    async def test_get_entities_by_type_empty(self):
        """Filtering by type on an empty graph should return empty list."""
        builder = KnowledgeGraphBuilder(client=_mock_llm())
        graph = KnowledgeGraph(graph_id="g1", name="Empty")
        builder._graphs["g1"] = graph
        entities = await builder.get_entities_by_type("g1", "Company")
        assert entities == []

    @pytest.mark.asyncio
    async def test_get_entity_with_context_missing(self):
        """Requesting a specific entity UUID that doesn't exist should return None."""
        builder = KnowledgeGraphBuilder(client=_mock_llm())
        graph = KnowledgeGraph(graph_id="g1", name="Empty")
        builder._graphs["g1"] = graph
        entity = await builder.get_entity_with_context("g1", "no-such-uuid")
        assert entity is None

    @pytest.mark.asyncio
    async def test_get_nodes_nonexistent_graph(self):
        """get_nodes for a graph_id that doesn't exist should return empty list."""
        builder = KnowledgeGraphBuilder(client=_mock_llm())
        builder._graphs.clear()
        with patch.object(builder, "_load_graph_from_firestore", new_callable=AsyncMock, return_value=None):
            nodes = await builder.get_nodes("missing-graph")
        assert nodes == []


# ---------------------------------------------------------------------------
# KnowledgeGraph serialization round-trip
# ---------------------------------------------------------------------------

class TestGraphSerialization:
    def test_firestore_round_trip(self):
        """to_firestore_dict -> from_firestore_dict should preserve all data."""
        graph = KnowledgeGraph(
            graph_id="g1", name="Roundtrip", status=GraphStatus.READY, user_id="u1",
            ontology=Ontology(
                entity_types=[{"name": "Person", "description": "A person", "attributes": ["role"]}],
                edge_types=[{"name": "KNOWS", "description": "Knows relationship"}],
                domain="startup",
            ),
        )
        graph.nodes["n1"] = _sample_node(name="Alice", uuid_val="n1")
        graph.edges["e1"] = _sample_edge(uuid_val="e1")

        data = graph.to_firestore_dict()
        restored = KnowledgeGraph.from_firestore_dict(data)

        assert restored.graph_id == "g1"
        assert restored.name == "Roundtrip"
        assert restored.status == GraphStatus.READY
        assert restored.user_id == "u1"
        assert "n1" in restored.nodes
        assert restored.nodes["n1"].name == "Alice"
        assert "e1" in restored.edges
        assert restored.ontology is not None
        assert restored.ontology.domain == "startup"
