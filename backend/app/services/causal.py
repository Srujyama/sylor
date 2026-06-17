"""
Causal DAG construction + Pearl-style do-operator over a knowledge graph.

This module is QUALITATIVE / DIRECTIONAL, not a calibrated structural causal
model. It builds a directed graph from a knowledge graph's edges, filtering to
the causal relation types in the domain ontologies, derives a sign for each
edge from its relation type, detects (and breaks, for layering) cycles, and
propagates a signed, decaying effect along outgoing causal edges to estimate
the downstream direction of an intervention. Predicted changes are tanh-bounded
to [-1, 1] and explicitly labelled as directional inference, not point
estimates.

Uses only the standard library + numpy-free pure Python (no heavy deps).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

# Causal relation types we keep (from the DOMAIN ontologies). CORRELATES_WITH is
# intentionally EXCLUDED — correlation is not causation, and the contract lists
# only the directed causal types.
CAUSAL_RELATION_TYPES = {
    "CAUSES",
    "AMPLIFIES",
    "DAMPENS",
    "TRIGGERS",
    "INFLUENCES",
    "REGULATES",
    "PRECEDES",
}

# Relation types whose causal effect is INVERSE (an increase in the source
# pushes the target DOWN). Everything else is treated as a positive influence.
_NEGATIVE_RELATION_TYPES = {"DAMPENS"}

# Per-hop multiplicative decay so distant nodes get smaller predicted changes.
_DECAY = 0.6
# Hard cap on propagation depth to bound work on dense/large graphs.
_MAX_DEPTH = 6


def edge_sign(relation_type: str) -> int:
    """Derive an edge sign (+1 / -1) from its relation type.

    DAMPENS (and any inverse-flavored relation) is negative; every other causal
    relation type is treated as a positive influence. This is a cheap heuristic
    — a richer system could read each edge's free-text description with an LLM,
    but the relation-type mapping is sufficient and far cheaper.
    """
    return -1 if (relation_type or "").upper() in _NEGATIVE_RELATION_TYPES else 1


@dataclass
class CausalDAG:
    """A directed causal graph derived from a knowledge graph.

    ``adjacency`` maps source_uuid -> list of (target_uuid, weight, sign).
    ``nodes`` maps uuid -> {uuid, name, entity_type}. ``has_cycles`` records
    whether any directed cycle was found; ``cycle_note`` describes the
    cycle-breaking applied for layering (None when acyclic).
    """
    nodes: Dict[str, Dict[str, str]] = field(default_factory=dict)
    adjacency: Dict[str, List[Tuple[str, float, int]]] = field(default_factory=dict)
    edges: List[Dict[str, object]] = field(default_factory=list)
    has_cycles: bool = False
    cycle_note: Optional[str] = None


def _filter_causal_edges(edges) -> List:
    """Keep only edges whose relation_type is a causal type."""
    return [e for e in edges if (getattr(e, "relation_type", "") or "").upper()
            in CAUSAL_RELATION_TYPES]


def _detect_and_break_cycles(
    adjacency: Dict[str, List[Tuple[str, float, int]]]
) -> Tuple[bool, List[Tuple[str, str]]]:
    """Detect directed cycles via DFS, returning (has_cycles, removed_back_edges).

    Back edges (edges pointing to a node currently on the DFS stack) are the
    ones that close a cycle; recording them lets the caller note which edges
    were broken to obtain a DAG layering. The adjacency itself is NOT mutated
    here — propagation uses depth/visited bounds rather than a physically
    acyclic graph, so this is purely for the cycle note.
    """
    WHITE, GRAY, BLACK = 0, 1, 2
    color: Dict[str, int] = {n: WHITE for n in adjacency}
    removed: List[Tuple[str, str]] = []

    # Iterative DFS with an explicit (node, neighbor-index) work-stack so a very
    # deep causal chain (>~1000 nodes) can't overflow Python's recursion limit
    # and 500 the request. GRAY = currently on the DFS stack (an ancestor).
    for root in list(adjacency):
        if color.get(root, WHITE) != WHITE:
            continue
        stack: List[Tuple[str, int]] = [(root, 0)]
        color[root] = GRAY
        while stack:
            u, i = stack[-1]
            neighbors = adjacency.get(u, [])
            if i < len(neighbors):
                stack[-1] = (u, i + 1)
                v = neighbors[i][0]
                c = color.get(v, WHITE)
                if c == WHITE:
                    color[v] = GRAY
                    stack.append((v, 0))
                elif c == GRAY:
                    # (u -> v) closes a cycle: v is an ancestor on the stack.
                    removed.append((u, v))
            else:
                color[u] = BLACK
                stack.pop()

    return (len(removed) > 0), removed


def build_causal_dag(nodes, edges) -> CausalDAG:
    """Build a :class:`CausalDAG` from knowledge-graph nodes + edges.

    *nodes* is an iterable of EntityNode (uuid/name/entity_type); *edges* is an
    iterable of EntityEdge (source_uuid/target_uuid/relation_type/weight). Only
    causal relation types are kept; edges whose endpoints are not both present
    in *nodes* are dropped. Cycles are detected and the edges that would close
    them are noted (broken for layering purposes).
    """
    node_map: Dict[str, Dict[str, str]] = {
        n.uuid: {"uuid": n.uuid, "name": n.name, "entity_type": n.entity_type}
        for n in nodes
    }

    causal_edges = _filter_causal_edges(edges)
    adjacency: Dict[str, List[Tuple[str, float, int]]] = {uid: [] for uid in node_map}
    edge_dicts: List[Dict[str, object]] = []

    for e in causal_edges:
        if e.source_uuid not in node_map or e.target_uuid not in node_map:
            continue
        sign = edge_sign(e.relation_type)
        weight = float(getattr(e, "weight", 1.0) or 1.0)
        adjacency.setdefault(e.source_uuid, []).append((e.target_uuid, weight, sign))
        edge_dicts.append({
            "source_uuid": e.source_uuid,
            "target_uuid": e.target_uuid,
            "relation_type": e.relation_type,
            "weight": weight,
            "sign": "negative" if sign < 0 else "positive",
        })

    has_cycles, removed = _detect_and_break_cycles(adjacency)
    cycle_note = None
    if has_cycles:
        broken = ", ".join(f"{s}->{t}" for s, t in removed[:5])
        more = "" if len(removed) <= 5 else f" (+{len(removed) - 5} more)"
        cycle_note = (
            f"{len(removed)} cyclic edge(s) detected and broken for DAG layering: "
            f"{broken}{more}. Propagation is depth-bounded so cycles cannot loop."
        )

    return CausalDAG(
        nodes=node_map,
        adjacency=adjacency,
        edges=edge_dicts,
        has_cycles=has_cycles,
        cycle_note=cycle_note,
    )


def do_intervene(
    dag: CausalDAG,
    node_uuid: str,
    direction: str,
    magnitude: float = 0.5,
) -> List[Dict[str, object]]:
    """Pearl-style do() on the causal DAG: clamp a node and propagate effects.

    Sets the intervened node to a signed seed (``+magnitude`` for "increase",
    ``-magnitude`` for "decrease"), then propagates a SIGNED, decaying effect
    along outgoing causal edges: each hop multiplies by ``edge weight * sign``
    and a per-hop decay factor. Effects accumulate per downstream node and are
    tanh-bounded to [-1, 1]. Propagation is breadth-limited by ``_MAX_DEPTH`` so
    cycles and dense graphs cannot blow up the work.

    Returns a list of downstream effect dicts
    ``{uuid, name, entity_type, predicted_change, path_length}`` sorted by
    ``abs(predicted_change)`` descending. The intervened node itself is NOT
    included. This is DIRECTIONAL inference, not a point estimate.
    """
    if node_uuid not in dag.nodes:
        raise KeyError(node_uuid)

    magnitude = max(0.0, min(1.0, float(magnitude)))
    seed = magnitude if direction == "increase" else -magnitude

    # Accumulated raw (pre-tanh) effect per node, and shortest path length found.
    raw_effect: Dict[str, float] = {}
    best_depth: Dict[str, int] = {}

    # BFS-ish propagation with depth bound. We carry the signed effect along each
    # path; the SAME node reached via multiple paths accumulates contributions.
    # A (node, depth) frontier prevents unbounded re-expansion through cycles.
    frontier: List[Tuple[str, float, int]] = [(node_uuid, seed, 0)]
    visited_at_depth: set = set()

    while frontier:
        current, effect, depth = frontier.pop()
        if depth >= _MAX_DEPTH:
            continue
        state_key = (current, depth)
        if state_key in visited_at_depth:
            continue
        visited_at_depth.add(state_key)

        for (target, weight, sign) in dag.adjacency.get(current, []):
            # Effect decays per hop and is scaled by the edge weight and sign.
            propagated = effect * weight * sign * _DECAY
            if abs(propagated) < 1e-6:
                continue  # negligible — stop propagating this branch
            raw_effect[target] = raw_effect.get(target, 0.0) + propagated
            new_depth = depth + 1
            if target not in best_depth or new_depth < best_depth[target]:
                best_depth[target] = new_depth
            frontier.append((target, propagated, new_depth))

    effects: List[Dict[str, object]] = []
    for uid, raw in raw_effect.items():
        if uid == node_uuid:
            continue  # never report the intervened node as its own downstream
        node = dag.nodes.get(uid, {"uuid": uid, "name": uid, "entity_type": "Unknown"})
        effects.append({
            "uuid": uid,
            "name": node["name"],
            "entity_type": node["entity_type"],
            # tanh squashes the accumulated raw effect into (-1, 1).
            "predicted_change": round(math.tanh(raw), 4),
            "path_length": int(best_depth.get(uid, 1)),
        })

    effects.sort(key=lambda e: abs(e["predicted_change"]), reverse=True)
    return effects
