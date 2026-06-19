/**
 * Sylor API Client
 * Centralized API layer with retry, timeout, and error handling
 */

import { getApiUrl } from "./utils";
import { auth } from "./firebase/client";
import type {
  RunProjectSimulationResponse, GenerateReportResponse,
  TornadoResponse, WhatIfResponse, ShareResponse, SharedSnapshot,
  RunHistoryEntry, AnalyticsSummary, PublicStats,
  GenerateMemoResponse, MemoAudience, ScenarioTree, BranchSimulationResponse,
  ReplayData, AgentTranscript, DemoPreset, DemoRunResponse, CopilotResponse,
  DiffResponse, ExplainResponse, ExplainPercentile, DashboardDigest,
  CalibrationResult, CausalGraph, InterventionResult,
  CompositeConfig, CompositeListItem, CompositeDetail, CompositeRunResult,
  OptimizeObjective, OptimizeResult,
  HeroRunResult,
  ApiSimulation, Simulation, SimulationResults,
} from "@/types";

interface FetchOptions extends RequestInit {
  retries?: number;
  retryDelay?: number;
  timeout?: number;
  skipAuth?: boolean;
}

class ApiError extends Error {
  status: number;
  data: any;
  constructor(message: string, status: number, data?: any) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

/**
 * Get the current user's Firebase ID token for API authentication.
 * Returns null if no user is signed in.
 */
async function getAuthToken(): Promise<string | null> {
  const user = auth?.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken();
  } catch {
    return null;
  }
}

async function fetchWithRetry(
  url: string,
  options: FetchOptions = {}
): Promise<Response> {
  // Mutating methods default to 0 retries to avoid double-creates on timeout.
  // GETs keep 2 retries. Callers can still override per-call via options.retries.
  const method = (options.method || "GET").toUpperCase();
  const isMutating = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
  const {
    retries = isMutating ? 0 : 2,
    retryDelay = 1500,
    timeout = 60000,
    skipAuth = false,
    ...fetchOpts
  } = options;

  // FormData bodies must NOT get a Content-Type header — the browser sets
  // multipart/form-data with the boundary itself.
  const isFormData =
    typeof FormData !== "undefined" && fetchOpts.body instanceof FormData;

  // Attach Firebase auth token to every API request
  const authHeaders: Record<string, string> = {};
  if (!skipAuth) {
    const token = await getAuthToken();
    if (token) {
      authHeaders["Authorization"] = `Bearer ${token}`;
    }
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(url, {
        ...fetchOpts,
        signal: controller.signal,
        headers: {
          ...(isFormData ? {} : { "Content-Type": "application/json" }),
          ...authHeaders,
          ...fetchOpts.headers,
        },
      });
      clearTimeout(timer);

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new ApiError(
          data?.detail || `HTTP ${res.status}`,
          res.status,
          data
        );
      }

      return res;
    } catch (err: any) {
      clearTimeout(timer);

      // Don't retry client errors (4xx)
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
        throw err;
      }

      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, retryDelay * (attempt + 1)));
        continue;
      }

      if (err.name === "AbortError") {
        throw new ApiError(
          "The request took too long. The server may be starting up — please try again.",
          408
        );
      }

      if (err.message?.includes("Failed to fetch") || err.message?.includes("NetworkError") || err.message?.includes("network")) {
        throw new ApiError(
          "Could not reach the server. Check your connection or try again in a moment.",
          0
        );
      }

      throw err instanceof ApiError
        ? err
        : new ApiError(err.message || "Network error", 0);
    }
  }

  throw new ApiError("Max retries exceeded. Please try again.", 0);
}

// ─── Simulations ──────────────────────────────────────────

/**
 * Normalize the API's snake_case simulation shape into the camelCase Simulation
 * used across the UI. Single source of truth for the snake→camel mapping that was
 * previously duplicated in dashboard, simulations list, and the command palette.
 */
export function mapSimulation(s: ApiSimulation): Simulation {
  const r = s.results;
  const results: SimulationResults | undefined = r
    ? ({
        successProbability: r.success_probability,
        confidenceInterval: r.confidence_interval,
        avgRevenue: r.avg_revenue,
        avgMarketShare: r.avg_market_share,
        avgTimeToBreakeven: r.avg_breakeven_month,
        riskFactors: r.risk_factors,
        keyInsights: r.key_insights,
        outcomeDistribution: r.outcome_distribution,
        timelineAggregated: r.timeline_aggregated,
        competitorReactions: r.competitor_reactions,
      } as SimulationResults)
    : undefined;
  return {
    id: s.id,
    userId: s.user_id,
    name: s.name,
    description: s.description,
    category: s.category,
    config: s.config,
    status: s.status,
    results,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
    runCount: s.run_count,
    parent_id: s.parent_id,
    root_id: s.root_id,
    branch_label: s.branch_label,
  };
}

// The owner scope is enforced server-side via the auth token; the userId arg is
// kept for call-site clarity but no longer sent as a query param.
export async function listSimulations(_userId?: string): Promise<ApiSimulation[]> {
  const res = await fetchWithRetry(`${getApiUrl()}/api/simulations`);
  return res.json();
}

export async function getSimulation(simId: string): Promise<ApiSimulation> {
  const res = await fetchWithRetry(
    `${getApiUrl()}/api/simulations/${simId}`
  );
  return res.json();
}

export async function createSimulation(data: any) {
  const res = await fetchWithRetry(`${getApiUrl()}/api/simulations`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function runSimulation(
  simId: string,
  opts?: { num_runs?: number; variable_overrides?: Record<string, number> }
) {
  const res = await fetchWithRetry(
    `${getApiUrl()}/api/simulations/${simId}/run`,
    {
      method: "POST",
      body: JSON.stringify(opts || {}),
    }
  );
  return res.json();
}

export async function getResults(simId: string) {
  const res = await fetchWithRetry(
    `${getApiUrl()}/api/simulations/${simId}/results`
  );
  return res.json();
}

export async function duplicateSimulation(simId: string) {
  const res = await fetchWithRetry(
    `${getApiUrl()}/api/simulations/${simId}/duplicate`,
    { method: "POST" }
  );
  return res.json();
}

export async function deleteSimulation(simId: string) {
  const res = await fetchWithRetry(
    `${getApiUrl()}/api/simulations/${simId}`,
    { method: "DELETE" }
  );
  return res.json();
}

export async function sweepVariable(
  simId: string,
  data: { variable_name: string; min_value: number; max_value: number; steps?: number; num_runs?: number }
) {
  const res = await fetchWithRetry(
    `${getApiUrl()}/api/simulations/${simId}/sweep`,
    {
      method: "POST",
      body: JSON.stringify(data),
      timeout: 300000,
      retries: 0,
    }
  );
  return res.json();
}

// ─── Scenario Tree (branching simulations) ────────────────

// Creates a child sim (parent_id=simId, root_id inherited) from variable
// overrides, run as a tracked background task; poll GET .../results like any run.
export async function branchSimulation(
  simId: string,
  data: { variable_overrides: Record<string, number>; label?: string; num_runs?: number }
): Promise<BranchSimulationResponse> {
  const res = await fetchWithRetry(
    `${getApiUrl()}/api/simulations/${simId}/branch`,
    {
      method: "POST",
      body: JSON.stringify(data),
      timeout: 120000,
      retries: 0, // don't retry — avoid double-creating branches
    }
  );
  return res.json();
}

// Every sim sharing this sim's root_id (owner-scoped).
export async function getScenarioTree(simId: string): Promise<ScenarioTree> {
  const res = await fetchWithRetry(
    `${getApiUrl()}/api/simulations/${simId}/tree`
  );
  return res.json();
}

// ─── SSE Streaming ───────────────────────────────────────

export interface SimulationProgress {
  percent: number;
  completed: number;
  total: number;
  phase: "running" | "aggregating" | "ai_insights" | "saving";
}

/**
 * Run a simulation with real-time SSE progress streaming.
 * Falls back to the regular run endpoint if SSE is not supported.
 */
export async function runSimulationStream(
  simId: string,
  opts: { num_runs?: number; variable_overrides?: Record<string, number> } = {},
  callbacks: {
    onProgress?: (progress: SimulationProgress) => void;
    onComplete?: (data: { sim_id: string; success_probability: number }) => void;
    onError?: (error: string) => void;
  } = {}
): Promise<void> {
  const token = await getAuthToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${getApiUrl()}/api/simulations/${simId}/run/stream`, {
    method: "POST",
    headers,
    body: JSON.stringify(opts),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(data?.detail || `HTTP ${res.status}`, res.status, data);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new ApiError("Streaming not supported", 0);
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    let currentEvent = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith("data: ") && currentEvent) {
        try {
          const data = JSON.parse(line.slice(6));
          if (currentEvent === "progress" && callbacks.onProgress) {
            callbacks.onProgress(data);
          } else if (currentEvent === "complete" && callbacks.onComplete) {
            callbacks.onComplete(data);
          } else if (currentEvent === "error" && callbacks.onError) {
            callbacks.onError(data.detail);
          }
        } catch {
          // Ignore malformed JSON
        }
        currentEvent = "";
      }
    }
  }
}

export async function compareSimulations(simulationIds: string[]) {
  const res = await fetchWithRetry(`${getApiUrl()}/api/simulations/compare`, {
    method: "POST",
    body: JSON.stringify({ simulation_ids: simulationIds }),
  });
  return res.json();
}

// ─── Context Analysis ─────────────────────────────────────

export async function analyzeContext(data: any) {
  const res = await fetchWithRetry(`${getApiUrl()}/api/context/analyze`, {
    method: "POST",
    body: JSON.stringify(data),
    timeout: 120000, // AI analysis can take 60-90s on cold start
    retries: 1,
  });
  return res.json();
}

export async function analyzePrompt(prompt: string) {
  const res = await fetchWithRetry(`${getApiUrl()}/api/context/analyze-prompt`, {
    method: "POST",
    body: JSON.stringify({ prompt }),
    timeout: 120000,
    retries: 1,
  });
  return res.json();
}

export async function runSimulationLong(
  simId: string,
  opts?: { num_runs?: number; variable_overrides?: Record<string, number> }
) {
  const res = await fetchWithRetry(
    `${getApiUrl()}/api/simulations/${simId}/run`,
    {
      method: "POST",
      body: JSON.stringify(opts || {}),
      timeout: 120000, // Monte Carlo runs can take a while
      retries: 0,      // Don't retry — avoid double-running
    }
  );
  return res.json();
}

// ─── Templates ────────────────────────────────────────────

export async function listTemplates(category?: string) {
  const params = category ? `?category=${category}` : "";
  const res = await fetchWithRetry(
    `${getApiUrl()}/api/templates${params}`
  );
  return res.json();
}

export async function getTemplate(templateId: string) {
  const res = await fetchWithRetry(
    `${getApiUrl()}/api/templates/${templateId}`
  );
  return res.json();
}

// ─── Upload ───────────────────────────────────────────────

export async function parseUpload(file: File) {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetchWithRetry(`${getApiUrl()}/api/upload/parse`, {
    method: "POST",
    body: formData, // FormData — fetchWithRetry omits Content-Type so the browser sets the boundary
    timeout: 30000,
  });
  return res.json();
}

// ─── Users ────────────────────────────────────────────────

export async function getUserUsage() {
  const res = await fetchWithRetry(`${getApiUrl()}/api/users/me/usage`);
  return res.json();
}

// Exports all of the current user's simulation data as a downloadable Blob.
export async function exportSimulations(format: "json" | "csv"): Promise<Blob> {
  const res = await fetchWithRetry(
    `${getApiUrl()}/api/export/simulations?format=${format}`
  );
  return res.blob();
}

// Permanently deletes the current user's account and all associated data.
export async function deleteCurrentUser(): Promise<void> {
  await fetchWithRetry(`${getApiUrl()}/api/users/me`, { method: "DELETE" });
}

// ─── Projects (MiroFish-inspired unified pipeline) ────────

export async function createProject(name: string, category: string = "startup") {
  const res = await fetchWithRetry(`${getApiUrl()}/api/projects`, {
    method: "POST",
    body: JSON.stringify({ name, category }),
  });
  return res.json();
}

export async function listProjects() {
  const res = await fetchWithRetry(`${getApiUrl()}/api/projects`);
  return res.json();
}

export async function getProject(projectId: string) {
  const res = await fetchWithRetry(`${getApiUrl()}/api/projects/${projectId}`);
  return res.json();
}

export async function deleteProject(projectId: string) {
  await fetchWithRetry(`${getApiUrl()}/api/projects/${projectId}`, {
    method: "DELETE",
  });
}

export async function uploadDocuments(projectId: string, files: File[]) {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));

  const res = await fetchWithRetry(
    `${getApiUrl()}/api/projects/${projectId}/upload`,
    {
      method: "POST",
      body: formData, // FormData — fetchWithRetry omits Content-Type so the browser sets the boundary
      timeout: 60000,
    }
  );
  return res.json();
}

export async function buildKnowledgeGraph(projectId: string) {
  const res = await fetchWithRetry(
    `${getApiUrl()}/api/projects/${projectId}/build-graph`,
    {
      method: "POST",
      timeout: 300000, // Graph building can take several minutes
      retries: 0,
    }
  );
  return res.json();
}

export async function generateProfiles(
  projectId: string,
  opts?: { use_llm?: boolean; max_profiles?: number }
) {
  const res = await fetchWithRetry(
    `${getApiUrl()}/api/projects/${projectId}/generate-profiles`,
    {
      method: "POST",
      body: JSON.stringify(opts || { use_llm: true, max_profiles: 20 }),
      timeout: 180000,
      retries: 0,
    }
  );
  return res.json();
}

export async function getProfiles(projectId: string) {
  const res = await fetchWithRetry(
    `${getApiUrl()}/api/projects/${projectId}/profiles`
  );
  return res.json();
}

export async function generateReport(projectId: string) {
  const res = await fetchWithRetry(
    `${getApiUrl()}/api/projects/${projectId}/generate-report`,
    {
      method: "POST",
      timeout: 300000,
      retries: 0,
    }
  );
  return res.json();
}

export async function chatWithReport(projectId: string, message: string) {
  const res = await fetchWithRetry(
    `${getApiUrl()}/api/projects/${projectId}/chat`,
    {
      method: "POST",
      body: JSON.stringify({ message }),
      timeout: 60000,
    }
  );
  return res.json();
}

export async function runProjectSimulation(
  projectId: string,
  opts?: { num_runs?: number; variable_overrides?: Record<string, number> }
): Promise<RunProjectSimulationResponse> {
  const res = await fetchWithRetry(
    `${getApiUrl()}/api/projects/${projectId}/run-simulation`,
    {
      method: "POST",
      body: JSON.stringify(opts || {}),
      timeout: 120000,
      retries: 0, // don't retry — avoid double-running
    }
  );
  return res.json();
}

export async function getTaskStatus(taskId: string) {
  const res = await fetchWithRetry(
    `${getApiUrl()}/api/projects/tasks/${taskId}`
  );
  return res.json();
}

// ─── Knowledge Graphs ─────────────────────────────────────

export async function listGraphs() {
  const res = await fetchWithRetry(`${getApiUrl()}/api/graphs`);
  return res.json();
}

export async function getGraph(graphId: string) {
  const res = await fetchWithRetry(`${getApiUrl()}/api/graphs/${graphId}`);
  return res.json();
}

export async function getGraphNodes(graphId: string, entityType?: string) {
  const params = entityType ? `?entity_type=${entityType}` : "";
  const res = await fetchWithRetry(
    `${getApiUrl()}/api/graphs/${graphId}/nodes${params}`
  );
  return res.json();
}

export async function getGraphEdges(graphId: string) {
  const res = await fetchWithRetry(
    `${getApiUrl()}/api/graphs/${graphId}/edges`
  );
  return res.json();
}

export async function searchGraph(graphId: string, query: string, limit: number = 10) {
  const res = await fetchWithRetry(
    `${getApiUrl()}/api/graphs/${graphId}/search`,
    {
      method: "POST",
      body: JSON.stringify({ query, limit }),
    }
  );
  return res.json();
}

// ─── Reports ──────────────────────────────────────────────

export async function listReports(simulationId?: string) {
  const params = simulationId ? `?simulation_id=${simulationId}` : "";
  const res = await fetchWithRetry(`${getApiUrl()}/api/reports${params}`);
  return res.json();
}

export async function getReport(reportId: string) {
  const res = await fetchWithRetry(`${getApiUrl()}/api/reports/${reportId}`);
  return res.json();
}

export async function getReportProgress(reportId: string) {
  const res = await fetchWithRetry(
    `${getApiUrl()}/api/reports/${reportId}/progress`
  );
  return res.json();
}

export async function getReportSections(reportId: string) {
  const res = await fetchWithRetry(
    `${getApiUrl()}/api/reports/${reportId}/sections`
  );
  return res.json();
}

export async function generateReportAsync(data: {
  simulation_id: string;
  simulation_data: any;
  category: string;
  graph_id?: string;
}): Promise<GenerateReportResponse> {
  const res = await fetchWithRetry(`${getApiUrl()}/api/reports/generate`, {
    method: "POST",
    body: JSON.stringify(data),
    timeout: 60000,
    retries: 0,
  });
  return res.json();
}

export async function generateReportSync(data: {
  simulation_id: string;
  simulation_data: any;
  category: string;
  graph_id?: string;
}) {
  const res = await fetchWithRetry(
    `${getApiUrl()}/api/reports/generate-sync`,
    {
      method: "POST",
      body: JSON.stringify(data),
      timeout: 300000,
      retries: 0,
    }
  );
  return res.json();
}

export async function chatWithReportDirect(
  reportId: string,
  message: string,
  simulationData?: any
) {
  const res = await fetchWithRetry(`${getApiUrl()}/api/reports/chat`, {
    method: "POST",
    body: JSON.stringify({
      report_id: reportId,
      message,
      simulation_data: simulationData,
    }),
    timeout: 60000,
  });
  return res.json();
}

// ─── Decision Memo ────────────────────────────────────────

// Builds a fixed-section executive memo from a simulation's stored results.
// Persists as a normal report doc (metadata.type="memo") pollable via the
// existing report-progress endpoints and viewable at /reports/{report_id}.
export async function generateMemo(
  simulationId: string,
  audience: MemoAudience = "exec"
): Promise<GenerateMemoResponse> {
  const res = await fetchWithRetry(`${getApiUrl()}/api/reports/memo`, {
    method: "POST",
    body: JSON.stringify({ simulation_id: simulationId, audience }),
    timeout: 120000,
    retries: 0,
  });
  return res.json();
}

// ─── Sensitivity & What-If ────────────────────────────────

export async function runTornado(
  simId: string,
  opts?: { delta_pct?: number; num_runs?: number }
): Promise<TornadoResponse> {
  const res = await fetchWithRetry(
    `${getApiUrl()}/api/simulations/${simId}/tornado`,
    {
      method: "POST",
      body: JSON.stringify(opts || {}),
      timeout: 300000, // 2 runs per variable — can take minutes
      retries: 0,      // don't retry — avoid double-running
    }
  );
  return res.json();
}

export async function runWhatIf(
  simId: string,
  prompt: string
): Promise<WhatIfResponse> {
  const res = await fetchWithRetry(
    `${getApiUrl()}/api/simulations/${simId}/whatif`,
    {
      method: "POST",
      body: JSON.stringify({ prompt }),
      timeout: 300000, // paired base_seed re-run — can take minutes
      retries: 0,      // don't retry — avoid double-running
    }
  );
  return res.json();
}

// ─── Counterfactual Diff & Per-Run Explainer (Wave J) ─────

// Paired runs with the SAME base_seed using DIRECT variable overrides (not a NL
// prompt). Returns per-metric deltas, per-timeline-point revenue deltas, the set
// difference of risk factors, and a plain-English attribution paragraph.
export async function runDiff(
  simId: string,
  variable_overrides: Record<string, number>
): Promise<DiffResponse> {
  const res = await fetchWithRetry(
    `${getApiUrl()}/api/simulations/${simId}/diff`,
    {
      method: "POST",
      body: JSON.stringify({ variable_overrides }),
      timeout: 300000, // paired base_seed re-run — can take minutes
      retries: 0,      // don't retry — avoid double-running
    }
  );
  return res.json();
}

// Replays the path nearest the requested percentile (p10/p50/p90) with the sim's
// base_seed, then narrates WHY that path went the way it did. Expensive (LLM).
export async function explainRun(
  simId: string,
  percentile: ExplainPercentile = "p50"
): Promise<ExplainResponse> {
  const res = await fetchWithRetry(
    `${getApiUrl()}/api/simulations/${simId}/explain?percentile=${percentile}`,
    {
      timeout: 300000, // path scan + replay + LLM narration — can take minutes
      retries: 0,      // don't retry — avoid duplicate LLM calls
    }
  );
  return res.json();
}

// ─── Dashboard Digest (Wave J) ────────────────────────────

// Cheap aggregation of the user's recent sim activity since their last visit,
// turned into a single friendly headline by one LLM call (template fallback).
export async function getDashboardDigest(
  lastSeenAt?: string
): Promise<DashboardDigest> {
  const res = await fetchWithRetry(`${getApiUrl()}/api/insights/digest`, {
    method: "POST",
    body: JSON.stringify(lastSeenAt ? { last_seen_at: lastSeenAt } : {}),
    timeout: 60000,
  });
  return res.json();
}

// ─── Sharing ──────────────────────────────────────────────

export async function shareSimulation(simId: string): Promise<ShareResponse> {
  const res = await fetchWithRetry(
    `${getApiUrl()}/api/simulations/${simId}/share`,
    { method: "POST" }
  );
  return res.json();
}

export async function revokeShare(simId: string): Promise<void> {
  // 204 No Content — nothing to parse
  await fetchWithRetry(`${getApiUrl()}/api/simulations/${simId}/share`, {
    method: "DELETE",
  });
}

export async function getSharedSimulation(
  shareId: string
): Promise<SharedSnapshot> {
  const res = await fetchWithRetry(`${getApiUrl()}/api/shared/${shareId}`, {
    skipAuth: true, // public endpoint
  });
  return res.json();
}

// ─── Run History ──────────────────────────────────────────

export async function getSimulationRuns(
  simId: string
): Promise<{ runs: RunHistoryEntry[] }> {
  const res = await fetchWithRetry(
    `${getApiUrl()}/api/simulations/${simId}/runs`
  );
  return res.json();
}

// ─── Analytics ────────────────────────────────────────────

export async function getAnalyticsSummary(): Promise<AnalyticsSummary> {
  const res = await fetchWithRetry(`${getApiUrl()}/api/analytics/summary`);
  return res.json();
}

export async function getPublicStats(): Promise<PublicStats> {
  const res = await fetchWithRetry(`${getApiUrl()}/api/public/stats`, {
    skipAuth: true, // public endpoint
  });
  return res.json();
}

// ─── Live Theater (replay + transcript) ──────────────────

// One representative deterministic path re-run with the sim's stored base_seed,
// captured per-step for animation. 404 if the sim has no results yet.
export async function getReplay(simId: string): Promise<ReplayData> {
  const res = await fetchWithRetry(
    `${getApiUrl()}/api/simulations/${simId}/replay`
  );
  return res.json();
}

// Persona-voiced narrative of the captured path (one llm_client call, cached
// server-side). 404 if no results. Falls back to a templated narrative server-side.
export async function getTranscript(simId: string): Promise<AgentTranscript> {
  const res = await fetchWithRetry(
    `${getApiUrl()}/api/simulations/${simId}/transcript`,
    { timeout: 120000, retries: 1 }
  );
  return res.json();
}

// ─── Zero-Signup Demo ─────────────────────────────────────

// PUBLIC, IP-rate-limited. Runs a hardcoded preset inline (<=500 runs) and
// returns real results WITHOUT persisting to a user.
export async function runDemo(
  preset: DemoPreset,
  overrides?: Record<string, number>
): Promise<DemoRunResponse> {
  const res = await fetchWithRetry(`${getApiUrl()}/api/demo/run`, {
    method: "POST",
    body: JSON.stringify({ preset, overrides: overrides || {} }),
    timeout: 60000,
    retries: 0, // don't retry — avoid double-running
    skipAuth: true, // public endpoint — anon falls to per-IP tier
  });
  return res.json();
}

// AUTHED. Persists a previously-run demo as a normal owner-scoped simulation
// for the now-signed-in user. Returns the new sim id.
export async function claimDemo(data: {
  demo_id: string;
  config: Record<string, any>;
  results: any;
}): Promise<{ simulation_id: string }> {
  const res = await fetchWithRetry(`${getApiUrl()}/api/demo/claim`, {
    method: "POST",
    body: JSON.stringify(data),
    timeout: 60000,
    retries: 0,
  });
  return res.json();
}

// ─── AI Copilot (next experiments) ────────────────────────

// Feeds the sim's results + variable list + run history to the LLM and returns
// 3-5 typed next-experiment suggestions. Heuristic fallback server-side if the
// LLM fails. Expensive — long timeout, no retries (avoid duplicate LLM calls).
export async function getCopilotSuggestions(simId: string): Promise<CopilotResponse> {
  const res = await fetchWithRetry(
    `${getApiUrl()}/api/simulations/${simId}/copilot`,
    {
      method: "POST",
      body: JSON.stringify({}),
      timeout: 120000,
      retries: 0,
    }
  );
  return res.json();
}

// ─── Bayesian Calibration (Wave L) ────────────────────────

// Fits engine variables to a user's historical data via a LIGHTWEIGHT
// moment-matching + conjugate-normal posterior update (NOT full MCMC).
// observed = { column name -> observed series }; mapping is optional (observed
// column name -> sim variable name) — absent, the server fuzzy-matches by name.
// Expensive (server-side grid posterior); long timeout, no retries.
export async function calibrateSimulation(
  simId: string,
  observed: Record<string, number[]>,
  mapping?: Record<string, string>
): Promise<CalibrationResult> {
  const res = await fetchWithRetry(
    `${getApiUrl()}/api/simulations/${simId}/calibrate`,
    {
      method: "POST",
      body: JSON.stringify(mapping ? { observed, mapping } : { observed }),
      timeout: 120000,
      retries: 0,
    }
  );
  return res.json();
}

// Writes the chosen posteriors back into the sim's config variable values.
// posteriors = { variable_name -> posterior_value }.
export async function applyCalibration(
  simId: string,
  posteriors: Record<string, number>
): Promise<{ simulation_id: string }> {
  const res = await fetchWithRetry(
    `${getApiUrl()}/api/simulations/${simId}/calibrate/apply`,
    {
      method: "POST",
      body: JSON.stringify({ posteriors }),
    }
  );
  return res.json();
}

// ─── Causal Graph + Do-Operator (Wave L) ──────────────────

// Loads the graph's causal-only DAG: nodes, signed directed edges, and a
// cycle flag (cycles are broken for layering server-side).
export async function getCausalGraph(graphId: string): Promise<CausalGraph> {
  const res = await fetchWithRetry(
    `${getApiUrl()}/api/graphs/${graphId}/causal`
  );
  return res.json();
}

// Pearl-style do() on the causal DAG: clamps a node, propagates a signed,
// decaying effect downstream, returns ranked predicted changes. Directional,
// not point estimates. Expensive — long timeout, no retries.
export async function interveneCausal(
  graphId: string,
  data: { node_uuid: string; direction: "increase" | "decrease"; magnitude?: number }
): Promise<InterventionResult> {
  const res = await fetchWithRetry(
    `${getApiUrl()}/api/graphs/${graphId}/intervene`,
    {
      method: "POST",
      body: JSON.stringify(data),
      timeout: 60000,
      retries: 0,
    }
  );
  return res.json();
}

// ─── Composites (cross-domain composite simulations) ─────

// A composite is a DAG of sub-simulations linked by metric->variable edges.
// Creates + persists it owner-scoped. 422 if links reference unknown
// node_id/to_variable or the link graph has a cycle (must be a DAG).
export async function createComposite(
  config: CompositeConfig
): Promise<{ composite_id: string; status: string }> {
  const res = await fetchWithRetry(`${getApiUrl()}/api/composites`, {
    method: "POST",
    body: JSON.stringify(config),
    retries: 0, // don't retry — avoid double-creating composites
  });
  return res.json();
}

// Owner-scoped list of the user's composites (summary fields only).
export async function listComposites(): Promise<{ composites: CompositeListItem[] }> {
  const res = await fetchWithRetry(`${getApiUrl()}/api/composites`);
  return res.json();
}

// The full stored composite + results if it has been run. 404/403.
export async function getComposite(id: string): Promise<CompositeDetail> {
  const res = await fetchWithRetry(`${getApiUrl()}/api/composites/${id}`);
  return res.json();
}

export async function deleteComposite(id: string): Promise<void> {
  // 204 No Content — nothing to parse
  await fetchWithRetry(`${getApiUrl()}/api/composites/${id}`, {
    method: "DELETE",
  });
}

// Runs the composite in topological order, propagating per-path uncertainty
// across domains, persists + returns the results. Expensive — long timeout,
// no retries (avoid double-running). 404/403; 409 if the composite has no nodes.
export async function runComposite(
  id: string,
  opts?: { num_runs?: number }
): Promise<CompositeRunResult> {
  const res = await fetchWithRetry(`${getApiUrl()}/api/composites/${id}/run`, {
    method: "POST",
    body: JSON.stringify(opts || {}),
    timeout: 300000, // chained Monte Carlo across domains — can take minutes
    retries: 0,
  });
  return res.json();
}

// ─── Multi-Objective Pareto Optimizer ─────────────────────

// Searches the chosen variables' [min,max] ranges (Latin-hypercube), evaluating
// each candidate config with a SHARED base_seed so comparisons are signal, not
// Monte-Carlo noise, then returns the Pareto-non-dominated frontier + a knee
// point. The HEAVIEST endpoint — many low-N sims; long timeout, no retries.
export async function optimizeSimulation(
  simId: string,
  body: {
    objectives: OptimizeObjective[];
    variables?: string[];
    budget?: number;
    runs_per_candidate?: number;
  }
): Promise<OptimizeResult> {
  const res = await fetchWithRetry(
    `${getApiUrl()}/api/simulations/${simId}/optimize`,
    {
      method: "POST",
      body: JSON.stringify(body),
      timeout: 300000, // budget x runs_per_candidate low-N sims — can take minutes
      retries: 0,      // don't retry — expensive, avoid double-running
    }
  );
  return res.json();
}

// ─── Hero Run (LLM-driven agents in the loop) ─────────────

// Runs ONE deterministic-seed path where, at a few key decision ticks, the most
// influential agent makes a real Claude decision grounded in its persona + the
// current market state instead of the hardcoded formula. This is ONE illustrative
// explanatory path — NOT the 1000-path Monte Carlo (which stays formula-based +
// fast). Budget-capped: max_decisions (1-12, default 6) bounds total LLM calls.
// Expensive — long timeout, no retries (avoid duplicate LLM spend).
export async function heroRun(
  simId: string,
  body?: { max_decisions?: number }
): Promise<HeroRunResult> {
  const res = await fetchWithRetry(
    `${getApiUrl()}/api/simulations/${simId}/hero-run`,
    {
      method: "POST",
      body: JSON.stringify(body || {}),
      timeout: 300000, // seeded path + several LLM decisions + narration — can take minutes
      retries: 0,      // don't retry — expensive, avoid duplicate LLM calls
    }
  );
  return res.json();
}

// ─── Export helpers ───────────────────────────────────────

export function exportToCSV(data: any[], filename: string) {
  if (!data.length) return;
  const headers = Object.keys(data[0]);
  const rows = data.map((row) =>
    headers.map((h) => {
      const val = row[h];
      if (val === null || val === undefined) return "";
      if (typeof val === "string" && (val.includes(",") || val.includes('"')))
        return `"${val.replace(/"/g, '""')}"`;
      return String(val);
    }).join(",")
  );
  const csv = [headers.join(","), ...rows].join("\n");
  downloadBlob(csv, `${filename}.csv`, "text/csv");
}

export function exportToJSON(data: any, filename: string) {
  const json = JSON.stringify(data, null, 2);
  downloadBlob(json, `${filename}.json`, "application/json");
}

function downloadBlob(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
