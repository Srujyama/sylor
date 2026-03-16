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
