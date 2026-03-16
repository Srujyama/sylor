/**
 * Sylor API Client
 * Centralized API layer with retry, timeout, and error handling
 */

import { getApiUrl } from "./utils";

interface FetchOptions extends RequestInit {
  retries?: number;
  retryDelay?: number;
  timeout?: number;
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

async function fetchWithRetry(
  url: string,
  options: FetchOptions = {}
): Promise<Response> {
  const { retries = 2, retryDelay = 1500, timeout = 60000, ...fetchOpts } = options;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(url, {
        ...fetchOpts,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
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

export async function listSimulations(userId: string) {
  const res = await fetchWithRetry(
    `${getApiUrl()}/api/simulations?user_id=${userId}`
  );
  return res.json();
}

export async function getSimulation(simId: string) {
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
    body: formData,
    headers: {}, // Let browser set content-type with boundary
    timeout: 30000,
  });
  return res.json();
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
      body: formData,
      headers: {}, // Let browser set content-type with boundary
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
