"use client";

export const dynamic = 'force-dynamic';

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SliderWithInput } from "@/components/ui/slider-with-input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, Zap, TrendingUp, AlertTriangle, CheckCircle, Info,
  BarChart3, GitBranch, Users2, Lightbulb, RefreshCw, Download, Loader2,
  Share2, FileJson, FileSpreadsheet, Clock, SlidersHorizontal,
  Sparkles, ArrowUpRight, ArrowDownRight, ChevronDown, ChevronUp, History, Gauge,
  FileText, Network, GitFork, GitCompareArrows, ScanSearch, XCircle,
} from "lucide-react";
import { SimulationTheater } from "@/components/theater/SimulationTheater";
import { CopilotPanel } from "@/components/copilot/CopilotPanel";
import { CalibratePanel } from "@/components/calibrate/CalibratePanel";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import {
  exportToCSV, exportToJSON, getSimulation, getResults, runSimulationStream,
  runTornado, runWhatIf, shareSimulation, revokeShare, getSimulationRuns,
  generateMemo, branchSimulation, getScenarioTree, runDiff, explainRun,
  type SimulationProgress,
} from "@/lib/api";
import { getDomainLabels } from "@/lib/domain-labels";
import { useToast } from "@/components/ui/toast";
import { useRunTray } from "@/components/run-tray";
import type { MemoAudience } from "@/types";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, Legend, ReferenceLine,
} from "recharts";
import type {
  TornadoResponse, WhatIfResponse, RunHistoryEntry, DiffResponse,
  ExplainResponse, ExplainPercentile,
} from "@/types";

const severityColor = {
  low: { badge: "success" as const, icon: CheckCircle, color: "text-green-400" },
  medium: { badge: "warning" as const, icon: AlertTriangle, color: "text-yellow-400" },
  high: { badge: "destructive" as const, icon: AlertTriangle, color: "text-red-400" },
  critical: { badge: "destructive" as const, icon: AlertTriangle, color: "text-red-500" },
};

const OUTCOME_COLORS = ["#ef4444", "#f97316", "#eab308", "#84cc16", "#22c55e", "#06b6d4"];

// Human labels for the SSE stream phases
const PHASE_LABELS: Record<string, string> = {
  running: "running scenarios",
  aggregating: "aggregating results",
  ai_insights: "generating ai insights",
  saving: "saving results",
};

export default function SimulationDetailPage({ params }: { params: { id: string } }) {
  const { toast } = useToast();
  const router = useRouter();
  const { trackExternalRun } = useRunTray();
  const [simulation, setSimulation] = useState<any>(null);
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [variableOverrides, setVariableOverrides] = useState<Record<string, number>>({});
  const [isRerunning, setIsRerunning] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [runProgress, setRunProgress] = useState(0);
  const [runStage, setRunStage] = useState("Initializing...");
  const runTimersRef = useRef<NodeJS.Timeout[]>([]);

  // Sensitivity (tornado) analysis
  const [tornadoDelta, setTornadoDelta] = useState(20);
  const [tornadoLoading, setTornadoLoading] = useState(false);
  const [tornado, setTornado] = useState<TornadoResponse | null>(null);

  // Natural-language what-if
  const [whatifPrompt, setWhatifPrompt] = useState("");
  const [whatifLoading, setWhatifLoading] = useState(false);
  const [whatif, setWhatif] = useState<WhatIfResponse | null>(null);

  // Counterfactual diff vs baseline (direct slider overrides)
  const [diffLoading, setDiffLoading] = useState(false);
  const [diff, setDiff] = useState<DiffResponse | null>(null);

  // Per-run explainer (worst / median / best path)
  const [explainPercentile, setExplainPercentile] = useState<ExplainPercentile>("p50");
  const [explainLoading, setExplainLoading] = useState(false);
  const [explanation, setExplanation] = useState<ExplainResponse | null>(null);

  // Sharing
  const [sharing, setSharing] = useState(false);

  // Run history
  const [runHistory, setRunHistory] = useState<RunHistoryEntry[]>([]);
  const [runListOpen, setRunListOpen] = useState(false);

  // Decision memo
  const [memoAudience, setMemoAudience] = useState<MemoAudience>("exec");
  const [memoLoading, setMemoLoading] = useState(false);

  // Scenario branching
  const [branchLabel, setBranchLabel] = useState("");
  const [branching, setBranching] = useState(false);
  // True when this sim belongs to a family with >1 node (a branch, or a root
  // with children) — controls whether the "scenario tree" link is shown.
  const [hasScenarioFamily, setHasScenarioFamily] = useState(false);

  function handleExportCSV() {
    if (!results) return;
    const timeline = (results.timeline_aggregated || []).map((t: any) => ({
      month: t.month,
      avg_revenue: t.avg_revenue,
      p10_revenue: t.p10_revenue,
      p90_revenue: t.p90_revenue,
      avg_customers: t.avg_customers,
      avg_market_share: t.avg_market_share,
    }));
    exportToCSV(timeline, `${simulation?.name || "simulation"}-timeline`);
    toast({ title: "Exported as CSV", variant: "success" });
    setShowExportMenu(false);
  }

  function handleExportJSON() {
    if (!results) return;
    exportToJSON({
      simulation: { name: simulation?.name, category: simulation?.category, config: simulation?.config },
      results: {
        success_probability: results.success_probability,
        confidence_interval: results.confidence_interval,
        avg_revenue: results.avg_revenue,
        avg_market_share: results.avg_market_share,
        avg_breakeven_month: results.avg_breakeven_month,
        risk_factors: results.risk_factors,
        key_insights: results.key_insights,
        timeline_aggregated: results.timeline_aggregated,
        outcome_distribution: results.outcome_distribution,
      },
    }, `${simulation?.name || "simulation"}-results`);
    toast({ title: "Exported as JSON", variant: "success" });
    setShowExportMenu(false);
  }

  async function handleShare() {
    if (sharing) return;
    setSharing(true);
    try {
      const { share_id } = await shareSimulation(params.id);
      await navigator.clipboard.writeText(`${window.location.origin}/s/${share_id}`);
      // Mark the "share a result" activation step as done (Wave J).
      try { localStorage.setItem("sylor-shared", "1"); } catch {}
      toast({ title: "share link copied", description: "anyone with the link can view a frozen snapshot", variant: "success" });
    } catch (e: any) {
      toast({ title: "failed to create share link", description: e.message || "try again in a moment", variant: "error" });
    } finally {
      setSharing(false);
    }
  }

  async function handleRevokeShares() {
    try {
      await revokeShare(params.id);
      toast({ title: "share links revoked", description: "all existing links for this simulation are now dead", variant: "success" });
    } catch (e: any) {
      toast({ title: "failed to revoke shares", description: e.message || "try again in a moment", variant: "error" });
    }
  }

  async function handleRunTornado() {
    if (tornadoLoading) return;
    setTornadoLoading(true);
    try {
      const data = await runTornado(params.id, { delta_pct: tornadoDelta });
      setTornado(data);
    } catch (e: any) {
      toast({ title: "sensitivity analysis failed", description: e.message || "try again in a moment", variant: "error" });
    } finally {
      setTornadoLoading(false);
    }
  }

  async function handleRunWhatIf() {
    const prompt = whatifPrompt.trim();
    if (!prompt || whatifLoading) return;
    if (prompt.length < 3) {
      toast({ title: "what-if too short", description: "describe the change in a few words", variant: "error" });
      return;
    }
    setWhatifLoading(true);
    try {
      const data = await runWhatIf(params.id, prompt.slice(0, 500));
      setWhatif(data);
      refreshRunHistory();
    } catch (e: any) {
      toast({ title: "what-if failed", description: e.message || "try rephrasing your question", variant: "error" });
    } finally {
      setWhatifLoading(false);
    }
  }

  async function handleRunDiff() {
    if (diffLoading) return;
    // Only send overrides that actually differ from the configured baseline so
    // the diff endpoint runs a meaningful counterfactual.
    const changed: Record<string, number> = {};
    (simulation?.config?.variables || []).forEach((v: any) => {
      const next = variableOverrides[v.name];
      if (next != null && Number(next) !== Number(v.value)) changed[v.name] = Number(next);
    });
    if (Object.keys(changed).length === 0) {
      toast({ title: "no changes to diff", description: "adjust a variable above first", variant: "error" });
      return;
    }
    setDiffLoading(true);
    try {
      const data = await runDiff(params.id, changed);
      setDiff(data);
    } catch (e: any) {
      toast({ title: "diff failed", description: e.message || "try again in a moment", variant: "error" });
    } finally {
      setDiffLoading(false);
    }
  }

  async function handleExplainRun(percentile: ExplainPercentile) {
    if (explainLoading) return;
    setExplainPercentile(percentile);
    setExplainLoading(true);
    try {
      const data = await explainRun(params.id, percentile);
      setExplanation(data);
    } catch (e: any) {
      toast({ title: "couldn't explain that run", description: e.message || "try again in a moment", variant: "error" });
    } finally {
      setExplainLoading(false);
    }
  }

  async function refreshRunHistory() {
    try {
      const data = await getSimulationRuns(params.id);
      setRunHistory(data.runs || []);
    } catch {
      // non-critical — the history card just stays hidden
    }
  }

  async function handleGenerateMemo() {
    if (memoLoading) return;
    setMemoLoading(true);
    try {
      const { report_id } = await generateMemo(params.id, memoAudience);
      // The report page polls progress from Wave B until the memo finishes.
      router.push(`/reports/${report_id}`);
    } catch (e: any) {
      toast({ title: "couldn't generate memo", description: e.message || "try again in a moment", variant: "error" });
      setMemoLoading(false);
    }
  }

  async function handleSaveBranch() {
    if (branching) return;
    setBranching(true);
    const label = branchLabel.trim() || "branch";
    try {
      const { simulation_id } = await branchSimulation(params.id, {
        variable_overrides: variableOverrides,
        label,
        num_runs: simulation?.config?.num_runs || 1000,
      });
      // The branch is created as a draft then run as a tracked background task
      // server-side — surface it in the tray as an external run (poll-only) so
      // we don't kick off a second run via the stream.
      trackExternalRun(simulation_id, label);
      setBranchLabel("");
      toast({ title: "branch saved", description: `running "${label}" — track it in the run tray`, variant: "success" });
      router.push(`/simulations/${params.id}/tree`);
    } catch (e: any) {
      toast({ title: "couldn't save branch", description: e.message || "try again in a moment", variant: "error" });
    } finally {
      setBranching(false);
    }
  }

  // Record this sim in the command palette's recents (localStorage 'sylor-recents')
  useEffect(() => {
    try {
      const raw = localStorage.getItem("sylor-recents");
      const prev: string[] = raw ? JSON.parse(raw) : [];
      const next = [params.id, ...(Array.isArray(prev) ? prev : []).filter((id) => id !== params.id)].slice(0, 5);
      localStorage.setItem("sylor-recents", JSON.stringify(next));
    } catch {
      // localStorage unavailable — recents just won't persist
    }
  }, [params.id]);

  // Fetch simulation data
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;

    async function fetchData() {
      try {
        const sim = await getSimulation(params.id);
        setSimulation(sim);

        if (sim.status === "completed" && sim.results) {
          setResults(sim.results);
          // Initialize variable overrides from config
          if (sim.config?.variables) {
            const overrides: Record<string, number> = {};
            sim.config.variables.forEach((v: any) => { overrides[v.name] = v.value; });
            setVariableOverrides(overrides);
          }
          setLoading(false);
        } else if (sim.status === "failed") {
          setError(sim.error || "Simulation failed");
          setLoading(false);
        } else if (sim.status === "running") {
          // Run was started elsewhere (wizard, project pipeline, another tab) —
          // there is no stream to attach to, so poll every 2s as the fallback
          // and animate a stage label while we wait.
          const runStages = [
            { at: 600,   pct: 8,  label: "Spawning agents..." },
            { at: 2000,  pct: 20, label: "Running Monte Carlo iterations..." },
            { at: 4000,  pct: 38, label: "Simulating market dynamics..." },
            { at: 6000,  pct: 52, label: "Computing outcome distribution..." },
            { at: 9000,  pct: 65, label: "Aggregating percentile bands..." },
            { at: 12000, pct: 76, label: "Generating AI insights..." },
            { at: 16000, pct: 85, label: "Calculating risk factors..." },
            { at: 20000, pct: 92, label: "Finalizing results..." },
          ];
          const timers: NodeJS.Timeout[] = [];
          runStages.forEach(({ at, pct, label }) => {
            const t = setTimeout(() => {
              setRunProgress(pct);
              setRunStage(label);
            }, at);
            timers.push(t);
          });
          runTimersRef.current = timers;

          // Poll for completion
          interval = setInterval(async () => {
            try {
              const data = await getResults(params.id);
              if (data.status === "completed") {
                runTimersRef.current.forEach(clearTimeout);
                setRunProgress(100);
                setRunStage("Simulation complete!");
                await new Promise((r) => setTimeout(r, 300));
                setResults(data.results);
                setSimulation((prev: any) => ({ ...prev, status: "completed", results: data.results }));
                setLoading(false);
                if (interval) clearInterval(interval);
              } else if (data.status === "failed") {
                runTimersRef.current.forEach(clearTimeout);
                setError("Simulation failed");
                setLoading(false);
                if (interval) clearInterval(interval);
              }
            } catch {}
          }, 2000);
        }
      } catch (e: any) {
        setError(e.message || "Failed to load simulation");
        setLoading(false);
      }
    }

    fetchData();
    return () => {
      if (interval) clearInterval(interval);
      runTimersRef.current.forEach(clearTimeout);
    };
  }, [params.id]);

  // Run history — loads once the simulation is completed, refreshes after reruns
  useEffect(() => {
    if (simulation?.status !== "completed") return;
    let cancelled = false;
    getSimulationRuns(params.id)
      .then((data) => { if (!cancelled) setRunHistory(data.runs || []); })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, simulation?.status]);

  // Detect whether this sim is part of a scenario family (a branch, or a root
  // with children) so we can surface the "scenario tree" link.
  useEffect(() => {
    if (!simulation) return;
    if (simulation.parent_id) {
      setHasScenarioFamily(true);
      return;
    }
    let cancelled = false;
    getScenarioTree(params.id)
      .then((tree) => { if (!cancelled) setHasScenarioFamily((tree.nodes?.length || 0) > 1); })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, simulation?.parent_id, simulation?.id]);

  const [rerunProgress, setRerunProgress] = useState(0);
  const [rerunStage, setRerunStage] = useState("");
  const rerunPollRef = useRef<NodeJS.Timeout | null>(null);

  // Clear any in-flight rerun poll on unmount
  useEffect(() => {
    return () => {
      if (rerunPollRef.current) clearInterval(rerunPollRef.current);
    };
  }, []);

  function finishRerun(data: any) {
    setRerunProgress(100);
    setRerunStage("done");
    setResults(data.results);
    setSimulation((prev: any) => ({ ...prev, status: "completed", results: data.results }));
    setIsRerunning(false);
    refreshRunHistory();
    toast({ title: "Rerun complete", description: `Success probability: ${Math.round(data.results.success_probability)}%`, variant: "success" });
  }

  // Automatic 2s polling fallback — used when the SSE stream errors out
  // mid-run (the run keeps going server-side).
  function startRerunPolling() {
    if (rerunPollRef.current) clearInterval(rerunPollRef.current);
    rerunPollRef.current = setInterval(async () => {
      try {
        const data = await getResults(params.id);
        if (data.status === "completed") {
          if (rerunPollRef.current) clearInterval(rerunPollRef.current);
          finishRerun(data);
        } else if (data.status === "failed") {
          if (rerunPollRef.current) clearInterval(rerunPollRef.current);
          setIsRerunning(false);
          toast({ title: "Rerun failed", description: "The simulation encountered an error", variant: "error" });
        }
      } catch {
        // transient poll error — the next tick retries
      }
    }, 2000);
  }

  async function handleRerun() {
    setIsRerunning(true);
    setRerunProgress(0);
    setRerunStage("starting run...");
    const opts = {
      num_runs: simulation?.config?.num_runs || 1000,
      variable_overrides: variableOverrides,
    };

    // Register with the global run tray so progress + completion notification
    // surface even if the user navigates away. The PAGE owns the live stream
    // below (one /run/stream POST); the tray only OBSERVES via polling so we
    // never start a second concurrent run for the same simulation.
    trackExternalRun(params.id, simulation?.name || "simulation");

    let completed = false;
    let failed = false;
    try {
      // Live SSE progress: percent / completed / total + phase label
      await runSimulationStream(params.id, opts, {
        onProgress: (p: SimulationProgress) => {
          setRerunProgress(Math.round(p.percent));
          setRerunStage(
            `${PHASE_LABELS[p.phase] || p.phase} · ${p.completed.toLocaleString()}/${p.total.toLocaleString()} runs`
          );
        },
        onComplete: () => {
          completed = true;
        },
        onError: (detail: string) => {
          failed = true;
          setIsRerunning(false);
          toast({ title: "Rerun failed", description: detail || "The simulation encountered an error", variant: "error" });
        },
      });

      if (completed) {
        // Stream finished — fetch the full results document
        const data = await getResults(params.id);
        finishRerun(data);
      } else if (!failed) {
        // Stream closed without a terminal event — fall back to polling
        setRerunStage("waiting for results...");
        startRerunPolling();
      }
    } catch (err: any) {
      if (err?.status >= 400 && err.status < 500) {
        // The run never started (auth/validation) — surface and stop
        setIsRerunning(false);
        toast({ title: "Rerun failed", description: err.message || "Could not start rerun", variant: "error" });
      } else {
        // Stream connection broke — the run may still be going; poll as fallback
        setRerunStage("live progress unavailable — polling for results...");
        startRerunPolling();
      }
    }
  }

  // Domain labels
  const category = simulation?.category || "startup";
  const labels = getDomainLabels(category);
  const dm = results?.domain_metadata;

  const primaryLabel = dm?.primary_metric_label || labels.primaryMetric;
  const secondaryLabel = dm?.secondary_metric_label || labels.secondaryMetric;
  const tertiaryLabel = dm?.tertiary_metric_label || labels.tertiaryMetric;
  const timeUnit = dm?.time_unit || labels.timeUnit;

  // --- LOADING STATE ---
  if (loading) {
    return (
      <div className="p-8">
        <div className="flex items-center gap-4 mb-8">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/simulations"><ArrowLeft className="w-4 h-4" /></Link>
          </Button>
          <div>
            <Skeleton className="h-7 w-64 mb-2" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[1,2,3,4].map(i => (
            <div key={i} className="surface p-5">
              <Skeleton className="h-3 w-24 mb-2" />
              <Skeleton className="h-8 w-16 mb-1" />
              <Skeleton className="h-3 w-20" />
            </div>
          ))}
        </div>
        <div className="flex items-center justify-center py-20">
          <div className="text-center w-full max-w-sm">
            <Zap className="w-6 h-6 text-violet-400/60 mx-auto mb-5" />
            <p className="text-sm text-white/70 font-medium mb-1">Running simulation</p>
            <p className="text-xs text-white/30 mb-6">{runStage}</p>
            <Progress value={runProgress} className="h-1.5 mb-3" />
            <p className="text-[10px] text-white/20 tracking-widest">{runProgress}%</p>
          </div>
        </div>
      </div>
    );
  }

  // --- ERROR STATE ---
  if (error) {
    return (
      <div className="p-8">
        <div className="flex items-center gap-4 mb-8">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/simulations"><ArrowLeft className="w-4 h-4" /></Link>
          </Button>
          <h1 className="text-2xl font-bold text-white">Simulation Error</h1>
        </div>
        <div className="surface p-8 max-w-lg">
          <div className="flex items-start gap-3 mb-4">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-white mb-1">Simulation failed</p>
              <p className="text-xs text-white/40">{error}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" asChild><Link href="/dashboard">Back to Dashboard</Link></Button>
            <Button variant="gradient" onClick={() => window.location.reload()}>
              <RefreshCw className="w-3 h-3" /> Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!results) return null;

  // --- DATA TRANSFORMS ---
  const timelineData = (results.timeline_aggregated || []).map((t: any) => ({
    month: `${timeUnit.charAt(0).toUpperCase()}${t.month}`,
    p10: t.p10_revenue,
    p50: t.avg_revenue,
    p90: t.p90_revenue,
    customers: t.avg_customers,
    marketShare: t.avg_market_share,
    competitorStrength: 0,
  }));

  const outcomeDistribution = (results.outcome_distribution || []).map((d: any, i: number) => ({
    range: d.range,
    probability: d.probability,
    color: OUTCOME_COLORS[i % OUTCOME_COLORS.length],
  }));

  const riskFactors = results.risk_factors || [];
  const keyInsights = results.key_insights || [];
  const successProb = results.success_probability || 0;
  const ciLow = results.confidence_interval?.[0] || 0;
  const ciHigh = results.confidence_interval?.[1] || 0;

  // Format primary metric for display
  const fmtPrimary = (v: number) => {
    if (dm?.primary_metric_unit === "$") return formatCurrency(v);
    if (dm?.primary_metric_unit === "%") return `${v.toFixed(1)}%`;
    return labels.formatPrimary(v);
  };

  const simConfig = simulation?.config || {};
  const variables = simConfig.variables || [];

  // Agent data for pie chart
  const agentActivity = (simConfig.agents || []).map((a: any, i: number) => ({
    name: a.name || a.type,
    value: a.count,
    color: ["#8b5cf6", "#ef4444", "#eab308", "#06b6d4", "#22c55e", "#f97316"][i % 6],
  }));

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-8">
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/simulations"><ArrowLeft className="w-4 h-4" /></Link>
          </Button>
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-bold text-white">{simulation?.name || "Simulation"}</h1>
              <Badge variant="success">Completed</Badge>
              <Badge variant="outline">{category}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {simConfig.num_runs?.toLocaleString() || "1,000"} runs · {simConfig.time_horizon} {timeUnit} horizon · {
                (simConfig.agents || []).reduce((s: number, a: any) => s + a.count, 0).toLocaleString()
              } agents
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex flex-col items-center">
            <Button variant="glass" size="sm" onClick={handleShare} disabled={sharing}>
              {sharing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />} Share
            </Button>
            <button
              onClick={handleRevokeShares}
              className="text-[9px] text-white/20 hover:text-red-400/70 mt-1 transition-colors"
            >
              revoke shares
            </button>
          </div>
          <div className="relative">
            <Button variant="glass" size="sm" onClick={() => setShowExportMenu(!showExportMenu)}>
              <Download className="w-4 h-4" /> Export
            </Button>
            {showExportMenu && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-[var(--surface-bg)] border border-white/10 py-1 min-w-[160px]">
                <button onClick={handleExportCSV} className="w-full text-left px-3 py-2 text-xs text-white/60 hover:bg-white/[0.05] hover:text-white flex items-center gap-2">
                  <FileSpreadsheet className="w-3 h-3" /> Export as CSV
                </button>
                <button onClick={handleExportJSON} className="w-full text-left px-3 py-2 text-xs text-white/60 hover:bg-white/[0.05] hover:text-white flex items-center gap-2">
                  <FileJson className="w-3 h-3" /> Export as JSON
                </button>
              </div>
            )}
          </div>
          {/* Decision memo — audience toggle + generate */}
          <div className="flex items-center gap-0">
            <div className="flex items-center p-0.5 bg-white/[0.03] border border-white/[0.06] border-r-0 h-9">
              {(["exec", "technical"] as MemoAudience[]).map((a) => (
                <button
                  key={a}
                  onClick={() => setMemoAudience(a)}
                  disabled={memoLoading}
                  className={cn(
                    "px-2 py-1 text-[10px] transition-all",
                    memoAudience === a ? "bg-white/10 text-white" : "text-white/30 hover:text-white/50"
                  )}
                >
                  {a}
                </button>
              ))}
            </div>
            <Button variant="glass" size="sm" onClick={handleGenerateMemo} disabled={memoLoading}>
              {memoLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} Memo
            </Button>
          </div>
          {hasScenarioFamily && (
            <Button variant="glass" size="sm" asChild>
              <Link href={`/simulations/${params.id}/tree`}><Network className="w-4 h-4" /> Scenario Tree</Link>
            </Button>
          )}
          <Button variant="glass" size="sm" asChild>
            <Link href={`/simulations/${params.id}/sweep`}><SlidersHorizontal className="w-4 h-4" /> Sensitivity</Link>
          </Button>
          <Button variant="gradient" size="sm" asChild>
            <Link href={`/simulations/${params.id}/compare`}><GitBranch className="w-4 h-4" /> Compare</Link>
          </Button>
        </div>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: "Success Probability", value: `${successProb}%`, sub: `CI: ${ciLow.toFixed(1)}% — ${ciHigh.toFixed(1)}%`, color: "text-green-400", bg: "from-green-500/20 to-green-500/5" },
          { label: `Avg ${primaryLabel}`, value: fmtPrimary(results.avg_revenue), sub: "P50 scenario", color: "text-cyan-400", bg: "from-cyan-500/20 to-cyan-500/5" },
          { label: "Break-even", value: `${results.avg_breakeven_month?.toFixed(1)} ${timeUnit.slice(0, 2)}`, sub: "Median across runs", color: "text-violet-400", bg: "from-violet-500/20 to-violet-500/5" },
          { label: `Avg ${tertiaryLabel}`, value: `${results.avg_market_share?.toFixed(2)}%`, sub: `At end (P50)`, color: "text-yellow-400", bg: "from-yellow-500/20 to-yellow-500/5" },
        ].map((m) => (
          <Card key={m.label} className={`bg-gradient-to-br ${m.bg}`}>
            <CardContent className="p-5">
              <div className="text-xs text-muted-foreground mb-1">{m.label}</div>
              <div className={`text-3xl font-bold ${m.color} mb-0.5`}>{m.value}</div>
              <div className="text-xs text-muted-foreground">{m.sub}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="results">
        <TabsList className="mb-6 max-w-full overflow-x-auto">
          <TabsTrigger value="results">Results</TabsTrigger>
          <TabsTrigger value="theater">Theater</TabsTrigger>
          <TabsTrigger value="what-if">What-If</TabsTrigger>
          <TabsTrigger value="calibrate">Calibrate</TabsTrigger>
          <TabsTrigger value="sensitivity">Sensitivity</TabsTrigger>
          <TabsTrigger value="agents">Agents</TabsTrigger>
          <TabsTrigger value="insights">AI Insights</TabsTrigger>
        </TabsList>

        {/* Results Tab */}
        <TabsContent value="results" className="space-y-6">
          {/* AI Copilot — next-experiment suggestions */}
          <CopilotPanel
            simId={params.id}
            numRuns={simConfig.num_runs || 1000}
          />

          {/* Per-run explainer — why did a percentile path go the way it did */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ScanSearch className="w-4 h-4 text-violet-400" />
                Explain a Run
                <Badge variant="purple" className="ml-auto">Powered by Claude</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <p className="text-xs text-white/30 leading-relaxed">
                replays a single path and narrates why it landed where it did — pick the
                worst, median, or best case to inspect.
              </p>

              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1 p-0.5 bg-white/[0.03] border border-white/[0.06]">
                  {([
                    { p: "p10" as ExplainPercentile, label: "worst (p10)" },
                    { p: "p50" as ExplainPercentile, label: "median (p50)" },
                    { p: "p90" as ExplainPercentile, label: "best (p90)" },
                  ]).map(({ p, label }) => (
                    <button
                      key={p}
                      onClick={() => setExplainPercentile(p)}
                      disabled={explainLoading}
                      className={cn(
                        "px-3 py-1 text-xs transition-all",
                        explainPercentile === p ? "bg-white/10 text-white" : "text-white/30 hover:text-white/50"
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <Button variant="gradient" size="sm" onClick={() => handleExplainRun(explainPercentile)} disabled={explainLoading}>
                  {explainLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanSearch className="w-4 h-4" />}
                  {explainLoading ? "explaining..." : "explain run"}
                </Button>
              </div>

              {explainLoading && (
                <p className="text-xs text-white/30 flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  scanning paths for the {explainPercentile} case, replaying it, then narrating why...
                </p>
              )}

              {explanation && !explainLoading && (
                <div className="space-y-4">
                  {/* Outcome */}
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={cn(
                      "tag inline-flex items-center gap-1",
                      explanation.outcome.success ? "tag-green" : "tag-red"
                    )}>
                      {explanation.outcome.success
                        ? <><CheckCircle className="w-3 h-3" /> success</>
                        : <><XCircle className="w-3 h-3" /> failure</>}
                    </span>
                    <span className="text-sm text-white/60">
                      final {primaryLabel.toLowerCase()}{" "}
                      <span className="font-mono text-white/80">{formatCurrency(explanation.outcome.final_revenue)}</span>
                    </span>
                    <span className="text-[10px] text-white/20 ml-auto">
                      {explanation.percentile} · seed <span className="font-mono">{explanation.seed_used}</span>
                    </span>
                  </div>

                  {/* Pivotal events */}
                  {(explanation.pivotal_events?.length || 0) > 0 && (
                    <div className="space-y-2">
                      <div className="text-[10px] text-white/25 uppercase tracking-wider">pivotal events</div>
                      {explanation.pivotal_events.map((ev, i) => (
                        <div key={i} className="flex items-start gap-3 p-3 bg-white/5 border border-white/5">
                          <span className="text-[10px] font-mono text-white/30 w-12 shrink-0 mt-0.5">
                            {timeUnit.charAt(0)}{ev.t}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-xs font-medium text-white/80 capitalize">{ev.agent_type}</span>
                              <span className="text-[10px] text-white/40">{ev.action}</span>
                              <span className="tag tag-blue text-[9px]">{Math.round(ev.value * 100) / 100}</span>
                            </div>
                            <p className="text-xs text-muted-foreground leading-relaxed">{ev.why}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Narrative */}
                  {explanation.narrative && (
                    <blockquote className="border-l-2 border-violet-500/40 pl-4 py-1 text-sm text-white/60 italic leading-relaxed">
                      {explanation.narrative}
                    </blockquote>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Run history — vs previous run + sparkline */}
          {runHistory.length >= 2 && (() => {
            const latest = runHistory[0];
            const prev = runHistory[1];
            const dSuccess = latest.success_probability - prev.success_probability;
            const dRevenue = latest.avg_revenue - prev.avg_revenue;
            const spark = [...runHistory].reverse().map((r, i) => ({ idx: i + 1, success: r.success_probability }));
            return (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <History className="w-4 h-4 text-cyan-400" />
                    Run History
                    <span className="text-xs font-normal text-white/25 ml-1">{runHistory.length} recorded runs</span>
                    <button
                      onClick={() => setRunListOpen((o) => !o)}
                      className="ml-auto flex items-center gap-1 text-[10px] text-white/30 hover:text-white/60 transition-colors"
                    >
                      {runListOpen ? <>hide runs <ChevronUp className="w-3 h-3" /></> : <>show runs <ChevronDown className="w-3 h-3" /></>}
                    </button>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap items-center gap-6">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-white/25 uppercase tracking-wider">vs previous run</span>
                      <span className={cn("tag", dSuccess >= 0 ? "tag-green" : "tag-red")}>
                        {dSuccess >= 0 ? <ArrowUpRight className="w-3 h-3 inline mr-0.5" /> : <ArrowDownRight className="w-3 h-3 inline mr-0.5" />}
                        {dSuccess >= 0 ? "+" : ""}{dSuccess.toFixed(1)}pp success
                      </span>
                      <span className={cn("tag", dRevenue >= 0 ? "tag-green" : "tag-red")}>
                        {dRevenue >= 0 ? "+" : "−"}{formatCurrency(Math.abs(dRevenue))} avg revenue
                      </span>
                    </div>
                    <div className="flex-1 min-w-[160px] max-w-xs h-10">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={spark} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
                          <Tooltip
                            contentStyle={{ background: "var(--chart-tooltip-bg)", border: "1px solid var(--chart-tooltip-border)", borderRadius: 0, fontSize: 11 }}
                            formatter={(v: number) => [`${Number(v).toFixed(1)}%`, "success"]}
                            labelFormatter={(l) => `run ${l}`}
                          />
                          <Line type="monotone" dataKey="success" stroke="#06b6d4" strokeWidth={1.5} dot={{ r: 1.5, fill: "#06b6d4" }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  {runListOpen && (
                    <div className="mt-4 border-t border-white/[0.06] pt-2">
                      {runHistory.map((r, i) => (
                        <div key={r.run_id} className={cn("flex items-center gap-4 py-2 text-xs", i < runHistory.length - 1 && "border-b border-white/[0.04]")}>
                          <span className="text-white/15 font-mono w-5 text-right">{runHistory.length - i}</span>
                          <span className="text-white/40 flex-1">{formatDate(r.created_at)}</span>
                          <span className="text-white/25">{r.num_runs.toLocaleString()} runs</span>
                          {r.variable_overrides && Object.keys(r.variable_overrides).length > 0 && (
                            <span className="tag text-[9px]">{Object.keys(r.variable_overrides).length} overrides</span>
                          )}
                          <span className="text-white/60 font-mono w-12 text-right">{r.success_probability.toFixed(1)}%</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })()}

          {/* Primary metric projection */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-violet-400" />
                {primaryLabel} Projection — Percentile Bands
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={timelineData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <defs>
                    <linearGradient id="p90grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="p50grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false}
                    tickFormatter={(v) => labels.formatPrimary(v)} />
                  <Tooltip
                    contentStyle={{ background: "var(--chart-tooltip-bg)", border: "1px solid var(--chart-tooltip-border)", borderRadius: "0", fontSize: 12, fontFamily: "inherit" }}
                    formatter={(v: number, name: string) => [labels.formatPrimary(v), name === "p90" ? "Best 10%" : name === "p50" ? "Median" : "Worst 10%"]}
                  />
                  <Area type="monotone" dataKey="p90" stroke="#8b5cf6" strokeWidth={1.5} fill="url(#p90grad)" strokeDasharray="4 2" />
                  <Area type="monotone" dataKey="p50" stroke="#06b6d4" strokeWidth={2} fill="url(#p50grad)" />
                  <Area type="monotone" dataKey="p10" stroke="#ef4444" strokeWidth={1.5} fill="none" strokeDasharray="4 2" />
                </AreaChart>
              </ResponsiveContainer>
              <div className="flex gap-6 mt-3 justify-center text-xs">
                <div className="flex items-center gap-1.5"><div className="w-6 h-0.5 border-t-2 border-dashed border-violet-500" /><span className="text-muted-foreground">Best 10%</span></div>
                <div className="flex items-center gap-1.5"><div className="w-6 h-0.5 bg-cyan-500" /><span className="text-muted-foreground">Median</span></div>
                <div className="flex items-center gap-1.5"><div className="w-6 h-0.5 border-t-2 border-dashed border-red-500" /><span className="text-muted-foreground">Worst 10%</span></div>
              </div>
            </CardContent>
          </Card>

          {/* Outcome distribution + Secondary metric */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-cyan-400" />
                  {labels.outcomeLabel}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={outcomeDistribution} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                    <XAxis dataKey="range" tick={{ fontSize: 9, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                    <Tooltip
                      contentStyle={{ background: "var(--chart-tooltip-bg)", border: "1px solid var(--chart-tooltip-border)", borderRadius: "0", fontSize: 12 }}
                      formatter={(v: number) => [`${v}%`, "Probability"]}
                    />
                    <Bar dataKey="probability" radius={[2, 2, 0, 0]}>
                      {outcomeDistribution.map((entry: any, i: number) => (
                        <Cell key={i} fill={entry.color} opacity={0.8} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-green-400" />
                  {tertiaryLabel} Over Time
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={timelineData} margin={{ top: 5, right: 20, left: -20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false}
                      tickFormatter={(v) => labels.formatSecondary(v)} />
                    <Tooltip contentStyle={{ background: "var(--chart-tooltip-bg)", border: "1px solid var(--chart-tooltip-border)", borderRadius: "0", fontSize: 12 }} />
                    <Line type="monotone" dataKey="marketShare" stroke="#22c55e" strokeWidth={2} dot={false} name={tertiaryLabel} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Risk factors */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-yellow-400" />
                Risk Factors
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {riskFactors.map((risk: any) => {
                const config = severityColor[risk.severity as keyof typeof severityColor] || severityColor.medium;
                return (
                  <div key={risk.name} className="p-4 bg-white/5 border border-white/5">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <config.icon className={`w-4 h-4 ${config.color}`} />
                        <span className="text-sm font-medium text-white">{risk.name}</span>
                        <Badge variant={config.badge} className="text-xs capitalize">{risk.severity}</Badge>
                      </div>
                      <span className="text-sm text-muted-foreground">{risk.probability}% probability</span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">{risk.description}</p>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-violet-400 font-medium">Mitigation:</span>
                      <span className="text-muted-foreground">{risk.mitigation}</span>
                    </div>
                    <Progress value={risk.probability} className="h-1 mt-2" />
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Theater Tab — live agent replay + narrative transcript */}
        <TabsContent value="theater" className="space-y-6">
          <SimulationTheater simId={params.id} />
        </TabsContent>

        {/* What-If Tab */}
        <TabsContent value="what-if" className="space-y-6">
          {/* Natural-language what-if */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-violet-400" />
                Ask a What-If
                <Badge variant="purple" className="ml-auto">Powered by Claude</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={whatifPrompt}
                  onChange={(e) => setWhatifPrompt(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleRunWhatIf()}
                  maxLength={500}
                  placeholder='ask a what-if — e.g. "what if I raise prices 20% and churn rises 5%?"'
                  className="flex-1 border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/20"
                />
                <Button variant="gradient" onClick={handleRunWhatIf} disabled={whatifLoading || !whatifPrompt.trim()}>
                  {whatifLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  {whatifLoading ? "running..." : "ask"}
                </Button>
              </div>

              {whatifLoading && (
                <p className="text-xs text-white/30 flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  parsing your question, then re-running with the same seed so the deltas are signal, not noise...
                </p>
              )}

              {whatif && !whatifLoading && (() => {
                const varByName: Record<string, any> = {};
                variables.forEach((v: any) => { varByName[v.name] = v; });
                const overrides = Object.entries(whatif.parsed.variable_overrides || {});
                const dPP = whatif.deltas.success_probability_pp;
                const dRev = whatif.deltas.avg_revenue;
                const dBE = whatif.deltas.avg_time_to_breakeven;
                const fmtNum = (n: number) => Math.abs(n) >= 1000 ? n.toLocaleString() : `${Math.round(n * 100) / 100}`;
                return (
                  <div className="space-y-4">
                    {/* Parse chips */}
                    {overrides.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {overrides.map(([name, newVal]) => {
                          const v = varByName[name];
                          const oldVal = v?.value;
                          return (
                            <span key={name} className="tag tag-blue text-[10px]">
                              {v?.label || name}: {oldVal != null ? fmtNum(Number(oldVal)) : "?"} → {fmtNum(Number(newVal))}{v?.unit && v.unit !== "$" ? v.unit : ""}
                            </span>
                          );
                        })}
                      </div>
                    )}
                    {(whatif.parsed.unparseable_parts || []).length > 0 && (
                      <p className="text-[10px] text-yellow-400/50 flex items-start gap-1.5">
                        <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                        couldn&apos;t parse: {whatif.parsed.unparseable_parts.join(" · ")}
                      </p>
                    )}

                    {/* Delta cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-white/[0.05]">
                      <div className="bg-[var(--page-bg)] p-4">
                        <div className="text-[10px] text-white/25 uppercase tracking-wider mb-1.5">success probability</div>
                        <div className={cn("text-2xl font-bold flex items-center gap-1", dPP >= 0 ? "text-green-400" : "text-red-400")}>
                          {dPP >= 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                          {dPP >= 0 ? "+" : ""}{dPP.toFixed(1)}pp
                        </div>
                        <div className="text-[10px] text-white/25 mt-1">
                          {whatif.baseline.success_probability.toFixed(1)}% → {whatif.whatif.success_probability.toFixed(1)}%
                        </div>
                      </div>
                      <div className="bg-[var(--page-bg)] p-4">
                        <div className="text-[10px] text-white/25 uppercase tracking-wider mb-1.5">avg revenue</div>
                        <div className={cn("text-2xl font-bold", dRev >= 0 ? "text-green-400" : "text-red-400")}>
                          {dRev >= 0 ? "+" : "−"}{formatCurrency(Math.abs(dRev))}
                        </div>
                        <div className="text-[10px] text-white/25 mt-1">
                          {formatCurrency(whatif.baseline.avg_revenue)} → {formatCurrency(whatif.whatif.avg_revenue)}
                        </div>
                      </div>
                      <div className="bg-[var(--page-bg)] p-4">
                        <div className="text-[10px] text-white/25 uppercase tracking-wider mb-1.5">breakeven</div>
                        <div className={cn("text-2xl font-bold", dBE <= 0 ? "text-green-400" : "text-red-400")}>
                          {dBE >= 0 ? "+" : ""}{dBE.toFixed(1)} {timeUnit}
                        </div>
                        <div className="text-[10px] text-white/25 mt-1">
                          {whatif.baseline.avg_time_to_breakeven.toFixed(1)} → {whatif.whatif.avg_time_to_breakeven.toFixed(1)} {timeUnit}
                        </div>
                      </div>
                    </div>

                    {/* Verdict */}
                    {whatif.verdict && (
                      <blockquote className="border-l-2 border-violet-500/40 pl-4 py-1 text-sm text-white/60 italic leading-relaxed">
                        {whatif.verdict}
                      </blockquote>
                    )}
                  </div>
                );
              })()}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-violet-400" />
                Adjust Variables & Rerun
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {variables.map((v: any) => (
                <SliderWithInput
                  key={v.name}
                  label={v.label || v.name}
                  min={v.min ?? 0}
                  max={v.max ?? v.value * 3}
                  step={v.max > 10000 ? Math.max(1, Math.round(((v.max || v.value * 3) - (v.min || 0)) / 100)) : 1}
                  value={variableOverrides[v.name] ?? v.value}
                  onChange={(val) => setVariableOverrides(prev => ({ ...prev, [v.name]: val }))}
                  unit={v.unit || ""}
                  unitPosition={v.unit === "$" ? "prefix" : "suffix"}
                />
              ))}

              {/* Live preview */}
              <div className="p-5 bg-gradient-to-br from-violet-500/10 to-cyan-500/5 border border-violet-500/20">
                <div className="text-sm text-muted-foreground mb-1">Current Success Probability</div>
                <div className="text-4xl font-bold text-violet-400 mb-3">{successProb}%</div>
                <Progress value={successProb} />
                <p className="text-xs text-muted-foreground mt-2">
                  Adjust variables and click Rerun for a fresh Monte Carlo simulation.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <Button variant="gradient" className="flex-1" onClick={handleRerun} disabled={isRerunning}>
                  {isRerunning ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Running {simConfig.num_runs?.toLocaleString() || "1,000"} scenarios...</>
                  ) : (
                    <><Zap className="w-4 h-4" /> Rerun Simulation</>
                  )}
                </Button>
                {/* Save the current overrides as a new branch in the scenario tree */}
                <div className="flex gap-2 sm:w-auto">
                  <input
                    type="text"
                    value={branchLabel}
                    onChange={(e) => setBranchLabel(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSaveBranch()}
                    maxLength={40}
                    placeholder="branch label"
                    disabled={branching}
                    className="w-32 sm:w-36 border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-white/20"
                  />
                  <Button variant="glass" onClick={handleSaveBranch} disabled={branching}>
                    {branching ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitFork className="w-4 h-4" />} save as branch
                  </Button>
                </div>
              </div>
              {isRerunning && (
                <div className="mt-4">
                  <div className="flex justify-between text-[10px] text-white/30 mb-1.5">
                    <span>{rerunStage}</span>
                    <span>{rerunProgress}%</span>
                  </div>
                  <Progress value={rerunProgress} className="h-1" />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Counterfactual diff vs baseline — paired same-seed run over the
              direct slider overrides above. Complements the NL what-if. */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <GitCompareArrows className="w-4 h-4 text-cyan-400" />
                Diff vs Baseline
                <Badge variant="purple" className="ml-auto">same-seed</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <p className="text-xs text-white/30 leading-relaxed">
                runs your adjusted variables against the original baseline with the
                same base seed — so every difference below is signal, not noise.
              </p>

              <div className="flex items-center gap-3">
                <Button variant="gradient" size="sm" onClick={handleRunDiff} disabled={diffLoading}>
                  {diffLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitCompareArrows className="w-4 h-4" />}
                  {diffLoading ? "computing diff..." : "compute diff"}
                </Button>
                {diff && !diffLoading && (
                  <span className="text-[10px] text-white/25">
                    seed <span className="font-mono text-white/40">{diff.base_seed}</span>
                  </span>
                )}
              </div>

              {diffLoading && (
                <p className="text-xs text-white/30 flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  running baseline + counterfactual paired with the same seed — this can take a minute...
                </p>
              )}

              {diff && !diffLoading && (() => {
                const dPP = diff.deltas.success_probability_pp;
                const dRev = diff.deltas.avg_revenue;
                const dShare = diff.deltas.avg_market_share;
                const dBE = diff.deltas.avg_time_to_breakeven;
                const timeline = (diff.timeline_delta || []).map((p) => ({
                  month: `${timeUnit.charAt(0).toUpperCase()}${p.month}`,
                  baseline: p.baseline_revenue,
                  counterfactual: p.counterfactual_revenue,
                }));
                return (
                  <div className="space-y-5">
                    {/* Delta cards */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-white/[0.05]">
                      <div className="bg-[var(--page-bg)] p-4">
                        <div className="text-[10px] text-white/25 uppercase tracking-wider mb-1.5">success probability</div>
                        <div className={cn("text-2xl font-bold flex items-center gap-1", dPP >= 0 ? "text-green-400" : "text-red-400")}>
                          {dPP >= 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                          {dPP >= 0 ? "+" : ""}{dPP.toFixed(1)}pp
                        </div>
                        <div className="text-[10px] text-white/25 mt-1">
                          {diff.baseline.success_probability.toFixed(1)}% → {diff.counterfactual.success_probability.toFixed(1)}%
                        </div>
                      </div>
                      <div className="bg-[var(--page-bg)] p-4">
                        <div className="text-[10px] text-white/25 uppercase tracking-wider mb-1.5">avg {primaryLabel.toLowerCase()}</div>
                        <div className={cn("text-2xl font-bold", dRev >= 0 ? "text-green-400" : "text-red-400")}>
                          {dRev >= 0 ? "+" : "−"}{formatCurrency(Math.abs(dRev))}
                        </div>
                        <div className="text-[10px] text-white/25 mt-1">
                          {formatCurrency(diff.baseline.avg_revenue)} → {formatCurrency(diff.counterfactual.avg_revenue)}
                        </div>
                      </div>
                      <div className="bg-[var(--page-bg)] p-4">
                        <div className="text-[10px] text-white/25 uppercase tracking-wider mb-1.5">{tertiaryLabel.toLowerCase()}</div>
                        <div className={cn("text-2xl font-bold flex items-center gap-1", dShare >= 0 ? "text-green-400" : "text-red-400")}>
                          {dShare >= 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                          {dShare >= 0 ? "+" : ""}{dShare.toFixed(2)}%
                        </div>
                        <div className="text-[10px] text-white/25 mt-1">
                          {diff.baseline.avg_market_share.toFixed(2)}% → {diff.counterfactual.avg_market_share.toFixed(2)}%
                        </div>
                      </div>
                      <div className="bg-[var(--page-bg)] p-4">
                        <div className="text-[10px] text-white/25 uppercase tracking-wider mb-1.5">breakeven</div>
                        <div className={cn("text-2xl font-bold", dBE <= 0 ? "text-green-400" : "text-red-400")}>
                          {dBE >= 0 ? "+" : ""}{dBE.toFixed(1)} {timeUnit}
                        </div>
                        <div className="text-[10px] text-white/25 mt-1">
                          {diff.baseline.avg_time_to_breakeven.toFixed(1)} → {diff.counterfactual.avg_time_to_breakeven.toFixed(1)} {timeUnit}
                        </div>
                      </div>
                    </div>

                    {/* Overlaid baseline vs counterfactual revenue timeline */}
                    {timeline.length > 0 && (
                      <div>
                        <div className="text-[10px] text-white/25 uppercase tracking-wider mb-2">{primaryLabel.toLowerCase()} — baseline vs counterfactual</div>
                        <ResponsiveContainer width="100%" height={240}>
                          <AreaChart data={timeline} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                            <defs>
                              <linearGradient id="diffBaseGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#6b7280" stopOpacity={0.15} />
                                <stop offset="95%" stopColor="#6b7280" stopOpacity={0} />
                              </linearGradient>
                              <linearGradient id="diffCfGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.2} />
                                <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                            <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} tickFormatter={(v) => labels.formatPrimary(v)} />
                            <Tooltip
                              contentStyle={{ background: "var(--chart-tooltip-bg)", border: "1px solid var(--chart-tooltip-border)", borderRadius: 0, fontSize: 12 }}
                              formatter={(v: number, name: string) => [labels.formatPrimary(v), name === "counterfactual" ? "counterfactual" : "baseline"]}
                            />
                            <Area type="monotone" dataKey="baseline" stroke="#9ca3af" strokeWidth={1.5} fill="url(#diffBaseGrad)" strokeDasharray="4 2" />
                            <Area type="monotone" dataKey="counterfactual" stroke="#06b6d4" strokeWidth={2} fill="url(#diffCfGrad)" />
                          </AreaChart>
                        </ResponsiveContainer>
                        <div className="flex gap-6 mt-2 justify-center text-xs">
                          <div className="flex items-center gap-1.5"><div className="w-6 h-0.5 border-t-2 border-dashed border-gray-400" /><span className="text-muted-foreground">baseline</span></div>
                          <div className="flex items-center gap-1.5"><div className="w-6 h-0.5 bg-cyan-500" /><span className="text-muted-foreground">counterfactual</span></div>
                        </div>
                      </div>
                    )}

                    {/* Risk changes — appeared (red) / disappeared (green) */}
                    {((diff.risk_changes?.appeared?.length || 0) > 0 || (diff.risk_changes?.disappeared?.length || 0) > 0) && (
                      <div className="space-y-2">
                        <div className="text-[10px] text-white/25 uppercase tracking-wider">risk changes</div>
                        <div className="flex flex-wrap gap-1.5">
                          {(diff.risk_changes.appeared || []).map((r) => (
                            <span key={`a-${r.name}`} className="tag tag-red text-[10px] inline-flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" /> {r.name}
                            </span>
                          ))}
                          {(diff.risk_changes.disappeared || []).map((r) => (
                            <span key={`d-${r.name}`} className="tag tag-green text-[10px] inline-flex items-center gap-1">
                              <CheckCircle className="w-3 h-3" /> {r.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Plain-English attribution */}
                    {diff.explanation && (
                      <blockquote className="border-l-2 border-cyan-500/40 pl-4 py-1 text-sm text-white/60 italic leading-relaxed">
                        {diff.explanation}
                      </blockquote>
                    )}
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Calibrate Tab — fit engine variables to the user's historical data */}
        <TabsContent value="calibrate" className="space-y-6">
          <CalibratePanel
            simId={params.id}
            variables={(variables || []).map((v: any) => ({
              name: v.name,
              label: v.label || v.name,
              value: Number(v.value),
            }))}
            onApplied={(posteriors) => {
              // Reflect the fitted values locally so the rerun sliders + diff
              // baseline use the calibrated config without a full reload.
              setSimulation((prev: any) => {
                if (!prev?.config?.variables) return prev;
                const nextVars = prev.config.variables.map((v: any) =>
                  posteriors[v.name] != null ? { ...v, value: posteriors[v.name] } : v
                );
                return { ...prev, config: { ...prev.config, variables: nextVars } };
              });
              setVariableOverrides((prev) => ({ ...prev, ...posteriors }));
            }}
          />
        </TabsContent>

        {/* Sensitivity Tab */}
        <TabsContent value="sensitivity" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Gauge className="w-4 h-4 text-cyan-400" />
                Tornado Sensitivity Analysis
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <p className="text-xs text-white/30 leading-relaxed">
                each variable is pushed down and up by the selected delta while everything else holds
                at baseline — the wider the bar, the more that variable drives your outcome.
              </p>

              <div className="flex items-center gap-3">
                <span className="text-[10px] text-white/25 uppercase tracking-wider">delta</span>
                <div className="flex items-center gap-1 p-0.5 bg-white/[0.03] border border-white/[0.06]">
                  {[10, 20, 30].map((d) => (
                    <button
                      key={d}
                      onClick={() => setTornadoDelta(d)}
                      disabled={tornadoLoading}
                      className={cn(
                        "px-3 py-1 text-xs transition-all",
                        tornadoDelta === d ? "bg-white/10 text-white" : "text-white/30 hover:text-white/50"
                      )}
                    >
                      ±{d}%
                    </button>
                  ))}
                </div>
                <Button variant="gradient" size="sm" onClick={handleRunTornado} disabled={tornadoLoading}>
                  {tornadoLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                  {tornadoLoading ? "running..." : "run sensitivity analysis"}
                </Button>
              </div>

              {tornadoLoading && (
                <p className="text-xs text-white/30 flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  running 2 runs per variable with a shared seed — this can take a minute...
                </p>
              )}

              {tornado && !tornadoLoading && (() => {
                const baselinePct = tornado.baseline.success_probability * 100;
                const bars = tornado.bars.map((b) => ({
                  label: b.label || b.variable,
                  low: +(b.low_success * 100 - baselinePct).toFixed(2),
                  high: +(b.high_success * 100 - baselinePct).toFixed(2),
                  low_value: b.low_value,
                  high_value: b.high_value,
                }));
                const maxAbs = Math.ceil(Math.max(1, ...bars.map((b) => Math.max(Math.abs(b.low), Math.abs(b.high)))));
                return (
                  <div>
                    <div className="text-xs text-white/30 mb-3">
                      baseline: <span className="text-white/60">{baselinePct.toFixed(1)}% success</span> · {" "}
                      <span className="text-white/60">{formatCurrency(tornado.baseline.avg_revenue)} avg revenue</span> · {" "}
                      seed <span className="font-mono text-white/40">{tornado.base_seed}</span>
                    </div>
                    <ResponsiveContainer width="100%" height={Math.max(220, bars.length * 44 + 40)}>
                      <BarChart data={bars} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
                        <XAxis
                          type="number"
                          domain={[-maxAbs, maxAbs]}
                          tick={{ fontSize: 10, fill: "#6b7280" }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}pp`}
                        />
                        <YAxis
                          type="category"
                          dataKey="label"
                          tick={{ fontSize: 11, fill: "#9ca3af" }}
                          axisLine={false}
                          tickLine={false}
                          width={150}
                        />
                        <Tooltip
                          cursor={{ fill: "rgba(255,255,255,0.03)" }}
                          contentStyle={{ background: "var(--chart-tooltip-bg)", border: "1px solid var(--chart-tooltip-border)", borderRadius: 0, fontSize: 11 }}
                          formatter={(v: number, name: string, props: any) => {
                            const p = props?.payload;
                            const atVal = name === "low" ? p?.low_value : p?.high_value;
                            return [
                              `${v > 0 ? "+" : ""}${Number(v).toFixed(1)}pp at ${Number(atVal).toLocaleString()}`,
                              name === "low" ? `low (−${tornadoDelta}%)` : `high (+${tornadoDelta}%)`,
                            ];
                          }}
                        />
                        <ReferenceLine x={0} stroke="rgba(255,255,255,0.25)" strokeDasharray="4 2" label={{ value: "baseline", position: "top", fontSize: 9, fill: "#6b7280" }} />
                        <Bar dataKey="low" stackId="tornado" fill="#ef4444" opacity={0.75} barSize={18} />
                        <Bar dataKey="high" stackId="tornado" fill="#22c55e" opacity={0.75} barSize={18} />
                      </BarChart>
                    </ResponsiveContainer>
                    <div className="flex gap-6 mt-2 justify-center text-xs">
                      <div className="flex items-center gap-1.5"><div className="w-3 h-2 bg-red-500/75" /><span className="text-muted-foreground">variable −{tornadoDelta}%</span></div>
                      <div className="flex items-center gap-1.5"><div className="w-3 h-2 bg-green-500/75" /><span className="text-muted-foreground">variable +{tornadoDelta}%</span></div>
                    </div>
                  </div>
                );
              })()}

              {!tornado && !tornadoLoading && (
                <div className="flex items-center justify-center py-12 text-xs text-white/20">
                  run the analysis to see which variables move your success probability the most
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Agents Tab */}
        <TabsContent value="agents" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Users2 className="w-4 h-4 text-cyan-400" />
                  Agent Distribution
                </CardTitle>
              </CardHeader>
              <CardContent>
                {agentActivity.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={agentActivity} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={3} dataKey="value">
                        {agentActivity.map((entry: any, i: number) => (
                          <Cell key={i} fill={entry.color} opacity={0.85} />
                        ))}
                      </Pie>
                      <Legend wrapperStyle={{ fontSize: 12, color: "#6b7280" }} />
                      <Tooltip contentStyle={{ background: "var(--chart-tooltip-bg)", border: "1px solid var(--chart-tooltip-border)", borderRadius: "0", fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-[220px] text-xs text-white/20">No agent data available</div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Agent Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {(simConfig.agents || []).map((agent: any) => (
                  <div key={agent.id || agent.type} className="p-3 bg-white/5 border border-white/5">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-sm font-medium text-white">{agent.name || agent.type}</span>
                      <Badge variant="outline" className="text-xs ml-auto">{agent.count} agents</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Sensitivity: {(agent.sensitivity * 100).toFixed(0)}% · Type: {agent.type}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Secondary metric over time */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{secondaryLabel} Over Time</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={timelineData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <defs>
                    <linearGradient id="custGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "var(--chart-tooltip-bg)", border: "1px solid var(--chart-tooltip-border)", borderRadius: "0", fontSize: 12 }} />
                  <Area type="monotone" dataKey="customers" stroke="#06b6d4" strokeWidth={2} fill="url(#custGrad)" name={secondaryLabel} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* AI Insights Tab */}
        <TabsContent value="insights" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-yellow-400" />
                AI-Generated Insights
                <Badge variant="purple" className="ml-auto">Powered by Claude</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {keyInsights.map((insight: string, i: number) => (
                <div key={i} className="flex gap-3 p-4 bg-white/5 border border-white/5">
                  <div className="w-6 h-6 bg-violet-500/20 border border-violet-500/30 flex items-center justify-center flex-shrink-0 text-xs font-bold text-violet-400 mt-0.5">
                    {i + 1}
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">{insight}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Why Scenarios Succeed vs Fail</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 bg-green-500/10 border border-green-500/20">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  <span className="text-sm font-medium text-green-400">Success Pattern ({successProb}% of runs)</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {results.success_explanation || "Successful scenarios achieved target metrics within the simulation period."}
                </p>
              </div>
              <div className="p-4 bg-red-500/10 border border-red-500/20">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  <span className="text-sm font-medium text-red-400">Failure Pattern ({(100 - successProb).toFixed(0)}% of runs)</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {results.failure_explanation || "Failed scenarios did not meet the target criteria within the time horizon."}
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
