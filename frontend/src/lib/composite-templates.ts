/**
 * Minimal default sub-sim configs for the composite builder.
 *
 * Each entry seeds a pragmatic, runnable config (a few variables + a couple
 * agents) in the SAME snake_case shape POST /api/simulations accepts under
 * `.config`. The composite stores a full sub-sim config per node, so these
 * give the user a sensible starting point per category and populate the
 * link `to_variable` selects with meaningful variable names.
 */

import type { SimulationCategory } from "@/types";

export const COMPOSITE_CATEGORIES: Array<{
  value: SimulationCategory;
  label: string;
  blurb: string;
}> = [
  { value: "startup", label: "startup", blurb: "go-to-market, growth, churn" },
  { value: "finance", label: "finance", blurb: "portfolio returns, volatility" },
  { value: "biology", label: "biology", blurb: "binding affinity, yield" },
  { value: "trend", label: "trend", blurb: "demand forecast, seasonality" },
];

// Color per category — reused by the DAG view (consistent w/ on-brand accents).
export const CATEGORY_COLOR: Record<string, string> = {
  startup: "#60a5fa",  // blue
  finance: "#22c55e",  // green
  biology: "#a78bfa",  // violet
  trend: "#f59e0b",    // amber
  pricing: "#60a5fa",
  policy: "#60a5fa",
  marketing: "#60a5fa",
  product: "#60a5fa",
  custom: "#9ca3af",
};

export interface DefaultVariable {
  id: string;
  name: string;
  label: string;
  type: "number";
  value: number;
  min: number;
  max: number;
  unit: string;
}

export interface DefaultAgent {
  id: string;
  type: string;
  name: string;
  count: number;
  sensitivity: number;
  behavior_rules: string[];
}

export interface DefaultSubConfig {
  name: string;
  description: string;
  category: SimulationCategory;
  variables: DefaultVariable[];
  agents: DefaultAgent[];
  num_runs: number;
  time_horizon: number;
}

const v = (
  name: string,
  label: string,
  value: number,
  min: number,
  max: number,
  unit: string
): DefaultVariable => ({
  id: `var-${name}`,
  name,
  label,
  type: "number",
  value,
  min,
  max,
  unit,
});

const a = (
  type: string,
  name: string,
  count: number,
  sensitivity: number
): DefaultAgent => ({
  id: `agent-${type}`,
  type,
  name,
  count,
  sensitivity,
  behavior_rules: [],
});

const TEMPLATES: Record<string, Omit<DefaultSubConfig, "name">> = {
  startup: {
    description: "go-to-market dynamics: acquisition, pricing, churn",
    category: "startup",
    variables: [
      v("price", "monthly price", 99, 10, 500, "$"),
      v("cac", "customer acquisition cost", 250, 20, 2000, "$"),
      v("churn_rate", "monthly churn", 5, 0, 30, "%"),
      v("market_size", "addressable market", 50000, 1000, 5000000, ""),
    ],
    agents: [
      a("customer", "customers", 1000, 0.6),
      a("competitor", "competitors", 3, 0.5),
    ],
    num_runs: 1000,
    time_horizon: 18,
  },
  finance: {
    description: "portfolio returns under volatility & drawdown",
    category: "finance",
    variables: [
      v("starting_capital", "starting capital", 100000, 1000, 10000000, "$"),
      v("expected_return", "annual return", 8, -20, 40, "%"),
      v("volatility", "annual volatility", 15, 1, 80, "%"),
      v("allocation", "risk allocation", 60, 0, 100, "%"),
    ],
    agents: [
      a("trader", "traders", 50, 0.7),
      a("market_maker", "market makers", 5, 0.4),
    ],
    num_runs: 1000,
    time_horizon: 24,
  },
  biology: {
    description: "binding affinity & yield across conditions",
    category: "biology",
    variables: [
      v("binding_affinity", "binding affinity", 50, 0, 100, "%"),
      v("temperature", "temperature", 37, 4, 95, "°C"),
      v("ph", "pH", 7, 1, 14, ""),
      v("concentration", "substrate concentration", 50, 1, 500, "µM"),
    ],
    agents: [
      a("molecule", "molecules", 500, 0.6),
      a("enzyme", "enzymes", 20, 0.5),
    ],
    num_runs: 1000,
    time_horizon: 12,
  },
  trend: {
    description: "demand forecast with seasonality & external shocks",
    category: "trend",
    variables: [
      v("baseline_demand", "baseline demand", 1000, 10, 1000000, ""),
      v("growth_rate", "monthly growth", 3, -20, 40, "%"),
      v("seasonality", "seasonal amplitude", 15, 0, 80, "%"),
      v("external_shock", "external shock sensitivity", 30, 0, 100, "%"),
    ],
    agents: [
      a("data_stream", "data streams", 12, 0.6),
      a("market", "market", 1, 0.5),
    ],
    num_runs: 1000,
    time_horizon: 24,
  },
};

// Build a fresh minimal config for a category, with a node-specific label.
export function defaultConfigForCategory(
  category: SimulationCategory,
  label: string
): DefaultSubConfig {
  const base = TEMPLATES[category] || TEMPLATES.startup;
  // deep-ish clone so callers can mutate variable values independently
  return {
    name: label,
    description: base.description,
    category: base.category,
    variables: base.variables.map((x) => ({ ...x })),
    agents: base.agents.map((x) => ({ ...x })),
    num_runs: base.num_runs,
    time_horizon: base.time_horizon,
  };
}

// Pull the variable .name list out of any stored/seeded sub-sim config —
// used to populate the link `to_variable` select for a downstream node.
export function variableNamesOf(config: Record<string, any> | undefined): string[] {
  if (!config) return [];
  const vars = config.variables;
  if (!Array.isArray(vars)) return [];
  return vars
    .map((x: any) => (typeof x?.name === "string" ? x.name : null))
    .filter((x: string | null): x is string => Boolean(x));
}

// Human labels for the from_metric select. final_*/success_rate are per-path.
export const FROM_METRICS: Array<{
  value: string;
  label: string;
  perPath: boolean;
}> = [
  { value: "success_probability", label: "success probability", perPath: false },
  { value: "avg_revenue", label: "avg revenue", perPath: false },
  { value: "avg_market_share", label: "avg market share", perPath: false },
  { value: "final_revenue", label: "final revenue (per-path)", perPath: true },
  { value: "final_market_share", label: "final market share (per-path)", perPath: true },
  { value: "success_rate", label: "success outcome (per-path)", perPath: true },
];

export const TRANSFORMS: Array<{ value: string; label: string }> = [
  { value: "linear", label: "linear (×factor)" },
  { value: "scale", label: "scale (×factor)" },
  { value: "normalize", label: "normalize (clamp to range)" },
  { value: "direct", label: "direct (unchanged)" },
];
