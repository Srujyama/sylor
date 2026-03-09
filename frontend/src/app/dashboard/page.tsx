"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus, ArrowRight, TrendingUp, Activity, Zap, Clock, Loader2,
  BarChart2, Trash2, Copy, RotateCcw, Search, Filter,
} from "lucide-react";
import { onAuthChange } from "@/lib/firebase/auth";
import { getApiUrl, formatCurrency } from "@/lib/utils";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
} from "recharts";
import type { Simulation, SimulationCategory } from "@/types";

const statusDot: Record<string, string> = {
  completed: "dot-green",
  running: "dot-blue",
  failed: "dot-red",
  draft: "dot-yellow",
};

const statusLabel: Record<string, string> = {
  completed: "completed",
  running: "running",
  failed: "failed",
  draft: "draft",
};

const statusTagClass: Record<string, string> = {
  completed: "tag-green",
  running: "tag-blue",
  failed: "tag-red",
  draft: "tag-yellow",
};

const categoryLabels: Record<string, string> = {
  startup: "startup",
  pricing: "pricing",
  policy: "policy",
  marketing: "marketing",
  product: "product",
  finance: "finance",
  biology: "biology",
  trend: "trend",
  custom: "custom",
};

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return `${diffD}d ago`;
  return `${Math.floor(diffD / 30)}mo ago`;
}

export default function DashboardPage() {
  const router = useRouter();
  const [userName, setUserName] = useState("there");
  const [userId, setUserId] = useState("demo-user");
  const [simulations, setSimulations] = useState<Simulation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  useEffect(() => {
    const unsubscribe = onAuthChange((user) => {
      if (user?.displayName) {
        setUserName(user.displayName.split(" ")[0]);
      } else if (user?.email) {
        setUserName(user.email.split("@")[0]);
      }
      if (user?.uid) {
        setUserId(user.uid);
      }
    });
    return () => unsubscribe();
  }, []);

  const fetchSimulations = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch(`${getApiUrl()}/api/simulations?user_id=${userId}`);
      if (!res.ok) throw new Error("Failed to fetch simulations");
      const data = await res.json();
      // Map snake_case to camelCase
      const mapped: Simulation[] = data.map((s: any) => ({
        id: s.id,
        userId: s.user_id,
        name: s.name,
        description: s.description,
        category: s.category,
        config: s.config,
        status: s.status,
        results: s.results ? {
          successProbability: s.results.success_probability,
          confidenceInterval: s.results.confidence_interval,
          avgRevenue: s.results.avg_revenue,
          avgMarketShare: s.results.avg_market_share,
          avgTimeToBreakeven: s.results.avg_breakeven_month,
          riskFactors: s.results.risk_factors,
          keyInsights: s.results.key_insights,
          outcomeDistribution: s.results.outcome_distribution,
          timelineAggregated: s.results.timeline_aggregated,
          competitorReactions: s.results.competitor_reactions,
        } : undefined,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
        runCount: s.run_count,
      }));
      setSimulations(mapped.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchSimulations();
    // Poll for running simulations
    const interval = setInterval(fetchSimulations, 8000);
    return () => clearInterval(interval);
  }, [fetchSimulations]);

  // Computed stats
  const completedSims = simulations.filter((s) => s.status === "completed");
  const avgSuccess = completedSims.length > 0
    ? Math.round(completedSims.reduce((acc, s) => acc + (s.results?.successProbability ?? 0), 0) / completedSims.length)
    : 0;
  const totalRuns = simulations.reduce((acc, s) => acc + (s.runCount || 0), 0);
  const runningSims = simulations.filter((s) => s.status === "running").length;

  // Category breakdown for chart
  const categoryData = Object.entries(
    simulations.reduce<Record<string, number>>((acc, s) => {
      acc[s.category] = (acc[s.category] || 0) + 1;
      return acc;
    }, {})
  ).map(([category, count]) => ({ category: categoryLabels[category] || category, count }))
   .sort((a, b) => b.count - a.count);

  // Filter + search
  const filtered = simulations.filter((s) => {
    if (filterStatus !== "all" && s.status !== filterStatus) return false;
    if (searchQuery && !s.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const stats = [
    { label: "total simulations", value: String(simulations.length), delta: `${completedSims.length} completed`, icon: Activity },
    { label: "avg success rate", value: completedSims.length > 0 ? `${avgSuccess}%` : "—", delta: completedSims.length > 0 ? `across ${completedSims.length} simulations` : "no completed sims yet", icon: TrendingUp },
    { label: "total runs", value: totalRuns > 1000 ? `${(totalRuns / 1000).toFixed(1)}k` : String(totalRuns), delta: runningSims > 0 ? `${runningSims} running now` : "all idle", icon: Zap },
    { label: "categories used", value: String(new Set(simulations.map((s) => s.category)).size), delta: `of 9 available`, icon: BarChart2 },
  ];

  // Greeting based on time
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "good morning" : hour < 18 ? "good afternoon" : "good evening";

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-10">
        <div>
          <p className="text-xs text-white/25 mb-1 tracking-wide">sylor / dashboard</p>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            {greeting}, {userName}
          </h1>
        </div>
        <Link href="/simulations/new" className="btn-primary text-xs py-2 px-4 inline-flex items-center gap-1.5">
          <Plus className="w-3 h-3" />
          new simulation
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-white/[0.05] mb-8">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-[#0a0a0a] p-5">
            {loading ? (
              <>
                <div className="h-7 w-16 bg-white/[0.04] animate-pulse mb-1" />
                <div className="h-3 w-24 bg-white/[0.04] animate-pulse mb-0.5" />
                <div className="h-3 w-20 bg-white/[0.04] animate-pulse" />
              </>
            ) : (
              <>
                <div className="text-2xl font-bold text-white tracking-tight mb-1">{stat.value}</div>
                <div className="text-xs text-white/30 mb-0.5">{stat.label}</div>
                <div className="text-xs text-emerald-400/70">{stat.delta}</div>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-px bg-white/[0.05] mb-8">
        {/* Category breakdown chart */}
        <div className="bg-[#0a0a0a] p-5 lg:col-span-2">
          <div className="text-xs text-white/25 mb-4 tracking-widest uppercase">simulations by category</div>
          {categoryData.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={categoryData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="category" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.25)", fontFamily: "inherit" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.25)", fontFamily: "inherit" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: "#111",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "0",
                    fontSize: 11,
                    fontFamily: "inherit",
                  }}
                  labelStyle={{ color: "rgba(255,255,255,0.7)" }}
                  itemStyle={{ color: "rgba(255,255,255,0.5)" }}
                />
                <Bar dataKey="count" name="simulations" fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.3)" strokeWidth={1}>
                  {categoryData.map((_, i) => (
                    <Cell key={i} fill={i === 0 ? "rgba(74,222,128,0.2)" : "rgba(255,255,255,0.08)"} stroke={i === 0 ? "rgba(74,222,128,0.5)" : "rgba(255,255,255,0.15)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[180px] text-xs text-white/20">
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin text-white/20" />
              ) : (
                "no simulations yet — create your first one"
              )}
            </div>
          )}
        </div>

        {/* Quick start */}
        <div className="bg-[#0a0a0a] p-5">
          <div className="text-xs text-white/25 mb-4 tracking-widest uppercase">quick start</div>
          <div className="space-y-0.5">
            {[
              { label: "startup launch", href: "/simulations/new?template=startup" },
              { label: "pricing strategy", href: "/simulations/new?template=pricing" },
              { label: "stock market forecast", href: "/simulations/new?template=finance" },
              { label: "molecular dynamics", href: "/simulations/new?template=biology" },
              { label: "trend analyzer", href: "/simulations/new?template=trend" },
              { label: "custom simulation", href: "/simulations/new" },
            ].map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="flex items-center justify-between px-3 py-2.5 text-xs text-white/40 hover:text-white/80 hover:bg-white/[0.03] transition-colors group"
              >
                <span>{item.label}</span>
                <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Simulations list */}
      <div className="surface">
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06]">
          <span className="text-xs text-white/25 tracking-widest uppercase">
            {filterStatus === "all" ? "all simulations" : `${filterStatus} simulations`}
            {!loading && <span className="ml-2 text-white/15">({filtered.length})</span>}
          </span>
          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="relative">
              <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-white/20" />
              <input
                type="text"
                placeholder="search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-transparent border border-white/[0.06] text-xs text-white/60 pl-7 pr-3 py-1.5 w-40 focus:outline-none focus:border-white/15 placeholder:text-white/15"
              />
            </div>
            {/* Status filter */}
            <div className="flex items-center gap-1">
              {["all", "completed", "running", "failed", "draft"].map((s) => (
                <button
                  key={s}
                  onClick={() => setFilterStatus(s)}
                  className={`text-[10px] px-2 py-1 border transition-colors ${
                    filterStatus === s
                      ? "border-white/20 text-white/60 bg-white/[0.05]"
                      : "border-transparent text-white/20 hover:text-white/40"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          {loading ? (
            // Loading skeletons
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={`flex items-center gap-4 px-5 py-3.5 ${i < 3 ? "border-b border-white/[0.04]" : ""}`}>
                <div className="w-2 h-2 bg-white/[0.06] animate-pulse shrink-0" />
                <div className="flex-1">
                  <div className="h-3 w-48 bg-white/[0.04] animate-pulse mb-1.5" />
                  <div className="h-2.5 w-24 bg-white/[0.04] animate-pulse" />
                </div>
                <div className="h-4 w-16 bg-white/[0.04] animate-pulse" />
                <div className="h-4 w-16 bg-white/[0.04] animate-pulse" />
              </div>
            ))
          ) : error ? (
            <div className="px-5 py-12 text-center">
              <div className="text-xs text-red-400/70 mb-2">failed to load simulations</div>
              <div className="text-[10px] text-white/20 mb-4">{error}</div>
              <button onClick={fetchSimulations} className="text-xs text-white/40 hover:text-white/70 border border-white/10 px-3 py-1.5 transition-colors">
                <RotateCcw className="w-3 h-3 inline mr-1.5" /> retry
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-5 py-16 text-center">
              {simulations.length === 0 ? (
                <>
                  <div className="text-white/20 mb-1 text-sm">no simulations yet</div>
                  <div className="text-[10px] text-white/10 mb-6">create your first simulation to get started</div>
                  <Link
                    href="/simulations/new"
                    className="btn-primary text-xs py-2 px-4 inline-flex items-center gap-1.5"
                  >
                    <Plus className="w-3 h-3" /> new simulation
                  </Link>
                </>
              ) : (
                <>
                  <div className="text-white/20 mb-1 text-sm">no matches</div>
                  <div className="text-[10px] text-white/10">try a different search or filter</div>
                </>
              )}
            </div>
          ) : (
            filtered.map((sim, i) => (
              <Link
                key={sim.id}
                href={`/simulations/${sim.id}`}
                className={`flex items-center gap-4 px-5 py-3.5 hover:bg-white/[0.025] transition-colors group ${
                  i < filtered.length - 1 ? "border-b border-white/[0.04]" : ""
                }`}
              >
                <span className={`dot ${statusDot[sim.status] || "dot-yellow"} shrink-0`} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-white/80 truncate group-hover:text-white transition-colors">
                    {sim.name}
                  </div>
                  <div className="text-xs text-white/25 mt-0.5">{timeAgo(sim.updatedAt)}</div>
                </div>
                <span className={`tag ${statusTagClass[sim.status] || "tag-yellow"} shrink-0`}>
                  {statusLabel[sim.status] || sim.status}
                  {sim.status === "running" && <Loader2 className="w-2.5 h-2.5 animate-spin inline ml-1" />}
                </span>
                <span className="tag shrink-0">{categoryLabels[sim.category] || sim.category}</span>
                {sim.results?.successProbability != null && (
                  <div className="flex items-center gap-2 w-24 shrink-0">
                    <div className="progress-bar flex-1">
                      <div
                        className="progress-fill"
                        style={{ width: `${Math.round(sim.results.successProbability)}%` }}
                      />
                    </div>
                    <span className="text-xs text-white/35 w-7 text-right">
                      {Math.round(sim.results.successProbability)}%
                    </span>
                  </div>
                )}
                {sim.runCount > 0 && (
                  <span className="text-[10px] text-white/15 w-12 text-right shrink-0">
                    {sim.runCount} run{sim.runCount !== 1 ? "s" : ""}
                  </span>
                )}
                <ArrowRight className="w-3 h-3 text-white/20 group-hover:text-white/50 transition-colors shrink-0" />
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
