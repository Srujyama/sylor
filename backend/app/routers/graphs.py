"""
Knowledge Graph API.
Direct graph query endpoints.
Adapted from MiroFish's graph.py with additional search capabilities.

All endpoints require authentication. Graphs that carry a user_id are
only readable/deletable by their owner; the list endpoint is always
scoped to the authenticated user.
"""
import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field

from app.middleware.auth import get_current_user
from app.middleware.rate_limit import require_expensive_rate_limit
from app.services.knowledge_graph import graph_builder
from app.services.causal import build_causal_dag, do_intervene

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/graphs", tags=["graphs"])


class SearchRequest(BaseModel):
    query: str
    limit: int = 10


class InterveneRequest(BaseModel):
    node_uuid: str
    direction: str = Field(pattern="^(increase|decrease)$")
    magnitude: float = Field(default=0.5, ge=0.0, le=1.0)


async def _check_graph_access(graph_id: str, user: dict):
    """404 if the graph is missing, 403 if it belongs to another user."""
    graph = await graph_builder.get_graph(graph_id)
    if not graph:
        raise HTTPException(status_code=404, detail="Graph not found")
    if graph.user_id is not None and graph.user_id != user["uid"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    return graph


@router.get("")
async def list_graphs(user: dict = Depends(get_current_user)):
    """List the authenticated user's knowledge graphs."""
    return await graph_builder.list_graphs(user_id=user["uid"])


@router.get("/{graph_id}")
async def get_graph(graph_id: str, user: dict = Depends(get_current_user)):
    """Get graph metadata and statistics."""
    await _check_graph_access(graph_id, user)
    stats = await graph_builder.get_graph_statistics(graph_id)
    if not stats:
        raise HTTPException(status_code=404, detail="Graph not found")
    return stats


@router.get("/{graph_id}/nodes")
async def get_nodes(
    graph_id: str,
    entity_type: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """Get all nodes, optionally filtered by entity type."""
    await _check_graph_access(graph_id, user)
    if entity_type:
        nodes = await graph_builder.get_entities_by_type(graph_id, entity_type)
    else:
        nodes = await graph_builder.get_nodes(graph_id)

    return {"nodes": [n.to_dict() for n in nodes], "count": len(nodes)}


@router.get("/{graph_id}/edges")
async def get_edges(graph_id: str, user: dict = Depends(get_current_user)):
    """Get all edges in the graph."""
    await _check_graph_access(graph_id, user)
    edges = await graph_builder.get_edges(graph_id)
    return {"edges": [e.to_dict() for e in edges], "count": len(edges)}


@router.get("/{graph_id}/entities/{entity_uuid}")
async def get_entity(
    graph_id: str,
    entity_uuid: str,
    user: dict = Depends(get_current_user),
):
    """Get entity with full context and relationships."""
    await _check_graph_access(graph_id, user)
    entity = await graph_builder.get_entity_with_context(graph_id, entity_uuid)
    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")
    return entity.to_dict()


@router.post("/{graph_id}/search")
async def search_graph(
    graph_id: str,
    body: SearchRequest,
    user: dict = Depends(get_current_user),
):
    """
    Semantic search over graph entities.
    Uses Claude for relevance scoring with keyword fallback.
    """
    await _check_graph_access(graph_id, user)
    results = await graph_builder.search_graph(graph_id, body.query, body.limit)
    return {
        "results": [r.to_dict() for r in results],
        "count": len(results),
        "query": body.query,
    }


@router.delete("/{graph_id}", status_code=204)
async def delete_graph(graph_id: str, user: dict = Depends(get_current_user)):
    """Delete a knowledge graph."""
    await _check_graph_access(graph_id, user)
    if not await graph_builder.delete_graph(graph_id):
        raise HTTPException(status_code=404, detail="Graph not found")


# ── Causal DAG + do-operator ──────────────────────────────────────────────────

@router.get("/{graph_id}/causal")
async def get_causal_graph(graph_id: str, user: dict = Depends(get_current_user)):
    """Return the causal sub-DAG of a knowledge graph.

    Filters the graph's edges to the causal relation types (CAUSES, AMPLIFIES,
    DAMPENS, TRIGGERS, INFLUENCES, REGULATES, PRECEDES), builds a directed graph,
    derives a sign per edge (DAMPENS -> negative, else positive), and detects
    cycles (noting which edges were broken for DAG layering). 404 if the graph
    is missing, 403 if not owner.
    """
    await _check_graph_access(graph_id, user)
    nodes = await graph_builder.get_nodes(graph_id)
    edges = await graph_builder.get_edges(graph_id)

    dag = build_causal_dag(nodes, edges)

    response = {
        "nodes": [
            {"uuid": n["uuid"], "name": n["name"], "entity_type": n["entity_type"]}
            for n in dag.nodes.values()
        ],
        "edges": dag.edges,
        "has_cycles": dag.has_cycles,
    }
    if dag.cycle_note:
        response["cycle_note"] = dag.cycle_note
    return response


@router.post("/{graph_id}/intervene",
             dependencies=[Depends(require_expensive_rate_limit)])
async def intervene_graph(
    graph_id: str,
    request: InterveneRequest,
    user: dict = Depends(get_current_user),
):
    """Pearl-style do() on the causal DAG: intervene on a node, see effects.

    Clamps the intervened node to a signed seed (by *direction* and *magnitude*)
    and propagates a signed, decaying effect along outgoing causal edges,
    accumulating a tanh-bounded predicted_change per downstream node. Effects are
    sorted by magnitude. 404 graph missing, 403 not owner, 422 unknown node_uuid.

    This is DIRECTIONAL inference, not point estimates — stated in the note.
    """
    await _check_graph_access(graph_id, user)
    nodes = await graph_builder.get_nodes(graph_id)
    edges = await graph_builder.get_edges(graph_id)

    dag = build_causal_dag(nodes, edges)
    if request.node_uuid not in dag.nodes:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown node_uuid '{request.node_uuid}'.",
        )

    effects = do_intervene(dag, request.node_uuid, request.direction, request.magnitude)

    intervened = dag.nodes[request.node_uuid]
    return {
        "intervened_node": {"uuid": intervened["uuid"], "name": intervened["name"]},
        "effects": effects,
        "note": (
            "Directional inference, not point estimates. Predicted changes are "
            "signed, decaying propagations along causal edges (tanh-bounded to "
            "[-1, 1]); treat them as qualitative direction & relative magnitude."
        ),
    }
