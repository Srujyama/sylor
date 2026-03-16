"""
Knowledge Graph API.
Direct graph query endpoints.
Adapted from MiroFish's graph.py with additional search capabilities.
"""
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.knowledge_graph import graph_builder

router = APIRouter(prefix="/api/graphs", tags=["graphs"])


class SearchRequest(BaseModel):
    query: str
    limit: int = 10


@router.get("")
async def list_graphs():
    """List all knowledge graphs."""
    return graph_builder.list_graphs()


@router.get("/{graph_id}")
async def get_graph(graph_id: str):
    """Get graph metadata and statistics."""
    stats = graph_builder.get_graph_statistics(graph_id)
    if not stats:
        raise HTTPException(status_code=404, detail="Graph not found")
    return stats


@router.get("/{graph_id}/nodes")
async def get_nodes(graph_id: str, entity_type: Optional[str] = None):
    """Get all nodes, optionally filtered by entity type."""
    if entity_type:
        nodes = graph_builder.get_entities_by_type(graph_id, entity_type)
    else:
        nodes = graph_builder.get_nodes(graph_id)

    return {"nodes": [n.to_dict() for n in nodes], "count": len(nodes)}


@router.get("/{graph_id}/edges")
async def get_edges(graph_id: str):
    """Get all edges in the graph."""
    edges = graph_builder.get_edges(graph_id)
    return {"edges": [e.to_dict() for e in edges], "count": len(edges)}


@router.get("/{graph_id}/entities/{entity_uuid}")
async def get_entity(graph_id: str, entity_uuid: str):
    """Get entity with full context and relationships."""
    entity = graph_builder.get_entity_with_context(graph_id, entity_uuid)
    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")
    return entity.to_dict()


@router.post("/{graph_id}/search")
async def search_graph(graph_id: str, body: SearchRequest):
    """
    Semantic search over graph entities.
    Uses Claude for relevance scoring with keyword fallback.
    """
    results = await graph_builder.search_graph(graph_id, body.query, body.limit)
    return {
        "results": [r.to_dict() for r in results],
        "count": len(results),
        "query": body.query,
    }


@router.delete("/{graph_id}", status_code=204)
async def delete_graph(graph_id: str):
    """Delete a knowledge graph."""
    if not graph_builder.delete_graph(graph_id):
        raise HTTPException(status_code=404, detail="Graph not found")
