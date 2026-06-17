"""
Lightweight Bayesian-flavored calibration for simulation variables.

This is a HONEST, lightweight moment-matching Bayesian update — NOT full MCMC
or a proper hierarchical model. For each (observed column -> variable) pairing
we treat the variable's current config value as a Gaussian PRIOR mean and form
a Gaussian LIKELIHOOD from the observed series' mean/std/n. The posterior is the
classic conjugate-normal (precision-weighted) combination of prior and
likelihood. No sampling is performed; everything is closed-form. We lean on
``scipy.stats.norm`` for the standard-error / coverage diagnostics that feed the
calibration score and on ``numpy`` for the series summaries.

Why this is defensible but limited:
  * Conjugate normal update is exact when both prior and likelihood are
    Gaussian — a reasonable first-order approximation for a scalar parameter.
  * It uses ONLY the observed series' first two moments (mean, std), hence
    "moment matching". It does NOT model the simulation's forward map from
    parameter -> output, so the observed series is treated as a direct, noisy
    observation of the parameter itself. Callers should read posteriors as a
    "nudge toward the data", not a rigorously identified estimate.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import numpy as np
from scipy import stats

# The prior std is taken as a fraction of the prior mean (a deliberately BROAD
# prior so the data is allowed to move the estimate). When the prior mean is ~0
# we fall back to a small absolute floor so precision stays finite.
_PRIOR_REL_STD = 0.5          # prior std = 50% of |prior mean|
_PRIOR_ABS_FLOOR = 1.0        # minimum prior std (absolute)
_OBS_STD_FLOOR = 1e-9         # guard against a zero-variance observed series
# A single observation / constant series can't claim near-zero uncertainty:
# floor the likelihood spread to this fraction of the prior spread.
_MIN_LIKE_STD_FRAC = 0.15


@dataclass
class CalibratedVariable:
    """One variable's calibration result (serialises to the API shape)."""
    variable_name: str
    label: str
    prior_value: float
    posterior_value: float
    posterior_std: float
    shift_pct: float
    observed_summary: Dict[str, float]

    def to_dict(self) -> Dict[str, object]:
        return {
            "variable_name": self.variable_name,
            "label": self.label,
            "prior_value": self.prior_value,
            "posterior_value": self.posterior_value,
            "posterior_std": self.posterior_std,
            "shift_pct": self.shift_pct,
            "observed_summary": self.observed_summary,
        }


def _prior_std(prior_mean: float) -> float:
    """Broad prior std as a fraction of |prior mean|, floored to stay finite."""
    return max(abs(prior_mean) * _PRIOR_REL_STD, _PRIOR_ABS_FLOOR)


def _conjugate_normal_update(
    prior_mean: float,
    prior_std: float,
    obs_mean: float,
    obs_std: float,
    n: int,
) -> Tuple[float, float]:
    """Closed-form conjugate-normal posterior for an unknown mean.

    Treat the variable as an unknown scalar with a Gaussian prior
    N(prior_mean, prior_std^2). The observed series gives a likelihood for that
    same scalar with standard error obs_std / sqrt(n) (the standard error of the
    sample mean). The posterior precision is the sum of prior and likelihood
    precisions; the posterior mean is the precision-weighted average.

    Returns (posterior_mean, posterior_std).
    """
    # Standard error of the observed sample mean — the likelihood's spread.
    # The standard error of a SINGLE observation (or a constant/zero-variance
    # series) is not ~0: one data point cannot claim near-infinite certainty.
    # Floor the likelihood spread to a fraction of the prior spread so a
    # degenerate series can still move the estimate but never collapses the
    # posterior to zero uncertainty.
    raw_like_std = max(obs_std, _OBS_STD_FLOOR) / math.sqrt(max(n, 1))
    min_like_std = prior_std * _MIN_LIKE_STD_FRAC
    like_std = max(raw_like_std, min_like_std)

    prior_prec = 1.0 / (prior_std ** 2)
    like_prec = 1.0 / (like_std ** 2)

    post_prec = prior_prec + like_prec
    post_mean = (prior_prec * prior_mean + like_prec * obs_mean) / post_prec
    # Keep a small positive floor so the UI never shows literal "0 uncertainty".
    post_std = max(math.sqrt(1.0 / post_prec), prior_std * 1e-3)
    return post_mean, post_std


def _normalize(name: str) -> str:
    """Case/whitespace/separator-insensitive key for fuzzy column<->var match."""
    return "".join(ch for ch in name.lower() if ch.isalnum())


def resolve_mapping(
    config_variable_names: List[str],
    observed: Dict[str, List[float]],
    mapping: Optional[Dict[str, str]] = None,
) -> Tuple[Dict[str, str], List[str]]:
    """Resolve which observed column maps to which variable.

    Returns (resolved, unmatched) where ``resolved`` maps observed column ->
    variable name, and ``unmatched`` lists observed columns with no variable.

    Explicit *mapping* entries (column -> variable) take precedence and are only
    kept when the named variable actually exists. Remaining columns are matched
    case-insensitively against variable names (exact normalized match).
    """
    valid = set(config_variable_names)
    norm_to_var = {_normalize(v): v for v in config_variable_names}

    resolved: Dict[str, str] = {}
    unmatched: List[str] = []
    claimed: set = set()  # a variable may be calibrated by at most one column

    explicit = mapping or {}
    for col in observed:
        var: Optional[str] = None
        if col in explicit and explicit[col] in valid:
            var = explicit[col]
        else:
            # Fuzzy: normalized exact match on the variable name.
            var = norm_to_var.get(_normalize(col))
        # Enforce 1:1 — a second column claiming an already-mapped variable is
        # left unmatched rather than silently producing a duplicate posterior.
        if var is not None and var not in claimed:
            resolved[col] = var
            claimed.add(var)
        else:
            unmatched.append(col)

    return resolved, unmatched


def _calibration_score(results: List[CalibratedVariable]) -> float:
    """Aggregate 0-100 score for how well the data CONSTRAINED the parameters.

    Honest, documented formula. For each calibrated variable we form a
    per-parameter "tightness" in [0, 1]:

        tightness = 1 - clamp(posterior_std / prior_std, 0, 1)

    A posterior whose std collapsed far below the (broad) prior std scores near
    1 — the data was informative. A posterior that barely moved off the prior
    spread scores near 0 — the data added little. We use ``scipy.stats.norm`` to
    weight each tightness by an AGREEMENT factor: how plausible the observed
    sample mean is under the prior (a 2-sided tail probability via the prior
    CDF). Data that lands in the bulk of the prior (consistent) is trusted more
    than data in the extreme tail (which may be a mapping/units mismatch).

        agreement = 2 * (1 - prior_cdf(|z|))   in (0, 1], z = (obs-prior)/prior_std

    The score is the mean over parameters of ``tightness`` blended 70/30 with
    ``tightness * agreement``, scaled to 0-100. With no parameters the score is
    0. The result is clamped to [0, 100].
    """
    if not results:
        return 0.0

    per_param = []
    for r in results:
        prior_std = _prior_std(r.prior_value)
        # Tightness: how much the posterior shrank below the prior spread.
        ratio = r.posterior_std / prior_std if prior_std > 0 else 1.0
        tightness = 1.0 - min(max(ratio, 0.0), 1.0)

        # Agreement: 2-sided prior-tail plausibility of the observed mean.
        obs_mean = r.observed_summary.get("mean", r.prior_value)
        z = abs(obs_mean - r.prior_value) / prior_std if prior_std > 0 else 0.0
        agreement = float(2.0 * (1.0 - stats.norm.cdf(z)))  # in (0, 1]

        blended = 0.7 * tightness + 0.3 * (tightness * agreement)
        per_param.append(blended)

    score = float(np.mean(per_param)) * 100.0
    return round(min(max(score, 0.0), 100.0), 2)


def calibrate(
    config_variables: List[dict],
    observed: Dict[str, List[float]],
    mapping: Optional[Dict[str, str]] = None,
) -> Tuple[List[CalibratedVariable], float, List[str]]:
    """Calibrate simulation variables against observed historical series.

    PURE function — no I/O, no LLM. Given the config's variables (each a dict
    with at least ``name``, ``label``, ``value``), a dict of observed series,
    and an optional column->variable mapping, returns:

        (calibrated, calibration_score, unmatched_columns)

    where ``calibrated`` is a list of :class:`CalibratedVariable`. Each mappable
    column produces a conjugate-normal posterior centred between the prior
    (config value) and the observed mean (precision-weighted). This is a
    lightweight moment-matching Bayesian update, documented as such in the
    module docstring — it is NOT MCMC and does NOT invert the simulation's
    forward map.

    The observed series MUST already be validated as numeric & non-empty by the
    caller; this function assumes clean float lists.
    """
    var_by_name = {v["name"]: v for v in config_variables}
    resolved, unmatched = resolve_mapping(list(var_by_name), observed, mapping)

    calibrated: List[CalibratedVariable] = []
    for col, var_name in resolved.items():
        var = var_by_name[var_name]
        series = np.asarray(observed[col], dtype=float)
        n = int(series.size)
        obs_mean = float(np.mean(series))
        # Population std (ddof=0) is fine; floored below to avoid zero variance.
        obs_std = float(np.std(series, ddof=0))

        prior_mean = float(var["value"])
        prior_std = _prior_std(prior_mean)

        post_mean, post_std = _conjugate_normal_update(
            prior_mean, prior_std, obs_mean, obs_std, n
        )

        if prior_mean != 0.0:
            shift_pct = (post_mean - prior_mean) / prior_mean * 100.0
        else:
            # Undefined as a percentage of zero — report absolute-ish 0/inf
            # avoided by reporting 0 when there is no movement, else 100*sign.
            shift_pct = 0.0 if post_mean == 0.0 else math.copysign(100.0, post_mean)

        calibrated.append(CalibratedVariable(
            variable_name=var_name,
            label=str(var.get("label", var_name)),
            prior_value=round(prior_mean, 6),
            posterior_value=round(post_mean, 6),
            posterior_std=round(post_std, 6),
            shift_pct=round(shift_pct, 4),
            observed_summary={
                "mean": round(obs_mean, 6),
                "std": round(obs_std, 6),
                "n": n,
            },
        ))

    # Stable order: by variable name for deterministic responses/tests.
    calibrated.sort(key=lambda c: c.variable_name)
    score = _calibration_score(calibrated)
    return calibrated, score, unmatched
