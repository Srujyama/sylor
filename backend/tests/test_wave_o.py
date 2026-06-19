"""
Wave O tests: multi-objective Pareto optimizer.

Covers:
  - latin_hypercube: draws ``budget`` points within each variable's [min, max]
    and is deterministic under a fixed seed.
  - pareto_frontier: known dominating points; maximize vs minimize flips dominance.
  - knee_point: picks a balanced frontier point; None on empty frontier.
  - Endpoint: contract shape, 422 (no objectives / bad metric / bad direction /
    no searchable vars / budget out of range), 404 missing, 403 cross-user,
    on_frontier consistent with frontier, shared base_seed reproducible.

Firebase is mocked via the shared ``mock_firebase`` fixture. Budget/runs are kept
tiny (8-12 candidates, 20 runs) so the real seeded engine runs fast.
"""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import optimizer
from app.models.simulation import SimulationVariable

AUTH_HEADER = {"Authorization": "Bearer valid-token"}    # uid test-user-123
USER2_HEADER = {"Authorization": "Bearer user2-token"}   # uid user-2


# ---------------------------------------------------------------------------
# Pure helpers: latin_hypercube
# ---------------------------------------------------------------------------

def _vars():
    return [
        SimulationVariable(name="price", label="Price", value=99, min=10, max=200, type="currency"),
        SimulationVariable(name="conv", label="Conversion", value=5, min=1, max=20, type="percentage"),
    ]


class TestLatinHypercube:
    def test_draws_budget_points_within_bounds(self):
        vars_ = _vars()
        budget = 12
        candidates = optimizer.latin_hypercube(vars_, budget, seed=42)
        assert len(candidates) == budget
        for c in candidates:
            assert set(c.keys()) == {"price", "conv"}
            assert 10 <= c["price"] <= 200
            assert 1 <= c["conv"] <= 20

    def test_deterministic_under_fixed_seed(self):
        vars_ = _vars()
        a = optimizer.latin_hypercube(vars_, 10, seed=7)
        b = optimizer.latin_hypercube(vars_, 10, seed=7)
        assert a == b

    def test_different_seed_differs(self):
        vars_ = _vars()
        a = optimizer.latin_hypercube(vars_, 10, seed=1)
        b = optimizer.latin_hypercube(vars_, 10, seed=2)
        assert a != b

    def test_empty_vars_returns_empty(self):
        assert optimizer.latin_hypercube([], 10, seed=1) == []


# ---------------------------------------------------------------------------
# Pure helpers: pareto_frontier
# ---------------------------------------------------------------------------

def _cand(cid, **metrics):
    base = {"success_probability": 0.0, "avg_revenue": 0.0,
            "avg_market_share": 0.0, "avg_breakeven_month": 0.0}
    base.update(metrics)
    return {"id": cid, "metrics": base}


class TestParetoFrontier:
    def test_known_dominating_point(self):
        # c0 dominates c1 on both maximize objectives.
        c0 = _cand(0, success_probability=90, avg_revenue=1000)
        c1 = _cand(1, success_probability=50, avg_revenue=500)
        objectives = [
            {"metric": "success_probability", "direction": "maximize"},
            {"metric": "avg_revenue", "direction": "maximize"},
        ]
        frontier = optimizer.pareto_frontier([c0, c1], objectives)
        assert frontier == {0}

    def test_tradeoff_both_on_frontier(self):
        # c0 better on revenue, c1 better on success -> both non-dominated.
        c0 = _cand(0, success_probability=50, avg_revenue=1000)
        c1 = _cand(1, success_probability=90, avg_revenue=500)
        objectives = [
            {"metric": "success_probability", "direction": "maximize"},
            {"metric": "avg_revenue", "direction": "maximize"},
        ]
        frontier = optimizer.pareto_frontier([c0, c1], objectives)
        assert frontier == {0, 1}

    def test_minimize_flips_dominance(self):
        # For breakeven month, smaller is better. c1 has lower breakeven so it
        # dominates c0 when minimizing (the reverse of maximize).
        c0 = _cand(0, avg_breakeven_month=12)
        c1 = _cand(1, avg_breakeven_month=6)
        max_obj = [{"metric": "avg_breakeven_month", "direction": "maximize"}]
        min_obj = [{"metric": "avg_breakeven_month", "direction": "minimize"}]
        assert optimizer.pareto_frontier([c0, c1], max_obj) == {0}
        assert optimizer.pareto_frontier([c0, c1], min_obj) == {1}


# ---------------------------------------------------------------------------
# Pure helpers: knee_point
# ---------------------------------------------------------------------------

class TestKneePoint:
    def test_empty_frontier_returns_none(self):
        assert optimizer.knee_point([], [{"metric": "avg_revenue", "direction": "maximize"}]) is None

    def test_picks_balanced_point(self):
        # Two extremes + one balanced. Balanced point is closest to the ideal.
        extreme_a = _cand(0, success_probability=100, avg_revenue=0)
        extreme_b = _cand(1, success_probability=0, avg_revenue=100)
        balanced = _cand(2, success_probability=70, avg_revenue=70)
        objectives = [
            {"metric": "success_probability", "direction": "maximize"},
            {"metric": "avg_revenue", "direction": "maximize"},
        ]
        knee = optimizer.knee_point([extreme_a, extreme_b, balanced], objectives)
        assert knee == 2

    def test_single_point_returns_it(self):
        c = _cand(5, success_probability=42, avg_revenue=1)
        objectives = [{"metric": "success_probability", "direction": "maximize"}]
        assert optimizer.knee_point([c], objectives) == 5

    def test_non_empty_frontier_always_returns_member(self):
        """Even if a metric is non-finite (e.g. a degenerate breakeven), a
        non-empty frontier must yield a knee that IS a frontier member, never
        None (regression for the NaN-poisons-knee finding)."""
        c0 = _cand(0, avg_breakeven_month=float("nan"))
        c1 = _cand(1, avg_breakeven_month=float("nan"))
        objectives = [{"metric": "avg_breakeven_month", "direction": "minimize"}]
        knee = optimizer.knee_point([c0, c1], objectives)
        assert knee in {0, 1}


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

def _create_sim_payload():
    return {
        "config": {
            "name": "Optimize Test Sim",
            "category": "startup",
            "variables": [
                {"name": "price_per_unit", "label": "Price", "value": 99,
                 "type": "currency", "min": 50, "max": 200},
                {"name": "conversion_rate", "label": "Conversion", "value": 5,
                 "type": "percentage", "min": 1, "max": 15},
                # No bounds -> not searchable.
                {"name": "market_size", "label": "Market", "value": 1000000, "type": "number"},
            ],
            "agents": [
                {"type": "customer", "name": "Users", "count": 100, "sensitivity": 0.7},
                {"type": "market", "name": "Market", "count": 1, "sensitivity": 0.6},
            ],
            "num_runs": 20,
            "time_horizon": 6,
        },
        "user_id": "test-user-123",
    }


def _no_bounds_sim_payload():
    p = _create_sim_payload()
    for v in p["config"]["variables"]:
        v.pop("min", None)
        v.pop("max", None)
    return p


def _insert_sim(mock_firebase, sim_data, sim_id):
    store_data = dict(sim_data)
    store_data.pop("id", None)
    mock_firebase[f"simulations/{sim_id}"] = store_data


def _make_sim(client, mock_firebase, payload=None):
    payload = payload or _create_sim_payload()
    res = client.post("/api/simulations", json=payload, headers=AUTH_HEADER)
    assert res.status_code == 201
    sim_id = res.json()["id"]
    _insert_sim(mock_firebase, res.json(), sim_id)
    return sim_id


_OBJECTIVES = [
    {"metric": "success_probability", "direction": "maximize"},
    {"metric": "avg_breakeven_month", "direction": "minimize"},
]


class TestOptimizeEndpoint:
    def test_contract_shape(self, mock_firebase):
        client = TestClient(app)
        sim_id = _make_sim(client, mock_firebase)
        res = client.post(
            f"/api/simulations/{sim_id}/optimize",
            json={"objectives": _OBJECTIVES, "budget": 10, "runs_per_candidate": 20},
            headers=AUTH_HEADER,
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert isinstance(body["base_seed"], int)
        assert body["evaluated"] == 10
        assert len(body["candidates"]) == 10
        # searched_variables = the two bounded numeric vars only.
        names = {v["name"] for v in body["searched_variables"]}
        assert names == {"price_per_unit", "conversion_rate"}
        for v in body["searched_variables"]:
            assert set(v.keys()) == {"name", "label", "min", "max"}
        assert body["objectives"] == _OBJECTIVES
        for c in body["candidates"]:
            assert set(c.keys()) == {"id", "overrides", "metrics", "on_frontier"}
            assert set(c["metrics"].keys()) == {
                "success_probability", "avg_revenue",
                "avg_market_share", "avg_breakeven_month",
            }
            assert set(c["overrides"].keys()) == {"price_per_unit", "conversion_rate"}
        assert isinstance(body["frontier"], list)
        assert body["knee_point"] is None or isinstance(body["knee_point"], int)

    def test_on_frontier_consistent_with_frontier(self, mock_firebase):
        client = TestClient(app)
        sim_id = _make_sim(client, mock_firebase)
        res = client.post(
            f"/api/simulations/{sim_id}/optimize",
            json={"objectives": _OBJECTIVES, "budget": 10, "runs_per_candidate": 20},
            headers=AUTH_HEADER,
        )
        body = res.json()
        frontier_set = set(body["frontier"])
        flagged = {c["id"] for c in body["candidates"] if c["on_frontier"]}
        assert frontier_set == flagged
        # knee point must be on the frontier (when present).
        if body["knee_point"] is not None:
            assert body["knee_point"] in frontier_set
        # frontier non-empty for a real run.
        assert len(frontier_set) >= 1

    def test_shared_base_seed_reproducible(self, mock_firebase):
        client = TestClient(app)
        sim_id = _make_sim(client, mock_firebase)
        # Pre-seed a recorded base_seed so both calls reuse it.
        mock_firebase[f"simulations/{sim_id}"]["results"] = {"base_seed": 123456}
        payload = {"objectives": _OBJECTIVES, "budget": 10, "runs_per_candidate": 20}
        r1 = client.post(f"/api/simulations/{sim_id}/optimize", json=payload, headers=AUTH_HEADER)
        r2 = client.post(f"/api/simulations/{sim_id}/optimize", json=payload, headers=AUTH_HEADER)
        b1, b2 = r1.json(), r2.json()
        assert b1["base_seed"] == 123456 == b2["base_seed"]
        assert b1["candidates"] == b2["candidates"]
        assert b1["frontier"] == b2["frontier"]
        assert b1["knee_point"] == b2["knee_point"]

    def test_default_variables_uses_all_bounded(self, mock_firebase):
        client = TestClient(app)
        sim_id = _make_sim(client, mock_firebase)
        res = client.post(
            f"/api/simulations/{sim_id}/optimize",
            json={"objectives": _OBJECTIVES, "budget": 10, "runs_per_candidate": 20},
            headers=AUTH_HEADER,
        )
        names = {v["name"] for v in res.json()["searched_variables"]}
        assert names == {"price_per_unit", "conversion_rate"}

    def test_explicit_variable_subset(self, mock_firebase):
        client = TestClient(app)
        sim_id = _make_sim(client, mock_firebase)
        res = client.post(
            f"/api/simulations/{sim_id}/optimize",
            json={"objectives": _OBJECTIVES, "variables": ["price_per_unit"],
                  "budget": 10, "runs_per_candidate": 20},
            headers=AUTH_HEADER,
        )
        assert res.status_code == 200
        names = {v["name"] for v in res.json()["searched_variables"]}
        assert names == {"price_per_unit"}

    # ── 422 cases ──────────────────────────────────────────────────────
    def test_no_objectives_422(self, mock_firebase):
        client = TestClient(app)
        sim_id = _make_sim(client, mock_firebase)
        res = client.post(
            f"/api/simulations/{sim_id}/optimize",
            json={"objectives": [], "budget": 10, "runs_per_candidate": 20},
            headers=AUTH_HEADER,
        )
        assert res.status_code == 422

    def test_bad_metric_422(self, mock_firebase):
        client = TestClient(app)
        sim_id = _make_sim(client, mock_firebase)
        res = client.post(
            f"/api/simulations/{sim_id}/optimize",
            json={"objectives": [{"metric": "bogus", "direction": "maximize"}],
                  "budget": 10, "runs_per_candidate": 20},
            headers=AUTH_HEADER,
        )
        assert res.status_code == 422

    def test_bad_direction_422(self, mock_firebase):
        client = TestClient(app)
        sim_id = _make_sim(client, mock_firebase)
        res = client.post(
            f"/api/simulations/{sim_id}/optimize",
            json={"objectives": [{"metric": "avg_revenue", "direction": "sideways"}],
                  "budget": 10, "runs_per_candidate": 20},
            headers=AUTH_HEADER,
        )
        assert res.status_code == 422

    def test_no_searchable_vars_422(self, mock_firebase):
        client = TestClient(app)
        sim_id = _make_sim(client, mock_firebase, _no_bounds_sim_payload())
        res = client.post(
            f"/api/simulations/{sim_id}/optimize",
            json={"objectives": _OBJECTIVES, "budget": 10, "runs_per_candidate": 20},
            headers=AUTH_HEADER,
        )
        assert res.status_code == 422

    def test_budget_out_of_range_422(self, mock_firebase):
        client = TestClient(app)
        sim_id = _make_sim(client, mock_firebase)
        # below min (10)
        res = client.post(
            f"/api/simulations/{sim_id}/optimize",
            json={"objectives": _OBJECTIVES, "budget": 2, "runs_per_candidate": 20},
            headers=AUTH_HEADER,
        )
        assert res.status_code == 422
        # above max (200)
        res = client.post(
            f"/api/simulations/{sim_id}/optimize",
            json={"objectives": _OBJECTIVES, "budget": 999, "runs_per_candidate": 20},
            headers=AUTH_HEADER,
        )
        assert res.status_code == 422

    def test_runs_out_of_range_422(self, mock_firebase):
        client = TestClient(app)
        sim_id = _make_sim(client, mock_firebase)
        res = client.post(
            f"/api/simulations/{sim_id}/optimize",
            json={"objectives": _OBJECTIVES, "budget": 10, "runs_per_candidate": 5},
            headers=AUTH_HEADER,
        )
        assert res.status_code == 422

    # ── 404 / 403 ──────────────────────────────────────────────────────
    def test_missing_sim_404(self, mock_firebase):
        client = TestClient(app)
        res = client.post(
            "/api/simulations/does-not-exist/optimize",
            json={"objectives": _OBJECTIVES, "budget": 10, "runs_per_candidate": 20},
            headers=AUTH_HEADER,
        )
        assert res.status_code == 404

    def test_cross_user_403(self, mock_firebase):
        client = TestClient(app)
        sim_id = _make_sim(client, mock_firebase)
        res = client.post(
            f"/api/simulations/{sim_id}/optimize",
            json={"objectives": _OBJECTIVES, "budget": 10, "runs_per_candidate": 20},
            headers=USER2_HEADER,
        )
        assert res.status_code == 403
