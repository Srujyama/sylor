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
  Share2, FileJson, FileSpreadsheet, Clock,
} from "lucide-react";
import Link from "next/link";
import { cn, formatCurrency, getApiUrl } from "@/lib/utils";
import { exportToCSV, exportToJSON } from "@/lib/api";
import { getDomainLabels } from "@/lib/domain-labels";
import { useToast } from "@/components/ui/toast";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, Legend,
} from "recharts";

const severityColor = {
  low: { badge: "success" as const, icon: CheckCircle, color: "text-green-400" },
  medium: { badge: "warning" as const, icon: AlertTriangle, color: "text-yellow-400" },
  high: { badge: "destructive" as const, icon: AlertTriangle, color: "text-red-400" },
  critical: { badge: "destructive" as const, icon: AlertTriangle, color: "text-red-500" },
};

const OUTCOME_COLORS = ["#ef4444", "#f97316", "#eab308", "#84cc16", "#22c55e", "#06b6d4"];

export default function SimulationDetailPage({ params }: { params: { id: string } }) {
  const { toast } = useToast();
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

  function handleShare() {
    const url = window.location.href;
    navigator.clipboard.writeText(url);
    toast({ title: "Link copied to clipboard", variant: "success" });
  }

  // Fetch simulation data
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;

    async function fetchData() {
      try {
        const res = await fetch(`${getApiUrl()}/api/simulations/${params.id}`);
        if (!res.ok) throw new Error("Simulation not found");
        const sim = await res.json();
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
          // Animate progress bar while polling
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
              const r = await fetch(`${getApiUrl()}/api/simulations/${params.id}/results`);
              const data = await r.json();
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

  const [rerunProgress, setRerunProgress] = useState(0);
  const [rerunStage, setRerunStage] = useState("");

  async function handleRerun() {
    setIsRerunning(true);
    setRerunProgress(0);
    setRerunStage("Starting rerun...");
    try {
      await fetch(`${getApiUrl()}/api/simulations/${params.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ num_runs: simulation?.config?.num_runs || 1000, variable_overrides: variableOverrides }),
      });
      toast({ title: "Rerun started", description: "Running simulation with updated parameters..." });

      // Animate progress while polling
      const rerunStages = [
        { at: 600,   pct: 15, label: "Applying variable overrides..." },
        { at: 2500,  pct: 35, label: "Running Monte Carlo scenarios..." },
        { at: 5000,  pct: 55, label: "Computing new distributions..." },
        { at: 8000,  pct: 72, label: "Generating updated insights..." },
        { at: 12000, pct: 88, label: "Finalizing results..." },
      ];
      const timers: NodeJS.Timeout[] = [];
      rerunStages.forEach(({ at, pct, label }) => {
        const t = setTimeout(() => { setRerunProgress(pct); setRerunStage(label); }, at);
        timers.push(t);
      });

      const poll = setInterval(async () => {
        const r = await fetch(`${getApiUrl()}/api/simulations/${params.id}/results`);
        const data = await r.json();
        if (data.status === "completed") {
          timers.forEach(clearTimeout);
          setRerunProgress(100);
          setRerunStage("Done!");
          setResults(data.results);
          setSimulation((prev: any) => ({ ...prev, status: "completed", results: data.results }));
          setIsRerunning(false);
          clearInterval(poll);
          toast({ title: "Rerun complete", description: `Success probability: ${Math.round(data.results.success_probability)}%`, variant: "success" });
        } else if (data.status === "failed") {
          timers.forEach(clearTimeout);
          setIsRerunning(false);
          clearInterval(poll);
          toast({ title: "Rerun failed", description: "The simulation encountered an error", variant: "error" });
        }
      }, 2000);
    } catch (err: any) {
      setIsRerunning(false);
      toast({ title: "Rerun failed", description: err.message || "Could not start rerun", variant: "error" });
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
      <div className="flex items-start justify-between mb-8">
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
        <div className="flex gap-2">
          <Button variant="glass" size="sm" onClick={handleShare}><Share2 className="w-4 h-4" /> Share</Button>
          <div className="relative">
            <Button variant="glass" size="sm" onClick={() => setShowExportMenu(!showExportMenu)}>
              <Download className="w-4 h-4" /> Export
            </Button>
            {showExportMenu && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-[#111] border border-white/10 py-1 min-w-[160px]">
                <button onClick={handleExportCSV} className="w-full text-left px-3 py-2 text-xs text-white/60 hover:bg-white/[0.05] hover:text-white flex items-center gap-2">
                  <FileSpreadsheet className="w-3 h-3" /> Export as CSV
                </button>
                <button onClick={handleExportJSON} className="w-full text-left px-3 py-2 text-xs text-white/60 hover:bg-white/[0.05] hover:text-white flex items-center gap-2">
                  <FileJson className="w-3 h-3" /> Export as JSON
                </button>
              </div>
            )}
          </div>
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
        <TabsList className="mb-6">
          <TabsTrigger value="results">Results</TabsTrigger>
          <TabsTrigger value="what-if">What-If</TabsTrigger>
          <TabsTrigger value="agents">Agents</TabsTrigger>
          <TabsTrigger value="insights">AI Insights</TabsTrigger>
        </TabsList>

        {/* Results Tab */}
        <TabsContent value="results" className="space-y-6">
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
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false}
                    tickFormatter={(v) => labels.formatPrimary(v)} />
                  <Tooltip
                    contentStyle={{ background: "rgba(0,0,0,0.85)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "0", fontSize: 12, fontFamily: "inherit" }}
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
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="range" tick={{ fontSize: 9, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                    <Tooltip
                      contentStyle={{ background: "rgba(0,0,0,0.85)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "0", fontSize: 12 }}
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
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false}
                      tickFormatter={(v) => labels.formatSecondary(v)} />
                    <Tooltip contentStyle={{ background: "rgba(0,0,0,0.85)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "0", fontSize: 12 }} />
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

        {/* What-If Tab */}
        <TabsContent value="what-if" className="space-y-6">
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

              <Button variant="gradient" className="w-full" onClick={handleRerun} disabled={isRerunning}>
                {isRerunning ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Running {simConfig.num_runs?.toLocaleString() || "1,000"} scenarios...</>
                ) : (
                  <><Zap className="w-4 h-4" /> Rerun Simulation</>
                )}
              </Button>
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
                      <Tooltip contentStyle={{ background: "rgba(0,0,0,0.85)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "0", fontSize: 12 }} />
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
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "rgba(0,0,0,0.85)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "0", fontSize: 12 }} />
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
