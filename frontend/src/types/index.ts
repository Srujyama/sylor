export type SimulationStatus = "draft" | "running" | "completed" | "failed";
export type AgentType = "customer" | "competitor" | "regulator" | "investor" | "market" | "trader" | "market_maker" | "molecule" | "enzyme" | "data_stream";
export type SimulationCategory = "startup" | "pricing" | "policy" | "marketing" | "product" | "finance" | "biology" | "trend" | "custom";

export interface SimulationVariable {
  id: string;
  name: string;
  label: string;
  type: "number" | "percentage" | "currency" | "boolean" | "select";
  value: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  unit?: string;
}

export interface AgentConfig {
  id: string;
  type: AgentType;
  name: string;
  description: string;
  count: number;
  behaviorRules: string[];
  sensitivity: number; // 0-1 how reactive to market changes
}

export interface SimulationConfig {
  name: string;
  description: string;
  category: SimulationCategory;
  variables: SimulationVariable[];
  agents: AgentConfig[];
  numRuns: number; // 100-10000
  timeHorizon: number; // months
  templateId?: string;
  uploadedData?: Record<string, number[]>; // column name → values
  companyContext?: Record<string, any>; // user's real scenario context
}

export interface SimulationRun {
  runNumber: number;
  success: boolean;
  finalMetrics: Record<string, number>;
  timeline: TimelinePoint[];
}

export interface TimelinePoint {
  month: number;
  marketShare: number;
  revenue: number;
  customerCount: number;
  competitorStrength: number;
  events: string[];
}

export interface SimulationResults {
  successProbability: number;
  confidenceInterval: [number, number];
  avgRevenue: number;
  avgMarketShare: number;
  avgTimeToBreakeven: number;
  riskFactors: RiskFactor[];
  keyInsights: string[];
  outcomeDistribution: OutcomeDistribution[];
  timelineAggregated: AggregatedTimeline[];
  competitorReactions: string[];
  topScenario: SimulationRun;
  worstScenario: SimulationRun;
}

export interface RiskFactor {
  name: string;
  severity: "low" | "medium" | "high" | "critical";
  probability: number;
  description: string;
  mitigation: string;
}

export interface OutcomeDistribution {
  range: string;
  probability: number;
  count: number;
}

export interface AggregatedTimeline {
  month: number;
  avgRevenue: number;
  p10Revenue: number;
  p90Revenue: number;
  avgMarketShare: number;
  avgCustomers: number;
}

export interface Simulation {
  id: string;
  userId: string;
  name: string;
  description: string;
  category: SimulationCategory;
  config: SimulationConfig;
  status: SimulationStatus;
  results?: SimulationResults;
  createdAt: string;
  updatedAt: string;
  runCount: number;
  // Scenario-tree fields (Wave F). A root sim has parent_id === null and
  // root_id === its own id; branches inherit root_id and point at their parent.
  parent_id?: string | null;
  root_id?: string;
  branch_label?: string | null;
}

export interface Template {
  id: string;
  name: string;
  category: SimulationCategory;
  description: string;
  icon: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  config: Partial<SimulationConfig>;
  tags: string[];
}

// Template shape as returned by GET /api/templates (snake_case config)
export interface ApiTemplate {
  id: string;
  name: string;
  category: SimulationCategory;
  description: string;
  icon: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  tags: string[];
  config: {
    num_runs: number;
    time_horizon: number;
    variables: Array<{
      name: string;
      label: string;
      type: string;
      value: number;
      min: number;
      max: number;
      unit: string;
    }>;
    agents: Array<{
      type: string;
      name: string;
      count: number;
      sensitivity: number;
    }>;
  };
}

// Response from GET /api/users/me/usage
export interface UserUsage {
  total_simulations: number;
  completed_simulations: number;
  total_runs: number;
  avg_success_rate: number;
  categories_used: string[];
  last_active: string | null;
}

export interface User {
  id: string;
  email: string;
  fullName?: string;
  avatarUrl?: string;
  plan: "free" | "pro" | "enterprise";
  simulationCount: number;
}

export interface DomainMetadata {
  primary_metric_label: string;
  primary_metric_unit: string;
  secondary_metric_label: string;
  tertiary_metric_label: string;
  time_unit: string;
}

// --- Company Context for AI-powered simulation setup ---

export interface BusinessContext {
  companyName: string;
  industry: string;
  businessModel: string;
  stage: string;
  currentMrr: string;
  monthlyBurn: string;
  runwayMonths: string;
  teamSize: string;
  fundingRaised: string;
  customerCount: string;
  targetMarketSize: string;
  competitors: string;
  differentiator: string;
  geoMarket: string;
  pricingModel: string;
  currentPrice: string;
  acquisitionChannels: string[];
}

export interface FinanceContext {
  investmentType: string;
  startingCapital: string;
  investmentHorizon: string;
  riskProfile: string;
  targetAssets: string;
  portfolioComposition: string;
  marketCondition: string;
  incomeRequirements: string;
}

export interface BiologyContext {
  researchGoal: string;
  targetMolecule: string;
  bindingPartners: string;
  temperatureRange: string;
  phRange: string;
  solvent: string;
  experimentalData: string;
  desiredOutcome: string;
}

export interface TrendContext {
  dataDomain: string;
  historicalPeriod: string;
  forecastHorizon: string;
  seasonalPatterns: string;
  externalFactors: string;
  dataFrequency: string;
}

export type CompanyContext = BusinessContext | FinanceContext | BiologyContext | TrendContext;

export interface AIAnalysisResponse {
  variables: Array<{
    name: string;
    label: string;
    value: number;
    min: number;
    max: number;
    unit: string;
    reasoning: string;
  }>;
  agents: Array<{
    type: string;
    label: string;
    count: number;
    sensitivity: number;
    reasoning: string;
  }>;
  assumptions: string[];
  successCriteria: string;
  timeHorizon: number;
  numRuns: number;
}

// --- Knowledge Graph Types (MiroFish-inspired) ---

export type ProjectStatus =
  | "created"
  | "documents_uploaded"
  | "graph_building"
  | "graph_ready"
  | "profiles_generated"
  | "simulation_ready"
  | "running"
  | "completed"
  | "failed";

export interface Project {
  project_id: string;
  name: string;
  status: ProjectStatus;
  simulation_category: SimulationCategory;
  documents: DocumentInfo[];
  text_stats: TextStats | null;
  graph_id: string | null;
  ontology: Ontology | null;
  agent_profiles_count: number;
  simulation_id: string | null;
  simulation_results_available: boolean;
  report_id: string | null;
  created_at: string;
  updated_at: string;
  error: string | null;
}

export interface DocumentInfo {
  filename: string;
  size: number;
  text_length: number;
  stats: {
    words: number;
    sentences: number;
    language: string;
  };
}

export interface TextStats {
  total_chars: number;
  total_words: number;
  estimated_tokens: number;
}

export interface Ontology {
  entity_types: EntityTypeDefinition[];
  edge_types: EdgeTypeDefinition[];
  domain: string;
}

export interface EntityTypeDefinition {
  name: string;
  description: string;
  attributes: string[];
}

export interface EdgeTypeDefinition {
  name: string;
  description: string;
  source_types: string[];
  target_types: string[];
}

// --- Knowledge Graph Entity Types ---

export interface EntityNode {
  uuid: string;
  name: string;
  entity_type: string;
  summary: string;
  attributes: Record<string, any>;
  related_edges: EntityEdge[];
  related_nodes: RelatedNode[];
  relevance_score: number;
}

export interface EntityEdge {
  uuid: string;
  source_uuid: string;
  target_uuid: string;
  relation_type: string;
  description: string;
  weight: number;
  is_temporal: boolean;
  valid_from: string | null;
  valid_to: string | null;
}

export interface RelatedNode {
  uuid: string;
  name: string;
  type: string;
  relation: string;
}

export interface GraphStatistics {
  graph_id: string;
  name: string;
  status: string;
  total_nodes: number;
  total_edges: number;
  entity_types: Record<string, number>;
  edge_types: Record<string, number>;
  created_at: string;
}

// --- Agent Profile Types (MiroFish-inspired) ---

export interface AgentProfile {
  agent_id: string;
  name: string;
  agent_type: string;
  entity_name: string | null;
  description: string;
  personality: string;
  goals: string[];
  background: string;
  decision_style: "aggressive" | "conservative" | "balanced" | "reactive";
  sensitivity: number;
  activity_level: number;
  influence_weight: number;
  sentiment_bias: number;
  risk_tolerance: number;
  behavior_rules: string[];
  interaction_patterns: string[];
  memory: string[];
  source: "generated" | "graph_entity" | "template" | "rule_based";
  entity_uuid: string | null;
}

// --- Report Types (MiroFish-inspired ReACT reports) ---

export interface Report {
  report_id: string;
  simulation_id: string;
  title: string;
  summary: string;
  sections: ReportSection[];
  full_markdown: string;
  created_at: string;
  status: "pending" | "planning" | "generating" | "completed" | "failed";
  metadata: Record<string, any>;
}

export interface ReportSection {
  index: number;
  title: string;
  content: string;
  status: "pending" | "generating" | "completed" | "failed";
}

export interface ReportProgress {
  report_id: string;
  status: string;
  current_section: number;
  total_sections: number;
  percent: number;
  message: string;
  sections_completed: number[];
}

// Response from POST /api/projects/{project_id}/run-simulation
export interface RunProjectSimulationResponse {
  task_id: string;
  simulation_id: string;
  status: "running";
  message: string;
}

// Response from POST /api/reports/generate (async generation)
export interface GenerateReportResponse {
  report_id: string;
  status: string;
  progress_url: string;
  report_url: string;
  message?: string;
}

// --- Task Types (background job tracking) ---

export interface TaskStatus {
  task_id: string;
  task_type: string;
  status: "pending" | "processing" | "completed" | "failed";
  progress: number;
  message: string;
  result: Record<string, any> | null;
  error: string | null;
  created_at: string;
}

// --- Sensitivity Analysis (tornado) ---

// Response from POST /api/simulations/{sim_id}/tornado
// bars sorted by impact desc; success values are 0-1 fractions
export interface TornadoBar {
  variable: string;
  label: string;
  low_value: number;
  high_value: number;
  low_success: number; // 0-1 fraction
  high_success: number; // 0-1 fraction
  impact: number;
}

export interface TornadoResponse {
  base_seed: number;
  baseline: { success_probability: number; avg_revenue: number }; // 0-1 fraction
  bars: TornadoBar[];
}

// --- Natural-language What-If ---

export interface WhatIfMetrics {
  success_probability: number;
  avg_revenue: number;
  avg_time_to_breakeven: number;
}

// Response from POST /api/simulations/{sim_id}/whatif
export interface WhatIfResponse {
  parsed: {
    variable_overrides: Record<string, number>;
    unparseable_parts: string[];
  };
  baseline: WhatIfMetrics;
  whatif: WhatIfMetrics;
  deltas: {
    success_probability_pp: number;
    avg_revenue: number;
    avg_time_to_breakeven: number;
  };
  verdict: string;
}

// --- Counterfactual Diff (Wave J) ---

// One metric snapshot returned by the diff endpoint (both baseline + counterfactual)
export interface DiffMetrics {
  success_probability: number;
  avg_revenue: number;
  avg_market_share: number;
  avg_time_to_breakeven: number;
}

// One risk factor that newly appeared or dropped out between the two result sets
export interface DiffRiskChange {
  name: string;
  severity: string;
}

// Response from POST /api/simulations/{sim_id}/diff — paired runs with the same
// base_seed, direct variable overrides (NOT a NL prompt).
export interface DiffResponse {
  base_seed: number;
  baseline: DiffMetrics;
  counterfactual: DiffMetrics;
  deltas: {
    success_probability_pp: number;
    avg_revenue: number;
    avg_market_share: number;
    avg_time_to_breakeven: number;
  };
  timeline_delta: Array<{
    month: number;
    baseline_revenue: number;
    counterfactual_revenue: number;
    delta: number;
  }>;
  risk_changes: {
    appeared: DiffRiskChange[];
    disappeared: DiffRiskChange[];
  };
  explanation: string;
}

// --- Per-Run Explainer (Wave J) ---

export type ExplainPercentile = "p10" | "p50" | "p90";

// One pivotal agent action that drove the explained path's outcome
export interface PivotalEvent {
  t: number;
  agent_type: string;
  action: string;
  value: number;
  why: string;
}

// Response from GET /api/simulations/{sim_id}/explain?percentile=...
export interface ExplainResponse {
  percentile: string;
  seed_used: number;
  outcome: {
    success: boolean;
    final_revenue: number;
  };
  pivotal_events: PivotalEvent[];
  narrative: string;
}

// --- Narrative Dashboard Digest (Wave J) ---

export type DigestItemType = "completed" | "delta" | "stale";

export interface DigestItem {
  type: DigestItemType;
  text: string;
  sim_id?: string;
}

// Response from POST /api/insights/digest — cheap aggregation + one headline LLM call
export interface DashboardDigest {
  headline: string;
  items: DigestItem[];
}

// --- Sharing ---

// Response from POST /api/simulations/{sim_id}/share
export interface ShareResponse {
  share_id: string;
  path: string; // "/s/{share_id}"
}

// Response from GET /api/shared/{share_id} (public, frozen snapshot)
export interface SharedSnapshot {
  share_id: string;
  name: string;
  category: string;
  created_at: string;
  success_probability: number;
  confidence_interval: [number, number];
  avg_revenue: number;
  outcome_distribution: OutcomeDistribution[];
  timeline: Array<{
    month: number;
    avgRevenue: number;
    p10Revenue: number;
    p90Revenue: number;
  }>;
  key_insights: string[];
  domain_metadata: Record<string, any> | null;
}

// --- Run History ---

// Entry from GET /api/simulations/{sim_id}/runs (newest first)
export interface RunHistoryEntry {
  run_id: string;
  created_at: string;
  num_runs: number;
  success_probability: number;
  avg_revenue: number;
  variable_overrides: Record<string, number> | null;
}

// --- Analytics ---

// Response from GET /api/analytics/summary
export interface AnalyticsSummary {
  totals: {
    simulations: number;
    completed: number;
    total_runs: number;
    avg_success_rate: number;
  };
  by_category: Array<{ category: string; count: number; avg_success: number }>;
  success_trend: Array<{ date: string; avg_success: number; count: number }>; // last 30 days
  recent: Array<{
    id: string;
    name: string;
    category: string;
    status: string;
    success_probability: number | null;
    updated_at: string;
  }>;
}

// Response from GET /api/public/stats (public, anonymized)
export interface PublicStats {
  total_simulations: number;
  total_runs: number;
  sims_this_week: number;
  recent: Array<{ category: string; success_probability: number; minutes_ago: number }>;
}

// --- Decision Memo ---

export type MemoAudience = "exec" | "technical";

// Response from POST /api/reports/memo (persists as a normal report doc with
// metadata.type="memo"; pollable via the existing report progress endpoints).
export interface GenerateMemoResponse {
  report_id: string;
  status: "generating";
  progress_url: string;
  report_url: string;
}

// --- Scenario Tree (branching simulations) ---

// One node in the scenario family returned by GET /api/simulations/{sim_id}/tree
export interface ScenarioNode {
  id: string;
  name: string;
  parent_id: string | null;
  branch_label: string | null;
  status: SimulationStatus;
  success_probability: number | null;
  created_at: string;
}

// Response from GET /api/simulations/{sim_id}/tree — every sim sharing this root_id
export interface ScenarioTree {
  root_id: string;
  nodes: ScenarioNode[];
}

// Response from POST /api/simulations/{sim_id}/branch
export interface BranchSimulationResponse {
  simulation_id: string;
}

// --- Live Simulation Theater (Wave H) ---

// One agent action recorded during the captured replay path
export interface ReplayEvent {
  agent_id: string;
  agent_type: string;
  action: string;
  value: number;
  note?: string;
}

// One time step of the captured replay path
export interface ReplayTick {
  t: number;
  events: ReplayEvent[];
  metrics: {
    revenue: number;
    customers: number;
    market_share: number;
  };
}

// Response from GET /api/simulations/{sim_id}/replay — one representative
// deterministic path re-run with the sim's stored base_seed.
export interface ReplayData {
  base_seed: number;
  time_unit: string;
  agents: Array<{ id: string; type: string; name: string }>;
  ticks: ReplayTick[];
}

// Response from GET /api/simulations/{sim_id}/transcript — persona-voiced narrative
export interface AgentTranscript {
  transcript: Array<{ t: number; narrative: string }>;
  summary: string;
}

// --- Zero-Signup Demo (Wave H) ---

export type DemoPreset = "saas" | "pricing" | "portfolio";

// Response from POST /api/demo/run (PUBLIC) — real results without persistence
export interface DemoRunResponse {
  results: any; // SimulationResults-shaped (same shape GET /results returns under .results)
  config: Record<string, any>;
  demo_id: string;
}

// What we stash in localStorage under 'sylor-demo' so a fresh signup can claim it
export interface StoredDemo {
  demo_id: string;
  config: Record<string, any>;
  results: any;
}

// --- AI Copilot (Wave H) ---

export type CopilotActionType = "sweep" | "branch" | "whatif" | "compare";

export interface CopilotAction {
  variable_name?: string;
  min_value?: number;
  max_value?: number;
  variable_overrides?: Record<string, number>;
  prompt?: string;
}

// One suggestion from POST /api/simulations/{sim_id}/copilot (3-5 returned)
export interface CopilotSuggestion {
  type: CopilotActionType;
  title: string;
  rationale: string;
  action: CopilotAction;
}

// Response from POST /api/simulations/{sim_id}/copilot
export interface CopilotResponse {
  suggestions: CopilotSuggestion[];
}

// --- Bayesian Calibration (Wave L) ---

// One fitted parameter from POST /api/simulations/{sim_id}/calibrate. The
// posterior is a precision-weighted (conjugate normal) blend of the variable's
// current value (prior) and the observed series — NOT full MCMC.
export interface CalibratedParam {
  variable_name: string;
  label: string;
  prior_value: number;     // the variable's current config value
  posterior_value: number; // the fitted value
  posterior_std: number;   // uncertainty on the fit
  shift_pct: number;        // (posterior - prior) / prior * 100
  observed_summary: { mean: number; std: number; n: number };
}

// Response from POST /api/simulations/{sim_id}/calibrate
export interface CalibrationResult {
  calibrated: CalibratedParam[];
  calibration_score: number;     // 0-100, how well observed data constrained params
  unmatched_columns: string[];   // observed columns that couldn't map to a variable
  method: string;                // human label, e.g. "moment-matching + grid posterior"
  summary: string;               // one-paragraph plain-English summary
}

// --- Causal Graph + Do-Operator (Wave L) ---

// One node in the causal DAG returned by GET /api/graphs/{graph_id}/causal
export interface CausalNode {
  uuid: string;
  name: string;
  entity_type: string;
}

// One directed causal edge; sign is derived from the relation_type
export interface CausalEdge {
  source_uuid: string;
  target_uuid: string;
  relation_type: string;
  weight: number;
  sign: "positive" | "negative";
}

// Response from GET /api/graphs/{graph_id}/causal — causal relation types only,
// cycles detected (and broken for the DAG layering)
export interface CausalGraph {
  nodes: CausalNode[];
  edges: CausalEdge[];
  has_cycles: boolean;
  cycle_note?: string; // present if cycles were detected + broken
}

// One downstream node affected by a do() intervention
export interface InterventionEffect {
  uuid: string;
  name: string;
  entity_type: string;
  predicted_change: number; // -1..1
  path_length: number;
}

// Response from POST /api/graphs/{graph_id}/intervene — a Pearl-style do() on the
// causal DAG; qualitative/directional, not point estimates
export interface InterventionResult {
  intervened_node: { uuid: string; name: string };
  effects: InterventionEffect[]; // sorted by abs(predicted_change) desc
  note: string;                  // honest framing
}
