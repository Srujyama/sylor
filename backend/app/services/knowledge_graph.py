"""
Knowledge Graph service for Sylor.
Adapted from MiroFish's graph_builder.py + ontology_generator.py + zep_entity_reader.py.
Improved with:
- Async-first design (vs threading in MiroFish)
- Domain-aware ontology generation calibrated for Sylor's simulation categories
- Anthropic Claude for ontology generation (vs generic OpenAI-compat in MiroFish)
- Better entity relationship modeling for business/finance/biology domains
- In-memory graph option when Zep is not configured
"""
import asyncio
import json
import uuid
import re
from typing import Optional, List, Dict, Any, Callable, Awaitable
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum

from app.config import settings
from app.services.llm_client import LLMClient, llm_client
from app.services.text_processor import TextProcessor, TextChunk


# ── Data Models ──────────────────────────────────────────────────────────────

class GraphStatus(str, Enum):
    CREATED = "created"
    BUILDING = "building"
    READY = "ready"
    FAILED = "failed"


@dataclass
class EntityNode:
    """
    Represents an entity in the knowledge graph.
    Adapted from MiroFish's ZepEntityReader.EntityNode with richer metadata.
    """
    uuid: str
    name: str
    entity_type: str
    summary: str = ""
    attributes: Dict[str, Any] = field(default_factory=dict)
    related_edges: List[Dict[str, Any]] = field(default_factory=list)
    related_nodes: List[Dict[str, Any]] = field(default_factory=list)
    relevance_score: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "uuid": self.uuid,
            "name": self.name,
            "entity_type": self.entity_type,
            "summary": self.summary,
            "attributes": self.attributes,
            "related_edges": self.related_edges,
            "related_nodes": self.related_nodes,
            "relevance_score": self.relevance_score,
        }


@dataclass
class EntityEdge:
    """Represents a relationship between entities."""
    uuid: str
    source_uuid: str
    target_uuid: str
    relation_type: str
    description: str = ""
    weight: float = 1.0
    is_temporal: bool = False
    valid_from: Optional[str] = None
    valid_to: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "uuid": self.uuid,
            "source_uuid": self.source_uuid,
            "target_uuid": self.target_uuid,
            "relation_type": self.relation_type,
            "description": self.description,
            "weight": self.weight,
            "is_temporal": self.is_temporal,
            "valid_from": self.valid_from,
            "valid_to": self.valid_to,
        }


@dataclass
class Ontology:
    """Graph ontology definition."""
    entity_types: List[Dict[str, Any]]
    edge_types: List[Dict[str, Any]]
    domain: str = "general"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "entity_types": self.entity_types,
            "edge_types": self.edge_types,
            "domain": self.domain,
        }


@dataclass
class KnowledgeGraph:
    """In-memory knowledge graph representation."""
    graph_id: str
    name: str
    status: GraphStatus = GraphStatus.CREATED
    ontology: Optional[Ontology] = None
    nodes: Dict[str, EntityNode] = field(default_factory=dict)
    edges: Dict[str, EntityEdge] = field(default_factory=dict)
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "graph_id": self.graph_id,
            "name": self.name,
            "status": self.status.value,
            "ontology": self.ontology.to_dict() if self.ontology else None,
            "node_count": len(self.nodes),
            "edge_count": len(self.edges),
            "created_at": self.created_at,
            "metadata": self.metadata,
        }


# ── Ontology Generator ──────────────────────────────────────────────────────

class OntologyGenerator:
    """
    Generates domain-aware ontologies using Claude.
    Adapted from MiroFish's OntologyGenerator with Sylor-specific domain prompts.
    """

    DOMAIN_PROMPTS = {
        "startup": """Design an ontology for analyzing startup business scenarios.
Entity types should include: Company, Person (founders/executives), Product, Market, Investor, Competitor, Customer_Segment, Technology.
Edge types should include: FOUNDED_BY, COMPETES_WITH, TARGETS_MARKET, FUNDED_BY, USES_TECHNOLOGY, SERVES_SEGMENT, PARTNERS_WITH.""",

        "finance": """Design an ontology for analyzing financial markets and investment scenarios.
Entity types should include: Asset, Portfolio, Market, Trader, Exchange, Index, Sector, Risk_Factor.
Edge types should include: TRADED_ON, CORRELATES_WITH, BELONGS_TO_SECTOR, HEDGES_AGAINST, BENCHMARKED_TO, INFLUENCES.""",

        "biology": """Design an ontology for analyzing molecular biology and biochemistry scenarios.
Entity types should include: Molecule, Protein, Enzyme, Pathway, Receptor, Cell, Drug, Gene.
Edge types should include: BINDS_TO, CATALYZES, INHIBITS, ACTIVATES, EXPRESSED_IN, REGULATES, INTERACTS_WITH.""",

        "trend": """Design an ontology for analyzing trends, time series, and forecasting scenarios.
Entity types should include: Data_Source, Signal, Pattern, Event, Factor, Indicator, Regime, Anomaly.
Edge types should include: CAUSES, CORRELATES_WITH, PRECEDES, AMPLIFIES, DAMPENS, TRIGGERS, INDICATES.""",

        "policy": """Design an ontology for analyzing policy and regulatory scenarios.
Entity types should include: Organization, Policy, Regulation, Stakeholder, Market, Impact_Area, Institution, Standard.
Edge types should include: REGULATES, IMPACTS, LOBBIES_FOR, COMPLIES_WITH, OPPOSES, IMPLEMENTS, AFFECTS.""",
    }

    def __init__(self, client: Optional[LLMClient] = None):
        self.llm = client or llm_client

    async def generate(
        self,
        document_text: str,
        simulation_category: str = "general",
        additional_context: str = "",
    ) -> Ontology:
        """Generate an ontology from document text and domain context."""
        domain_hint = self.DOMAIN_PROMPTS.get(simulation_category, "")

        # Truncate text for LLM context (same as MiroFish's 50k limit)
        truncated_text = document_text[:50000] if len(document_text) > 50000 else document_text

        system_prompt = """You are an expert knowledge graph architect. Your task is to design an ontology
(entity types and edge/relationship types) for building a knowledge graph from the provided documents.

RULES:
1. Define 5-10 entity types. Each has: name (PascalCase), description (under 100 chars), attributes (list of key properties).
2. Define 5-10 edge/relationship types. Each has: name (UPPER_SNAKE_CASE), description, source_types (list), target_types (list).
3. Entity types must be CONCRETE (people, organizations, products, locations) — NOT abstract concepts.
4. Always include "Person" and "Organization" as fallback entity types.
5. Make the ontology specific to the document content and simulation domain.

Return JSON with this exact structure:
{
  "entity_types": [
    {"name": "EntityType", "description": "...", "attributes": ["attr1", "attr2"]}
  ],
  "edge_types": [
    {"name": "EDGE_TYPE", "description": "...", "source_types": ["Type1"], "target_types": ["Type2"]}
  ]
}"""

        user_msg = f"""Document text (first section):
---
{truncated_text[:5000]}
---

{f"Domain-specific guidance: {domain_hint}" if domain_hint else ""}
{f"Additional context: {additional_context}" if additional_context else ""}

Design the ontology for this content."""

        try:
            result = await self.llm.chat_json(
                messages=[{"role": "user", "content": user_msg}],
                system=system_prompt,
                temperature=0.3,
                max_tokens=2000,
            )

            ontology = self._validate_ontology(result, simulation_category)
            return ontology

        except Exception:
            # Fallback: generate a default domain ontology
            return self._default_ontology(simulation_category)

    def _validate_ontology(self, result: Dict, domain: str) -> Ontology:
        """Validate and clean up LLM-generated ontology (from MiroFish pattern)."""
        entity_types = result.get("entity_types", [])
        edge_types = result.get("edge_types", [])

        # Ensure fallback types exist (MiroFish pattern)
        type_names = {et.get("name", "").lower() for et in entity_types}
        if "person" not in type_names:
            entity_types.append({"name": "Person", "description": "An individual person", "attributes": ["role", "affiliation"]})
        if "organization" not in type_names:
            entity_types.append({"name": "Organization", "description": "A company or institution", "attributes": ["industry", "size"]})

        # Enforce limits (MiroFish: max 10 each)
        entity_types = entity_types[:10]
        edge_types = edge_types[:10]

        # Truncate descriptions (MiroFish pattern)
        for et in entity_types:
            if len(et.get("description", "")) > 100:
                et["description"] = et["description"][:97] + "..."
        for et in edge_types:
            if len(et.get("description", "")) > 100:
                et["description"] = et["description"][:97] + "..."

        return Ontology(entity_types=entity_types, edge_types=edge_types, domain=domain)

    def _default_ontology(self, domain: str) -> Ontology:
        """Return a sensible default ontology for the domain."""
        defaults = {
            "startup": Ontology(
                entity_types=[
                    {"name": "Company", "description": "A business entity", "attributes": ["industry", "stage", "revenue"]},
                    {"name": "Person", "description": "An individual", "attributes": ["role", "expertise"]},
                    {"name": "Product", "description": "A product or service", "attributes": ["category", "price"]},
                    {"name": "Market", "description": "A target market", "attributes": ["size", "growth_rate"]},
                    {"name": "Investor", "description": "Funding source", "attributes": ["type", "fund_size"]},
                    {"name": "Organization", "description": "Institution or group", "attributes": ["type", "industry"]},
                ],
                edge_types=[
                    {"name": "COMPETES_WITH", "description": "Competition relationship", "source_types": ["Company"], "target_types": ["Company"]},
                    {"name": "TARGETS", "description": "Targets a market", "source_types": ["Company"], "target_types": ["Market"]},
                    {"name": "FUNDED_BY", "description": "Funding relationship", "source_types": ["Company"], "target_types": ["Investor"]},
                    {"name": "LEADS", "description": "Leadership role", "source_types": ["Person"], "target_types": ["Company"]},
                    {"name": "OFFERS", "description": "Product offering", "source_types": ["Company"], "target_types": ["Product"]},
                ],
                domain=domain,
            ),
            "finance": Ontology(
                entity_types=[
                    {"name": "Asset", "description": "Tradeable financial asset", "attributes": ["ticker", "asset_class", "market_cap"]},
                    {"name": "Market", "description": "Financial market", "attributes": ["region", "type"]},
                    {"name": "Sector", "description": "Industry sector", "attributes": ["name", "pe_ratio"]},
                    {"name": "Person", "description": "Market participant", "attributes": ["role", "firm"]},
                    {"name": "Organization", "description": "Financial institution", "attributes": ["type", "aum"]},
                    {"name": "Risk_Factor", "description": "Source of risk", "attributes": ["type", "severity"]},
                ],
                edge_types=[
                    {"name": "TRADED_ON", "description": "Traded on exchange", "source_types": ["Asset"], "target_types": ["Market"]},
                    {"name": "CORRELATES_WITH", "description": "Price correlation", "source_types": ["Asset"], "target_types": ["Asset"]},
                    {"name": "BELONGS_TO", "description": "Sector membership", "source_types": ["Asset"], "target_types": ["Sector"]},
                    {"name": "MANAGES", "description": "Portfolio management", "source_types": ["Organization"], "target_types": ["Asset"]},
                    {"name": "EXPOSED_TO", "description": "Risk exposure", "source_types": ["Asset"], "target_types": ["Risk_Factor"]},
                ],
                domain=domain,
            ),
        }

        return defaults.get(domain, Ontology(
            entity_types=[
                {"name": "Person", "description": "An individual", "attributes": ["role", "affiliation"]},
                {"name": "Organization", "description": "A company or institution", "attributes": ["industry", "size"]},
                {"name": "Concept", "description": "An important concept or topic", "attributes": ["category"]},
                {"name": "Location", "description": "A geographical location", "attributes": ["type"]},
                {"name": "Event", "description": "A notable event", "attributes": ["date", "type"]},
            ],
            edge_types=[
                {"name": "RELATED_TO", "description": "General relationship", "source_types": ["Person", "Organization"], "target_types": ["Person", "Organization"]},
                {"name": "PARTICIPATES_IN", "description": "Event participation", "source_types": ["Person", "Organization"], "target_types": ["Event"]},
                {"name": "LOCATED_IN", "description": "Location association", "source_types": ["Organization"], "target_types": ["Location"]},
                {"name": "ASSOCIATED_WITH", "description": "Topic association", "source_types": ["Person", "Organization"], "target_types": ["Concept"]},
            ],
            domain=domain,
        ))


# ── Knowledge Graph Builder ──────────────────────────────────────────────────

class KnowledgeGraphBuilder:
    """
    Builds knowledge graphs from documents using LLM-powered entity extraction.
    Adapted from MiroFish's GraphBuilderService but uses in-memory graphs
    with optional Zep Cloud backend.
    """

    # In-memory graph store
    _graphs: Dict[str, KnowledgeGraph] = {}

    def __init__(self, client: Optional[LLMClient] = None):
        self.llm = client or llm_client
        self.ontology_generator = OntologyGenerator(self.llm)

    async def create_graph(self, name: str, domain: str = "general") -> KnowledgeGraph:
        """Create a new empty knowledge graph."""
        graph_id = f"graph_{uuid.uuid4().hex[:12]}"
        graph = KnowledgeGraph(
            graph_id=graph_id,
            name=name,
            status=GraphStatus.CREATED,
        )
        self._graphs[graph_id] = graph
        return graph

    async def build_graph(
        self,
        graph_id: str,
        text: str,
        ontology: Optional[Ontology] = None,
        simulation_category: str = "general",
        chunk_size: int = 500,
        chunk_overlap: int = 50,
        progress_callback: Optional[Callable[[float, str], Awaitable[None]]] = None,
    ) -> KnowledgeGraph:
        """
        Build a knowledge graph from text.
        Follows MiroFish's multi-step pipeline:
        1. Generate ontology (if not provided)
        2. Chunk text
        3. Extract entities and relationships from each chunk
        4. Merge and deduplicate
        """
        graph = self._graphs.get(graph_id)
        if not graph:
            raise ValueError(f"Graph {graph_id} not found")

        graph.status = GraphStatus.BUILDING

        try:
            # Step 1: Generate or use provided ontology
            if progress_callback:
                await progress_callback(5.0, "Generating ontology...")

            if ontology is None:
                ontology = await self.ontology_generator.generate(text, simulation_category)
            graph.ontology = ontology

            if progress_callback:
                await progress_callback(15.0, "Chunking text...")

            # Step 2: Chunk text
            chunks = TextProcessor.split_text(text, chunk_size, chunk_overlap)

            if progress_callback:
                await progress_callback(20.0, f"Extracting entities from {len(chunks)} chunks...")

            # Step 3: Extract entities and edges from each chunk
            total_chunks = len(chunks)
            for i, chunk in enumerate(chunks):
                try:
                    entities, edges = await self._extract_from_chunk(
                        chunk.content, ontology
                    )

                    # Merge into graph
                    for entity in entities:
                        existing = self._find_entity(graph, entity.name)
                        if existing:
                            # Merge attributes
                            existing.attributes.update(entity.attributes)
                            if entity.summary and len(entity.summary) > len(existing.summary):
                                existing.summary = entity.summary
                        else:
                            graph.nodes[entity.uuid] = entity

                    for edge in edges:
                        # Resolve source/target by name
                        source = self._find_entity(graph, edge.source_uuid)
                        target = self._find_entity(graph, edge.target_uuid)
                        if source and target:
                            edge.source_uuid = source.uuid
                            edge.target_uuid = target.uuid
                            graph.edges[edge.uuid] = edge

                except Exception:
                    continue  # Skip failed chunks (MiroFish pattern: graceful degradation)

                if progress_callback:
                    pct = 20 + (i + 1) / total_chunks * 70
                    await progress_callback(pct, f"Processed chunk {i + 1}/{total_chunks}")

            # Step 4: Enrich entities with edge data
            self._enrich_entities(graph)

            if progress_callback:
                await progress_callback(95.0, "Finalizing graph...")

            graph.status = GraphStatus.READY
            graph.metadata = {
                "node_count": len(graph.nodes),
                "edge_count": len(graph.edges),
                "entity_types": list(set(n.entity_type for n in graph.nodes.values())),
                "chunk_count": total_chunks,
            }

            if progress_callback:
                await progress_callback(100.0, "Graph complete!")

            return graph

        except Exception as e:
            graph.status = GraphStatus.FAILED
            graph.metadata["error"] = str(e)
            raise

    async def _extract_from_chunk(
        self, text: str, ontology: Ontology
    ) -> tuple[List[EntityNode], List[EntityEdge]]:
        """Extract entities and relationships from a text chunk using Claude."""
        entity_type_names = [et["name"] for et in ontology.entity_types]
        edge_type_names = [et["name"] for et in ontology.edge_types]

        system_prompt = f"""You are a knowledge graph extraction expert. Extract entities and relationships from the text.

Available entity types: {", ".join(entity_type_names)}
Available relationship types: {", ".join(edge_type_names)}

Return JSON:
{{
  "entities": [
    {{"name": "Entity Name", "type": "EntityType", "summary": "Brief description", "attributes": {{"key": "value"}}}}
  ],
  "edges": [
    {{"source": "Source Entity Name", "target": "Target Entity Name", "type": "EDGE_TYPE", "description": "Relationship description"}}
  ]
}}

Only extract entities that clearly appear in the text. Use the exact type names provided."""

        try:
            result = await self.llm.chat_json(
                messages=[{"role": "user", "content": f"Extract entities and relationships:\n\n{text}"}],
                system=system_prompt,
                temperature=0.1,
                max_tokens=2000,
            )

            entities = []
            for e in result.get("entities", []):
                entity = EntityNode(
                    uuid=f"entity_{uuid.uuid4().hex[:8]}",
                    name=e.get("name", ""),
                    entity_type=e.get("type", "Concept"),
                    summary=e.get("summary", ""),
                    attributes=e.get("attributes", {}),
                )
                if entity.name:
                    entities.append(entity)

            edges = []
            for e in result.get("edges", []):
                edge = EntityEdge(
                    uuid=f"edge_{uuid.uuid4().hex[:8]}",
                    source_uuid=e.get("source", ""),  # Will be resolved to UUID later
                    target_uuid=e.get("target", ""),
                    relation_type=e.get("type", "RELATED_TO"),
                    description=e.get("description", ""),
                )
                if edge.source_uuid and edge.target_uuid:
                    edges.append(edge)

            return entities, edges

        except Exception:
            return [], []

    def _find_entity(self, graph: KnowledgeGraph, name: str) -> Optional[EntityNode]:
        """Find entity by name (case-insensitive)."""
        name_lower = name.lower().strip()
        for node in graph.nodes.values():
            if node.name.lower().strip() == name_lower:
                return node
        return None

    def _enrich_entities(self, graph: KnowledgeGraph) -> None:
        """
        Enrich entities with their edge relationships.
        Adapted from MiroFish's two-pass enrichment pattern.
        """
        for edge in graph.edges.values():
            # Add to source's related_edges
            if edge.source_uuid in graph.nodes:
                source = graph.nodes[edge.source_uuid]
                source.related_edges.append(edge.to_dict())
                if edge.target_uuid in graph.nodes:
                    target = graph.nodes[edge.target_uuid]
                    source.related_nodes.append({
                        "uuid": target.uuid,
                        "name": target.name,
                        "type": target.entity_type,
                        "relation": edge.relation_type,
                    })

            # Add to target's related_edges
            if edge.target_uuid in graph.nodes:
                target = graph.nodes[edge.target_uuid]
                target.related_edges.append(edge.to_dict())
                if edge.source_uuid in graph.nodes:
                    source = graph.nodes[edge.source_uuid]
                    target.related_nodes.append({
                        "uuid": source.uuid,
                        "name": source.name,
                        "type": source.entity_type,
                        "relation": f"inverse_{edge.relation_type}",
                    })

    # ── Graph Query Methods ──────────────────────────────────────────────────

    def get_graph(self, graph_id: str) -> Optional[KnowledgeGraph]:
        return self._graphs.get(graph_id)

    def list_graphs(self) -> List[Dict[str, Any]]:
        return [g.to_dict() for g in self._graphs.values()]

    def delete_graph(self, graph_id: str) -> bool:
        if graph_id in self._graphs:
            del self._graphs[graph_id]
            return True
        return False

    def get_nodes(self, graph_id: str) -> List[EntityNode]:
        graph = self._graphs.get(graph_id)
        if not graph:
            return []
        return list(graph.nodes.values())

    def get_edges(self, graph_id: str) -> List[EntityEdge]:
        graph = self._graphs.get(graph_id)
        if not graph:
            return []
        return list(graph.edges.values())

    def get_entities_by_type(self, graph_id: str, entity_type: str) -> List[EntityNode]:
        """Filter entities by type (from MiroFish's ZepEntityReader pattern)."""
        graph = self._graphs.get(graph_id)
        if not graph:
            return []
        return [n for n in graph.nodes.values()
                if n.entity_type.lower() == entity_type.lower()]

    def get_entity_with_context(self, graph_id: str, entity_uuid: str) -> Optional[EntityNode]:
        """Get entity with all its relationships."""
        graph = self._graphs.get(graph_id)
        if not graph:
            return None
        return graph.nodes.get(entity_uuid)

    async def search_graph(
        self, graph_id: str, query: str, limit: int = 10
    ) -> List[EntityNode]:
        """
        Semantic search over graph entities.
        Improved over MiroFish: uses Claude for relevance scoring instead of keyword matching.
        """
        graph = self._graphs.get(graph_id)
        if not graph or not graph.nodes:
            return []

        # Build entity summaries for scoring
        entity_summaries = []
        for node in graph.nodes.values():
            summary = f"{node.name} ({node.entity_type}): {node.summary}"
            entity_summaries.append({"uuid": node.uuid, "summary": summary})

        # Use LLM to score relevance (improvement over MiroFish's keyword matching)
        try:
            result = await self.llm.chat_json(
                messages=[{"role": "user", "content": f"""Query: "{query}"

Entities:
{json.dumps(entity_summaries[:50], indent=1)}

Return the UUIDs of the most relevant entities, ordered by relevance:
{{"relevant_uuids": ["uuid1", "uuid2", ...]}}"""}],
                system="Score entity relevance to the query. Return only the most relevant entity UUIDs.",
                temperature=0.1,
                max_tokens=500,
            )

            relevant_uuids = result.get("relevant_uuids", [])[:limit]
            return [graph.nodes[uid] for uid in relevant_uuids if uid in graph.nodes]

        except Exception:
            # Fallback: simple keyword matching (MiroFish pattern)
            query_lower = query.lower()
            scored = []
            for node in graph.nodes.values():
                score = 0
                if query_lower in node.name.lower():
                    score += 3
                if query_lower in node.summary.lower():
                    score += 2
                if query_lower in str(node.attributes).lower():
                    score += 1
                if score > 0:
                    node.relevance_score = score
                    scored.append(node)

            scored.sort(key=lambda n: n.relevance_score, reverse=True)
            return scored[:limit]

    def get_graph_statistics(self, graph_id: str) -> Dict[str, Any]:
        """Get graph statistics (from MiroFish pattern)."""
        graph = self._graphs.get(graph_id)
        if not graph:
            return {}

        entity_types = {}
        for node in graph.nodes.values():
            et = node.entity_type
            entity_types[et] = entity_types.get(et, 0) + 1

        edge_types = {}
        for edge in graph.edges.values():
            et = edge.relation_type
            edge_types[et] = edge_types.get(et, 0) + 1

        return {
            "graph_id": graph_id,
            "name": graph.name,
            "status": graph.status.value,
            "total_nodes": len(graph.nodes),
            "total_edges": len(graph.edges),
            "entity_types": entity_types,
            "edge_types": edge_types,
            "created_at": graph.created_at,
        }


# ── Singleton builder instance ───────────────────────────────────────────────

graph_builder = KnowledgeGraphBuilder()
