"""
Cross-domain composite simulations.

A *composite* is a DAG of sub-simulations linked by ``metric -> variable`` edges.
Each node is a full ``SimulationConfig`` (a standalone sub-sim, e.g. a biology
binding-affinity model feeding a business go-to-market model). A *link* takes an
upstream node's output metric, transforms it, and injects it as a variable
override on a downstream node.

Uncertainty propagation
------------------------
Nodes execute in topological order. A single shared ``base_seed`` is used; node
*k* (in topo order) is offset by ``k * _NODE_SEED_STRIDE`` so its paths are
independent of its siblings yet fully reproducible.

For each Monte-Carlo path index ``i`` we run every node's SINGLE path ``i`` (via
``SimulationEngine.run_single_path``, which seeds path ``i`` with
``random.Random(node_base_seed + i)`` — identical to the mass loop) in topo
order. When a link's ``from_metric`` is a PER-PATH metric
(``final_revenue`` / ``final_market_share`` / ``success_rate``-as-success-bool),
the transformed upstream path-``i`` output is injected as a downstream variable
override FOR THAT SAME path ``i``. So a strong biology path feeds the matching
business path — genuine path-aligned uncertainty propagation, NOT mean-passing.

For AGGREGATE ``from_metric`` links (``success_probability`` / ``avg_revenue`` /
``avg_market_share``) we first run the upstream node fully (all paths), take the
aggregate, and inject it as a CONSTANT override on every downstream path. This is
mean-passed and is acceptable for aggregate links per the contract.

Each node's collected per-path dicts are folded into a normal
``SimulationResults`` via ``SimulationEngine.aggregate_paths`` (the exact same
statistics ``run()`` uses).

Bounds: at most ``MAX_NODES`` (6) nodes; ``num_runs`` capped at ``MAX_NUM_RUNS``
(5000). Graph algorithms are ITERATIVE (Kahn topological sort) so a deep/wide
graph cannot overflow Python's recursion limit.
"""
from __future__ import annotations

import logging
import math
import random
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from app.models.simulation import SimulationConfig, SimulationResults
from app.services.simulation_engine import SimulationEngine
from app.services.llm_client import llm_client

logger = logging.getLogger(__name__)

# ── Bounds (also enforced at the router) ─────────────────────────────────────
MAX_NODES = 6
MAX_NUM_RUNS = 5000
MIN_NUM_RUNS = 10
DEFAULT_NUM_RUNS = 1000

# Per-node seed offset so sibling nodes draw independent path streams while the
# whole composite stays reproducible from a single base_seed.
_NODE_SEED_STRIDE = 1_000_003  # prime, comfortably larger than MAX_NUM_RUNS

# Metric vocabularies.
AGGREGATE_METRICS = {"success_probability", "avg_revenue", "avg_market_share"}
PER_PATH_METRICS = {"final_revenue", "final_market_share", "success_rate"}
VALID_FROM_METRICS = AGGREGATE_METRICS | PER_PATH_METRICS
VALID_TRANSFORMS = {"linear", "scale", "normalize", "direct"}


class CompositeValidationError(ValueError):
    """Raised on an invalid composite (unknown refs, cycle, bad metric/transform)."""


# ── Data model ───────────────────────────────────────────────────────────────


@dataclass
class CompositeLink:
    from_node: str
    from_metric: str
    to_node: str
    to_variable: str
    transform: str = "direct"
    factor: float = 1.0

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "CompositeLink":
        return cls(
            from_node=str(d["from_node"]),
            from_metric=str(d["from_metric"]),
            to_node=str(d["to_node"]),
            to_variable=str(d["to_variable"]),
            transform=str(d.get("transform", "direct")),
            factor=float(d["factor"]) if d.get("factor") is not None else 1.0,
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "from_node": self.from_node,
            "from_metric": self.from_metric,
            "to_node": self.to_node,
            "to_variable": self.to_variable,
            "transform": self.transform,
            "factor": self.factor,
        }

    @property
    def is_per_path(self) -> bool:
        return self.from_metric in PER_PATH_METRICS


@dataclass
class CompositeNode:
    node_id: str
    label: str
    config: SimulationConfig

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "CompositeNode":
        return cls(
            node_id=str(d["node_id"]),
            label=str(d.get("label") or d["node_id"]),
            config=SimulationConfig(**d["config"]),
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "node_id": self.node_id,
            "label": self.label,
            "config": self.config.model_dump(mode="json"),
        }


@dataclass
class CompositeConfig:
    name: str
    nodes: List[CompositeNode] = field(default_factory=list)
    links: List[CompositeLink] = field(default_factory=list)
    num_runs: int = DEFAULT_NUM_RUNS

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "CompositeConfig":
        return cls(
            name=str(d.get("name") or "Composite"),
            num_runs=int(d.get("num_runs") or DEFAULT_NUM_RUNS),
            nodes=[CompositeNode.from_dict(n) for n in (d.get("nodes") or [])],
            links=[CompositeLink.from_dict(link) for link in (d.get("links") or [])],
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "num_runs": self.num_runs,
            "nodes": [n.to_dict() for n in self.nodes],
            "links": [link.to_dict() for link in self.links],
        }


# ── Validation + topological sort (iterative Kahn) ───────────────────────────


def validate_dag(composite: CompositeConfig) -> List[str]:
    """Validate a composite and return its topological execution order.

    Raises ``CompositeValidationError`` when:
      - a link references an unknown ``from_node`` / ``to_node``,
      - a link's ``to_variable`` is not a variable name in the downstream node,
      - a link's ``from_metric`` / ``transform`` is not in the allowed vocabulary,
      - the link graph contains a directed cycle (it must be a DAG),
      - two node_ids collide.

    Returns the node_ids in a valid topological order (Kahn's algorithm — fully
    iterative, no recursion-limit risk).
    """
    node_ids = [n.node_id for n in composite.nodes]
    if len(set(node_ids)) != len(node_ids):
        raise CompositeValidationError("Duplicate node_id values are not allowed.")

    node_by_id = {n.node_id: n for n in composite.nodes}
    var_names_by_node = {
        n.node_id: {v.name for v in n.config.variables} for n in composite.nodes
    }

    for link in composite.links:
        if link.from_node not in node_by_id:
            raise CompositeValidationError(
                f"Link references unknown from_node '{link.from_node}'."
            )
        if link.to_node not in node_by_id:
            raise CompositeValidationError(
                f"Link references unknown to_node '{link.to_node}'."
            )
        if link.from_metric not in VALID_FROM_METRICS:
            raise CompositeValidationError(
                f"Link from_metric '{link.from_metric}' is invalid. "
                f"Valid metrics: {sorted(VALID_FROM_METRICS)}."
            )
        if link.transform not in VALID_TRANSFORMS:
            raise CompositeValidationError(
                f"Link transform '{link.transform}' is invalid. "
                f"Valid transforms: {sorted(VALID_TRANSFORMS)}."
            )
        if not math.isfinite(link.factor):
            raise CompositeValidationError(
                f"Link factor must be a finite number, got {link.factor!r}."
            )
        if link.to_variable not in var_names_by_node[link.to_node]:
            raise CompositeValidationError(
                f"Link to_variable '{link.to_variable}' is not a variable of "
                f"node '{link.to_node}'. Valid variables: "
                f"{sorted(var_names_by_node[link.to_node])}."
            )

    return _topological_order(node_ids, composite.links)


def _topological_order(
    node_ids: List[str], links: List[CompositeLink]
) -> List[str]:
    """Kahn's algorithm. Raises ``CompositeValidationError`` on a cycle.

    Iterative by construction (no recursion), so a long chain cannot overflow
    the recursion limit. Ties are broken by the node's original declaration
    order for a stable, deterministic result.
    """
    order_index = {nid: i for i, nid in enumerate(node_ids)}
    indegree: Dict[str, int] = {nid: 0 for nid in node_ids}
    adjacency: Dict[str, List[str]] = {nid: [] for nid in node_ids}

    # Deduplicate edges so multiple links between the same pair don't inflate the
    # indegree (a single dependency, even with several metric->variable links).
    seen_edges = set()
    for link in links:
        edge = (link.from_node, link.to_node)
        if edge in seen_edges or link.from_node == link.to_node:
            # A self-loop is itself a cycle; let the count below catch it.
            if link.from_node == link.to_node:
                indegree[link.to_node] += 1
            continue
        seen_edges.add(edge)
        adjacency[link.from_node].append(link.to_node)
        indegree[link.to_node] += 1

    # Frontier of zero-indegree nodes, kept sorted by declaration order.
    frontier = sorted(
        [nid for nid in node_ids if indegree[nid] == 0],
        key=lambda nid: order_index[nid],
    )
    order: List[str] = []
    while frontier:
        nid = frontier.pop(0)
        order.append(nid)
        newly_free = []
        for nxt in adjacency[nid]:
            indegree[nxt] -= 1
            if indegree[nxt] == 0:
                newly_free.append(nxt)
        if newly_free:
            frontier.extend(sorted(newly_free, key=lambda x: order_index[x]))
            frontier.sort(key=lambda x: order_index[x])

    if len(order) != len(node_ids):
        unresolved = [nid for nid in node_ids if nid not in set(order)]
        raise CompositeValidationError(
            f"Composite link graph has a cycle; cannot topologically order "
            f"nodes {sorted(unresolved)}. The graph must be a DAG."
        )
    return order


# ── Transforms ───────────────────────────────────────────────────────────────


def _variable_bounds(
    config: SimulationConfig, var_name: str
) -> Tuple[Optional[float], Optional[float]]:
    for v in config.variables:
        if v.name == var_name:
            return v.min, v.max
    return None, None


def apply_transform(
    value: float,
    link: CompositeLink,
    downstream_config: SimulationConfig,
) -> float:
    """Transform an upstream metric value into a downstream variable override.

    - ``linear`` / ``scale``: ``value * factor`` (scale is a documented alias).
    - ``normalize``: clamp into the downstream variable's [min, max] if both are
      present, else pass through unchanged.
    - ``direct``: unchanged.
    """
    transform = link.transform
    if transform in ("linear", "scale"):
        out = value * link.factor
    elif transform == "normalize":
        lo, hi = _variable_bounds(downstream_config, link.to_variable)
        out = max(lo, min(hi, value)) if (lo is not None and hi is not None) else value
    else:
        # direct (or any unexpected value already rejected by validate_dag)
        out = value
    # Defensive: an overflow (huge factor) or inf*0 upstream can yield a
    # non-finite result that would crash int() conversions deep in the engine.
    # Coerce to 0.0 so a degenerate link can never 500 the run.
    return out if math.isfinite(out) else 0.0


# ── Execution ────────────────────────────────────────────────────────────────


def _per_path_metric(path_result: Dict[str, Any], metric: str) -> float:
    """Extract a per-path metric value from a raw ``run_single_path`` dict."""
    if metric == "final_revenue":
        return float(path_result.get("final_revenue", 0.0))
    if metric == "final_market_share":
        return float(path_result.get("final_market_share", 0.0))
    if metric == "success_rate":
        # success_rate as a per-path metric is the path's success boolean (0/1).
        return 1.0 if path_result.get("success") else 0.0
    return 0.0


def _aggregate_metric(results: SimulationResults, metric: str) -> float:
    """Extract an aggregate metric value from a node's ``SimulationResults``."""
    if metric == "success_probability":
        return float(results.success_probability)
    if metric == "avg_revenue":
        return float(results.avg_revenue)
    if metric == "avg_market_share":
        return float(results.avg_market_share)
    return 0.0


def run_composite(
    composite: CompositeConfig,
    num_runs: Optional[int] = None,
    base_seed: Optional[int] = None,
) -> Dict[str, Any]:
    """Execute a composite and return the contract response dict (sans summary).

    The LLM narrative ``summary`` is filled in by ``narrate_composite`` (an async
    single LLM call with a deterministic template fallback) by the caller.
    """
    if not composite.nodes:
        raise CompositeValidationError("Composite has no nodes.")

    order = validate_dag(composite)

    n = num_runs or composite.num_runs or DEFAULT_NUM_RUNS
    n = max(MIN_NUM_RUNS, min(MAX_NUM_RUNS, int(n)))
    if base_seed is None:
        base_seed = random.randrange(2 ** 32)

    node_by_id = {nd.node_id: nd for nd in composite.nodes}
    engines = {nid: SimulationEngine(node_by_id[nid].config) for nid in order}
    node_seed = {nid: base_seed + i * _NODE_SEED_STRIDE for i, nid in enumerate(order)}

    # Inbound links grouped by downstream node.
    inbound: Dict[str, List[CompositeLink]] = {nid: [] for nid in order}
    outbound_count: Dict[str, int] = {nid: 0 for nid in order}
    for link in composite.links:
        inbound[link.to_node].append(link)
        outbound_count[link.from_node] += 1

    # Per-node aggregate results + per-path raw outputs (for downstream per-path
    # injection). Filled in topo order so every upstream node is ready first.
    node_results: Dict[str, SimulationResults] = {}
    node_paths: Dict[str, List[Dict[str, Any]]] = {}
    # mean injected value per link (for links_applied reporting).
    link_injected_sum: Dict[int, float] = {}
    link_injected_count: Dict[int, int] = {}

    for nid in order:
        engine = engines[nid]
        seed = node_seed[nid]
        links_in = inbound[nid]

        # Pre-pass: aggregate (mean-passed) overrides, constant across all paths.
        aggregate_overrides: Dict[str, float] = {}
        for link in links_in:
            if link.is_per_path:
                continue
            upstream_res = node_results.get(link.from_node)
            if upstream_res is None:
                continue
            raw = _aggregate_metric(upstream_res, link.from_metric)
            injected = apply_transform(raw, link, node_by_id[nid].config)
            aggregate_overrides[link.to_variable] = injected
            link_injected_sum[id(link)] = injected
            link_injected_count[id(link)] = 1

        per_path_links = [link for link in links_in if link.is_per_path]
        path_outputs: List[Dict[str, Any]] = []

        for i in range(n):
            overrides: Dict[str, float] = dict(aggregate_overrides)
            for link in per_path_links:
                upstream_paths = node_paths.get(link.from_node)
                if not upstream_paths:
                    continue
                raw = _per_path_metric(upstream_paths[i], link.from_metric)
                injected = apply_transform(raw, link, node_by_id[nid].config)
                overrides[link.to_variable] = injected
                link_injected_sum[id(link)] = link_injected_sum.get(id(link), 0.0) + injected
                link_injected_count[id(link)] = link_injected_count.get(id(link), 0) + 1
            path_outputs.append(
                engine.run_single_path(i, seed, overrides or None)
            )

        node_paths[nid] = path_outputs
        node_results[nid] = engine.aggregate_paths(path_outputs, seed)

    # Terminal/sink node = the node with no outbound links; if several, the last
    # one in topo order.
    sinks = [nid for nid in order if outbound_count[nid] == 0]
    terminal = sinks[-1] if sinks else order[-1]

    nodes_payload = [
        {
            "node_id": nid,
            "label": node_by_id[nid].label,
            "category": node_by_id[nid].config.category.value,
            "results": node_results[nid].model_dump(mode="json"),
        }
        for nid in order
    ]

    links_applied = []
    for link in composite.links:
        count = link_injected_count.get(id(link), 0)
        mean_injected = (
            link_injected_sum.get(id(link), 0.0) / count if count else 0.0
        )
        links_applied.append({
            "from_node": link.from_node,
            "from_metric": link.from_metric,
            "to_node": link.to_node,
            "to_variable": link.to_variable,
            "transform": link.transform,
            "mean_injected_value": round(mean_injected, 6),
        })

    terminal_res = node_results[terminal]
    composite_outcome = {
        "terminal_node": terminal,
        "success_probability": terminal_res.success_probability,
        "avg_revenue": terminal_res.avg_revenue,
    }

    contribution = _contribution_notes(
        order, node_by_id, node_results, inbound, terminal
    )

    return {
        "order": order,
        "base_seed": base_seed,
        "nodes": nodes_payload,
        "links_applied": links_applied,
        "composite_outcome": composite_outcome,
        "contribution": contribution,
        "summary": _fallback_summary(
            composite, order, node_by_id, node_results, links_applied, terminal
        ),
    }


def _contribution_notes(
    order: List[str],
    node_by_id: Dict[str, CompositeNode],
    node_results: Dict[str, SimulationResults],
    inbound: Dict[str, List[CompositeLink]],
    terminal: str,
) -> List[Dict[str, str]]:
    """Short, deterministic per-domain contribution notes."""
    notes = []
    for nid in order:
        node = node_by_id[nid]
        res = node_results[nid]
        feeders = sorted({link.from_node for link in inbound[nid]})
        role = "terminal outcome" if nid == terminal else "upstream driver"
        if feeders:
            fed = ", ".join(feeders)
            note = (
                f"{node.label} ({node.config.category.value}, {role}) consumed "
                f"signals from {fed} and reached "
                f"{res.success_probability:.0f}% success."
            )
        else:
            note = (
                f"{node.label} ({node.config.category.value}, {role}) is a source "
                f"node with {res.success_probability:.0f}% success and "
                f"{res.avg_revenue:,.0f} avg outcome, feeding downstream domains."
            )
        notes.append({"node_id": nid, "label": node.label, "note": note})
    return notes


def _fallback_summary(
    composite: CompositeConfig,
    order: List[str],
    node_by_id: Dict[str, CompositeNode],
    node_results: Dict[str, SimulationResults],
    links_applied: List[Dict[str, Any]],
    terminal: str,
) -> str:
    """Deterministic one-paragraph narrative (used when the LLM is unavailable)."""
    chain = " -> ".join(node_by_id[nid].label for nid in order)
    term = node_by_id[terminal]
    term_res = node_results[terminal]
    link_clause = ""
    if links_applied:
        first = links_applied[0]
        link_clause = (
            f" The {first['from_node']} {first['from_metric']} fed the "
            f"{first['to_node']} {first['to_variable']} (mean injected "
            f"{first['mean_injected_value']:g}),"
            f" with {len(links_applied)} cross-domain link(s) in total,"
        )
    return (
        f"Composite '{composite.name}' chained {len(order)} domains "
        f"({chain}).{link_clause} propagating uncertainty path-by-path so each "
        f"domain's run informed the next. The terminal {term.label} domain "
        f"settled at {term_res.success_probability:.0f}% success and "
        f"{term_res.avg_revenue:,.0f} average outcome."
    )


_NARRATIVE_SYSTEM = (
    "You summarize a cross-domain composite simulation in ONE tight paragraph. "
    "Explain how each domain's results fed the next via the metric->variable "
    "links, and what the terminal domain's headline outcome means. Be concrete "
    "and quantitative; do not invent numbers beyond those provided."
)


async def narrate_composite(response: Dict[str, Any], composite_name: str) -> str:
    """One LLM call to narrate how the domains fed each other.

    Falls back to the deterministic template ``summary`` already on ``response``
    if the LLM is unavailable. Never raises.
    """
    fallback = response.get("summary", "")
    try:
        nodes_brief = [
            {
                "node_id": nd["node_id"],
                "label": nd["label"],
                "category": nd["category"],
                "success_probability": nd["results"].get("success_probability"),
                "avg_revenue": nd["results"].get("avg_revenue"),
            }
            for nd in response.get("nodes", [])
        ]
        resp = await llm_client.chat(
            messages=[{
                "role": "user",
                "content": (
                    f"Composite simulation: {composite_name}\n"
                    f"Execution order: {response.get('order')}\n"
                    f"Domains: {nodes_brief}\n"
                    f"Cross-domain links: {response.get('links_applied')}\n"
                    f"Terminal outcome: {response.get('composite_outcome')}\n\n"
                    "Write ONE paragraph on how the domains fed each other."
                ),
            }],
            system=_NARRATIVE_SYSTEM,
            temperature=0.5,
            max_tokens=320,
        )
        if resp.text.strip():
            return resp.text.strip()
    except Exception as exc:
        logger.warning("Composite narrative generation failed: %s", exc)
    return fallback
