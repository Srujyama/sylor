"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Loader2,
  AlertTriangle,
  ArrowLeft,
  BarChart2,
  Check,
  TrendingUp,
  Shield,
  Lightbulb,
  DollarSign,
} from "lucide-react";
import { onAuthChange } from "@/lib/firebase/auth";
import { listSimulations, compareSimulations } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

const categoryColors: Record<string, string> = {
  startup: "rgba(139,92,246,0.7)",
  finance: "rgba(6,182,212,0.7)",
  biology: "rgba(34,197,94,0.7)",
  trend: "rgba(234,179,8,0.7)",
  pricing: "rgba(249,115,22,0.7)",
  marketing: "rgba(236,72,153,0.7)",
  policy: "rgba(99,102,241,0.7)",
  product: "rgba(168,85,247,0.7)",
  custom: "rgba(148,163,184,0.7)",
};

const barColors = [
  "rgba(139,92,246,0.7)",
  "rgba(6,182,212,0.7)",
  "rgba(34,197,94,0.7)",
  "rgba(234,179,8,0.7)",
  "rgba(249,115,22,0.7)",
];

const severityColor: Record<string, string> = {
  low: "text-emerald-400/70",
  medium: "text-yellow-400/70",
  high: "text-orange-400/70",
  critical: "text-red-400/70",
};

const severityBg: Record<string, string> = {
  low: "bg-emerald-400/10 border-emerald-400/20",
  medium: "bg-yellow-400/10 border-yellow-400/20",
  high: "bg-orange-400/10 border-orange-400/20",
  critical: "bg-red-400/10 border-red-400/20",
};

interface ComparisonItem {
  id: string;
  name: string;
  category: string;
  status: string;
  success_probability: number;
  avg_revenue: number;
  avg_market_share: number;
  confidence_interval: [number, number];
  risk_factors: Array<{
    name: string;
    severity: string;
    probability: number;
    description: string;
    mitigation?: string;
  }>;
  key_insights: string[];
}

interface SimOption {
  id: string;
  name: string;
  category: string;
  status: string;
}

export default function ComparisonPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [userId, setUserId] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Comparison data
  const [comparisons, setComparisons] = useState<ComparisonItem[]>([]);

  // Selector state (when no IDs in URL)
  const [selectorMode, setSelectorMode] = useState(false);
  const [allSimulations, setAllSimulations] = useState<SimOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loadingSims, setLoadingSims] = useState(false);

  useEffect(() => {
    const unsub = onAuthChange((user) => {
      if (user?.uid) setUserId(user.uid);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  const ids = searchParams.get("ids");

  // Load comparison data when IDs are present
  const fetchComparison = useCallback(async () => {
    if (!ids) return;
    const idList = ids.split(",").filter(Boolean);
    if (idList.length < 2) {
      setError("At least 2 simulation IDs are required for comparison.");
      setLoading(false);
      return;
    }
    if (idList.length > 5) {
      setError("Maximum 5 simulations can be compared at once.");
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const data = await compareSimulations(idList);
      setComparisons(data.comparisons || []);
      // Mark the "compare two sims" activation step as done (Wave J).
      try { localStorage.setItem("sylor-compared", "1"); } catch {}
    } catch (err: any) {
      setError(err.message || "Failed to load comparison data.");
    } finally {
      setLoading(false);
    }
  }, [ids]);

  // Load all simulations for selector mode
  const fetchAllSimulations = useCallback(async () => {
    if (!userId) return;
    setLoadingSims(true);
    try {
      const data = await listSimulations(userId);
      const mapped: SimOption[] = data
        .filter((s: any) => s.status === "completed")
        .map((s: any) => ({
          id: s.id,
          name: s.name,
          category: s.category,
          status: s.status,
        }));
      setAllSimulations(mapped);
    } catch {
      setError("Failed to load simulations.");
    } finally {
      setLoadingSims(false);
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!authReady) return;
    if (!userId) {
      setLoading(false);
      return;
    }
    const idList = ids ? ids.split(",").filter(Boolean) : [];
    if (idList.length >= 2) {
      setSelectorMode(false);
      fetchComparison();
    } else {
      // fewer than 2 ids — open the selector with any provided ids preselected
      if (idList.length > 0) {
        setSelectedIds((prev) => new Set([...Array.from(prev), ...idList]));
      }
      setSelectorMode(true);
      fetchAllSimulations();
    }
  }, [authReady, userId, ids, fetchComparison, fetchAllSimulations]);

  function toggleSelection(simId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(simId)) {
        next.delete(simId);
      } else if (next.size < 5) {
        next.add(simId);
      }
      return next;
    });
  }

  function startComparison() {
    if (selectedIds.size < 2) return;
    const idsStr = Array.from(selectedIds).join(",");
    router.push(`/simulations/compare?ids=${idsStr}`);
  }

  // Chart data for success probability comparison
  const successChartData = comparisons.map((c) => ({
    name: c.name.length > 20 ? c.name.slice(0, 20) + "..." : c.name,
    success: c.success_probability,
    fill: categoryColors[c.category] || "rgba(148,163,184,0.7)",
  }));

  // Revenue chart data
  const revenueChartData = comparisons.map((c) => ({
    name: c.name.length > 20 ? c.name.slice(0, 20) + "..." : c.name,
    revenue: c.avg_revenue,
    fill: categoryColors[c.category] || "rgba(148,163,184,0.7)",
  }));

  // Loading state
  if (loading) {
    return (
      <div className="p-8">
        <div className="mb-8">
          <p className="text-xs text-white/25 mb-1 tracking-wide">
            sylor / simulations / compare
          </p>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            compare simulations
          </h1>
        </div>
        <div className="flex items-center justify-center py-32">
          <Loader2 className="w-6 h-6 animate-spin text-white/20" />
        </div>
      </div>
    );
  }

  // Error state
  if (error && !selectorMode) {
    return (
      <div className="p-8">
        <div className="mb-8">
          <p className="text-xs text-white/25 mb-1 tracking-wide">
            sylor / simulations / compare
          </p>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            compare simulations
          </h1>
        </div>
        <div className="flex flex-col items-center justify-center py-32">
          <AlertTriangle className="w-5 h-5 text-red-400/50 mb-3" />
          <div className="text-xs text-red-400/70 mb-2">{error}</div>
          <Link
            href="/simulations/compare"
            className="text-xs text-white/40 hover:text-white/70 border border-white/10 px-3 py-1.5 transition-colors"
          >
            select simulations
          </Link>
        </div>
      </div>
    );
  }

  // Selector mode: pick simulations to compare
  if (selectorMode) {
    return (
      <div className="p-8">
        <div className="mb-8">
          <p className="text-xs text-white/25 mb-1 tracking-wide">
            sylor / simulations / compare
          </p>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            compare simulations
          </h1>
          <p className="text-xs text-white/30 mt-1">
            select 2-5 completed simulations to compare side by side
          </p>
        </div>

        {/* Selection action bar */}
        <div className="flex items-center justify-between mb-6">
          <div className="text-xs text-white/30">
            {selectedIds.size} of 5 selected
          </div>
          <button
            onClick={startComparison}
            disabled={selectedIds.size < 2}
            className={`text-xs py-2 px-4 inline-flex items-center gap-1.5 transition-colors ${
              selectedIds.size >= 2
                ? "btn-primary"
                : "border border-white/[0.06] text-white/15 cursor-not-allowed"
            }`}
          >
            <BarChart2 className="w-3 h-3" />
            compare ({selectedIds.size})
          </button>
        </div>

        {/* Simulations list */}
        <div className="surface">
          {loadingSims ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-5 h-5 animate-spin text-white/20" />
            </div>
          ) : allSimulations.length === 0 ? (
            <div className="px-5 py-16 text-center">
              <div className="text-white/20 mb-1 text-sm">
                no completed simulations
              </div>
              <div className="text-[10px] text-white/10 mb-6">
                run some simulations first to compare results
              </div>
              <Link
                href="/simulations/new"
                className="btn-primary text-xs py-2 px-4 inline-flex items-center gap-1.5"
              >
                new simulation
              </Link>
            </div>
          ) : (
            allSimulations.map((sim, i) => {
              const isSelected = selectedIds.has(sim.id);
              const isDisabled = !isSelected && selectedIds.size >= 5;
              return (
                <button
                  key={sim.id}
                  onClick={() => !isDisabled && toggleSelection(sim.id)}
                  className={`w-full flex items-center gap-4 px-5 py-3.5 transition-colors text-left ${
                    i < allSimulations.length - 1
                      ? "border-b border-white/[0.04]"
                      : ""
                  } ${
                    isSelected
                      ? "bg-white/[0.04]"
                      : isDisabled
                      ? "opacity-30 cursor-not-allowed"
                      : "hover:bg-white/[0.025]"
                  }`}
                >
                  <div
                    className={`w-4 h-4 border flex items-center justify-center shrink-0 ${
                      isSelected
                        ? "border-violet-400/60 bg-violet-400/20"
                        : "border-white/10"
                    }`}
                  >
                    {isSelected && (
                      <Check className="w-2.5 h-2.5 text-violet-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-white/80 truncate">
                      {sim.name}
                    </div>
                  </div>
                  <span className="tag shrink-0">{sim.category}</span>
                </button>
              );
            })
          )}
        </div>
      </div>
    );
  }

  // Comparison results view
  const bestSim = comparisons.reduce((best, c) =>
    c.success_probability > best.success_probability ? c : best
  );

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <p className="text-xs text-white/25 mb-1 tracking-wide">
          sylor / simulations / compare
        </p>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">
              compare simulations
            </h1>
            <p className="text-xs text-white/30 mt-1">
              comparing {comparisons.length} simulations side by side
            </p>
          </div>
          <Link
            href="/simulations/compare"
            className="text-xs text-white/30 hover:text-white/60 border border-white/[0.06] px-3 py-1.5 inline-flex items-center gap-1.5 transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
            change selection
          </Link>
        </div>
      </div>

      {/* Simulation header cards */}
      <div
        className="grid gap-px bg-white/[0.05] mb-8"
        style={{
          gridTemplateColumns: `repeat(${comparisons.length}, minmax(0, 1fr))`,
        }}
      >
        {comparisons.map((c, i) => (
          <div key={c.id} className="bg-[var(--page-bg)] p-5">
            <div className="flex items-center gap-2 mb-2">
              <div
                className="w-2 h-2"
                style={{ backgroundColor: barColors[i] }}
              />
              <span className="tag text-[10px]">{c.category}</span>
              {c.id === bestSim.id && (
                <span className="tag tag-green text-[10px]">best</span>
              )}
            </div>
            <div className="text-sm font-medium text-white/80 truncate mb-1">
              {c.name}
            </div>
            <div className="text-3xl font-bold text-white">
              {Math.round(c.success_probability)}%
            </div>
            <div className="text-[10px] text-white/20 mt-0.5">
              success probability
            </div>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-white/[0.05] mb-8">
        {/* Success probability bar chart */}
        <div className="bg-[var(--page-bg)] p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-3.5 h-3.5 text-white/20" />
            <span className="text-xs text-white/25 tracking-widest uppercase">
              success probability
            </span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={successChartData}
              margin={{ top: 5, right: 10, left: -20, bottom: 5 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--chart-grid)"
                vertical={false}
              />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 9, fill: "var(--chart-text)" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "var(--chart-text)" }}
                axisLine={false}
                tickLine={false}
                domain={[0, 100]}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--chart-tooltip-bg)",
                  border: "1px solid var(--chart-tooltip-border)",
                  fontSize: 11,
                }}
                formatter={(v: number) => [`${v.toFixed(1)}%`, "Success"]}
              />
              <Bar dataKey="success" radius={[2, 2, 0, 0]}>
                {successChartData.map((entry, i) => (
                  <Cell key={i} fill={barColors[i]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Revenue bar chart */}
        <div className="bg-[var(--page-bg)] p-5">
          <div className="flex items-center gap-2 mb-4">
            <DollarSign className="w-3.5 h-3.5 text-white/20" />
            <span className="text-xs text-white/25 tracking-widest uppercase">
              avg revenue
            </span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={revenueChartData}
              margin={{ top: 5, right: 10, left: -10, bottom: 5 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--chart-grid)"
                vertical={false}
              />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 9, fill: "var(--chart-text)" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "var(--chart-text)" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => formatCurrency(v)}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--chart-tooltip-bg)",
                  border: "1px solid var(--chart-tooltip-border)",
                  fontSize: 11,
                }}
                formatter={(v: number) => [formatCurrency(v), "Avg Revenue"]}
              />
              <Bar dataKey="revenue" radius={[2, 2, 0, 0]}>
                {revenueChartData.map((entry, i) => (
                  <Cell key={i} fill={barColors[i]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Metrics comparison table */}
      <div className="bg-white/[0.05] mb-8">
        <div className="bg-[var(--page-bg)] p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart2 className="w-3.5 h-3.5 text-white/20" />
            <span className="text-xs text-white/25 tracking-widest uppercase">
              metrics comparison
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <th className="text-left text-[10px] text-white/20 uppercase tracking-wider py-2.5 pr-4 font-normal">
                    metric
                  </th>
                  {comparisons.map((c, i) => (
                    <th
                      key={c.id}
                      className="text-right text-[10px] text-white/20 uppercase tracking-wider py-2.5 px-4 font-normal"
                    >
                      <div className="flex items-center justify-end gap-1.5">
                        <div
                          className="w-1.5 h-1.5"
                          style={{ backgroundColor: barColors[i] }}
                        />
                        <span className="truncate max-w-[120px]">
                          {c.name}
                        </span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-white/[0.04]">
                  <td className="text-white/40 py-2.5 pr-4">
                    success probability
                  </td>
                  {comparisons.map((c) => (
                    <td
                      key={c.id}
                      className={`text-right py-2.5 px-4 font-mono ${
                        c.id === bestSim.id
                          ? "text-emerald-400/80"
                          : "text-white/60"
                      }`}
                    >
                      {c.success_probability.toFixed(1)}%
                    </td>
                  ))}
                </tr>
                <tr className="border-b border-white/[0.04]">
                  <td className="text-white/40 py-2.5 pr-4">avg revenue</td>
                  {comparisons.map((c) => (
                    <td
                      key={c.id}
                      className="text-right text-white/60 py-2.5 px-4 font-mono"
                    >
                      {formatCurrency(c.avg_revenue)}
                    </td>
                  ))}
                </tr>
                <tr className="border-b border-white/[0.04]">
                  <td className="text-white/40 py-2.5 pr-4">
                    avg market share
                  </td>
                  {comparisons.map((c) => (
                    <td
                      key={c.id}
                      className="text-right text-white/60 py-2.5 px-4 font-mono"
                    >
                      {c.avg_market_share.toFixed(1)}%
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="text-white/40 py-2.5 pr-4">
                    confidence interval
                  </td>
                  {comparisons.map((c) => (
                    <td
                      key={c.id}
                      className="text-right text-white/60 py-2.5 px-4 font-mono"
                    >
                      {c.confidence_interval?.[0]}% - {c.confidence_interval?.[1]}%
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Risk factors side by side */}
      <div className="bg-white/[0.05] mb-8">
        <div className="bg-[var(--page-bg)] p-5">
          <div className="flex items-center gap-2 mb-4">
            <Shield className="w-3.5 h-3.5 text-white/20" />
            <span className="text-xs text-white/25 tracking-widest uppercase">
              risk factors
            </span>
          </div>
          <div
            className="grid gap-px bg-white/[0.05]"
            style={{
              gridTemplateColumns: `repeat(${comparisons.length}, minmax(0, 1fr))`,
            }}
          >
            {comparisons.map((c, colIdx) => (
              <div key={c.id} className="bg-[var(--page-bg)] p-4">
                <div className="flex items-center gap-1.5 mb-3">
                  <div
                    className="w-1.5 h-1.5"
                    style={{ backgroundColor: barColors[colIdx] }}
                  />
                  <span className="text-[10px] text-white/30 truncate">
                    {c.name}
                  </span>
                </div>
                {c.risk_factors && c.risk_factors.length > 0 ? (
                  <div className="space-y-2">
                    {c.risk_factors.map((rf, ri) => (
                      <div
                        key={ri}
                        className={`p-2.5 border ${
                          severityBg[rf.severity] ||
                          "bg-white/[0.02] border-white/[0.06]"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-medium text-white/60">
                            {rf.name}
                          </span>
                          <span
                            className={`text-[10px] uppercase tracking-wider ${
                              severityColor[rf.severity] || "text-white/30"
                            }`}
                          >
                            {rf.severity}
                          </span>
                        </div>
                        <div className="text-[10px] text-white/25 leading-relaxed">
                          {rf.description}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[10px] text-white/15 py-4 text-center">
                    no risk factors
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Key insights side by side */}
      <div className="bg-white/[0.05]">
        <div className="bg-[var(--page-bg)] p-5">
          <div className="flex items-center gap-2 mb-4">
            <Lightbulb className="w-3.5 h-3.5 text-white/20" />
            <span className="text-xs text-white/25 tracking-widest uppercase">
              key insights
            </span>
          </div>
          <div
            className="grid gap-px bg-white/[0.05]"
            style={{
              gridTemplateColumns: `repeat(${comparisons.length}, minmax(0, 1fr))`,
            }}
          >
            {comparisons.map((c, colIdx) => (
              <div key={c.id} className="bg-[var(--page-bg)] p-4">
                <div className="flex items-center gap-1.5 mb-3">
                  <div
                    className="w-1.5 h-1.5"
                    style={{ backgroundColor: barColors[colIdx] }}
                  />
                  <span className="text-[10px] text-white/30 truncate">
                    {c.name}
                  </span>
                </div>
                {c.key_insights && c.key_insights.length > 0 ? (
                  <ul className="space-y-2">
                    {c.key_insights.map((insight, ii) => (
                      <li
                        key={ii}
                        className="text-[10px] text-white/40 leading-relaxed flex gap-2"
                      >
                        <span className="text-white/10 shrink-0 mt-0.5">
                          {ii + 1}.
                        </span>
                        <span>{insight}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-[10px] text-white/15 py-4 text-center">
                    no insights
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
