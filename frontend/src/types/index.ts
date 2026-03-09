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
