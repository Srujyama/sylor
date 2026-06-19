"""
Multi-objective Pareto optimizer (pure helpers).

This module provides the math behind the ``/api/simulations/{sim_id}/optimize``
endpoint. It is intentionally side-effect-free and engine-agnostic: it draws a
budgeted set of candidate configurations, and given the metrics those candidates
produced, computes the Pareto-non-dominated set and a knee point.

Honest framing
--------------
This is an APPROXIMATION of the true Pareto frontier, not an exact solver:

  * Candidates come from a budgeted Latin-Hypercube sample of the search box
    (``budget`` points), so the frontier we report is the best subset of a
    finite sample — the true continuous frontier may lie beyond it.
  * Each candidate is evaluated with a LOW number of Monte Carlo runs
    (``runs_per_candidate``), so its metrics carry Monte-Carlo noise. Sharing a
    single ``base_seed`` across all candidates makes comparisons fair (common
    random numbers), but the absolute metrics remain noisy estimates.

Use the result to shortlist promising configurations, then validate the knee
point / frontier members with a full-resolution run.
"""
from __future__ import annotations

import math
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set

from scipy.stats.qmc import LatinHypercube


# Objective metrics the optimizer understands. These mirror the numeric fields
# on ``SimulationResults`` that the engine produces for every run.
VALID_OBJECTIVE_METRICS = (
    "success_probability",
    "avg_revenue",
    "avg_market_share",
    "avg_breakeven_month",
)

# Optimization directions for an objective.
VALID_DIRECTIONS = ("maximize", "minimize")


def latin_hypercube(
    searchable_vars: Sequence[Any],
    budget: int,
    seed: int,
) -> List[Dict[str, float]]:
    """Draw ``budget`` candidate override dicts via seeded Latin-Hypercube sampling.

    ``searchable_vars`` is a sequence of objects each exposing ``.name``, ``.min``
    and ``.max`` (e.g. ``SimulationVariable``). Every var MUST have both bounds —
    callers are expected to filter beforehand.

    A ``scipy.stats.qmc.LatinHypercube`` (seeded for determinism) draws ``budget``
    points in the unit cube of dimension ``len(searchable_vars)``; each dimension
    is then affinely scaled from ``[0, 1]`` to that variable's ``[min, max]``.

    Returns a list of ``{var_name: value}`` dicts (one per candidate). Determinism:
    the same ``(searchable_vars bounds, budget, seed)`` always yields the same
    candidates.
    """
    names = [v.name for v in searchable_vars]
    lows = [float(v.min) for v in searchable_vars]
    highs = [float(v.max) for v in searchable_vars]
    dim = len(names)
    if dim == 0:
        return []

    sampler = LatinHypercube(d=dim, seed=seed)
    unit = sampler.random(n=budget)  # shape (budget, dim), values in [0, 1)

    candidates: List[Dict[str, float]] = []
    for row in unit:
        override: Dict[str, float] = {}
        for j, name in enumerate(names):
            lo, hi = lows[j], highs[j]
            override[name] = lo + float(row[j]) * (hi - lo)
        candidates.append(override)
    return candidates


def _objective_value(metrics: Dict[str, float], metric: str) -> float:
    """Pull a metric from a candidate's metrics dict (0.0 when missing)."""
    return float(metrics.get(metric, 0.0))


def _at_least_as_good(a: float, b: float, direction: str) -> bool:
    """Is value ``a`` at least as good as ``b`` for ``direction``?"""
    if direction == "minimize":
        return a <= b
    return a >= b


def _strictly_better(a: float, b: float, direction: str) -> bool:
    """Is value ``a`` strictly better than ``b`` for ``direction``?"""
    if direction == "minimize":
        return a < b
    return a > b


def _dominates(
    a_metrics: Dict[str, float],
    b_metrics: Dict[str, float],
    objectives: Sequence[Dict[str, str]],
) -> bool:
    """Direction-aware Pareto dominance: does A dominate B?

    A dominates B iff A is at least as good as B on EVERY objective and strictly
    better on AT LEAST ONE.
    """
    at_least_as_good_all = True
    strictly_better_any = False
    for obj in objectives:
        metric = obj["metric"]
        direction = obj["direction"]
        av = _objective_value(a_metrics, metric)
        bv = _objective_value(b_metrics, metric)
        if not _at_least_as_good(av, bv, direction):
            at_least_as_good_all = False
            break
        if _strictly_better(av, bv, direction):
            strictly_better_any = True
    return at_least_as_good_all and strictly_better_any


def pareto_frontier(
    candidates: Sequence[Dict[str, Any]],
    objectives: Sequence[Dict[str, str]],
) -> Set[int]:
    """Return the set of candidate ids that are Pareto-non-dominated.

    ``candidates`` is a sequence of dicts each with an ``id`` (number) and a
    ``metrics`` dict. ``objectives`` is a sequence of ``{metric, direction}``.
    Dominance is direction-aware (see :func:`_dominates`): a maximize objective
    prefers larger values, a minimize objective prefers smaller values.

    A candidate is on the frontier iff no OTHER candidate dominates it.
    """
    frontier: Set[int] = set()
    for cand in candidates:
        dominated = False
        for other in candidates:
            if other is cand:
                continue
            if _dominates(other["metrics"], cand["metrics"], objectives):
                dominated = True
                break
        if not dominated:
            frontier.add(int(cand["id"]))
    return frontier


def knee_point(
    frontier: Sequence[Dict[str, Any]],
    objectives: Sequence[Dict[str, str]],
) -> Optional[int]:
    """Pick the best-balanced frontier candidate (closest-to-ideal), or None.

    ``frontier`` is the list of frontier candidate dicts (id + metrics). Each
    objective is normalized to ``[0, 1]`` across the frontier in a DIRECTION-AWARE
    way, so 1.0 always means "best on this objective" (for maximize, the largest
    raw value maps to 1; for minimize, the smallest raw value maps to 1). When an
    objective has zero spread across the frontier it contributes 1.0 for every
    point (no discriminating power).

    The knee point is the frontier candidate with the smallest Euclidean distance
    to the all-ones ideal in this normalized space. Returns its id, or ``None``
    when the frontier is empty.
    """
    pts = list(frontier)
    if not pts:
        return None

    # Per-objective min/max across the frontier for normalization.
    ranges: List[tuple] = []
    for obj in objectives:
        metric = obj["metric"]
        vals = [_objective_value(p["metrics"], metric) for p in pts]
        ranges.append((min(vals), max(vals)))

    # Default to the first frontier member so a non-empty frontier ALWAYS yields
    # a knee point (the contract guarantees membership); the loop only improves
    # on it. This also makes the function robust to any non-finite distance.
    best_id: int = int(pts[0]["id"])
    best_dist = math.inf
    for p in pts:
        sq = 0.0
        for obj, (lo, hi) in zip(objectives, ranges):
            metric = obj["metric"]
            direction = obj["direction"]
            raw = _objective_value(p["metrics"], metric)
            span = hi - lo
            if span == 0:
                norm = 1.0  # no spread => non-discriminating, treat as best
            else:
                frac = (raw - lo) / span  # 0..1 where 1 = largest raw value
                norm = frac if direction == "maximize" else 1.0 - frac
            # Distance to the ideal (1.0) on this normalized axis.
            sq += (1.0 - norm) ** 2
        dist = math.sqrt(sq)
        if math.isfinite(dist) and dist < best_dist:
            best_dist = dist
            best_id = int(p["id"])
    return best_id
