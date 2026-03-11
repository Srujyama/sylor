"use client";

export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Plus, Search, Loader2, ArrowRight, RotateCcw, Trash2, Copy,
} from "lucide-react";
import { listSimulations, duplicateSimulation as duplicateSimApi, deleteSimulation as deleteSimApi } from "@/lib/api";
import { onAuthChange } from "@/lib/firebase/auth";
import { useToast } from "@/components/ui/toast";
import type { Simulation } from "@/types";

const statusDot: Record<string, string> = {
  completed: "dot-green",
  running: "dot-blue",
  failed: "dot-red",
  draft: "dot-yellow",
};

const statusTagClass: Record<string, string> = {
  completed: "tag-green",
  running: "tag-blue",
  failed: "tag-red",
  draft: "tag-yellow",
};

const categoryLabels: Record<string, string> = {
  startup: "startup", pricing: "pricing", policy: "policy", marketing: "marketing",
  product: "product", finance: "finance", biology: "biology", trend: "trend", custom: "custom",
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

export default function SimulationsPage() {
  const { toast } = useToast();
  const [userId, setUserId] = useState("demo-user");
  const [simulations, setSimulations] = useState<Simulation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    const unsubscribe = onAuthChange((user) => {
      if (user?.uid) setUserId(user.uid);
    });
    return () => unsubscribe();
  }, []);

  const fetchSimulations = useCallback(async () => {
    try {
      setError(null);
      const data = await listSimulations(userId);
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
    const interval = setInterval(fetchSimulations, 8000);
    return () => clearInterval(interval);
  }, [fetchSimulations]);

  async function handleDuplicate(e: React.MouseEvent, simId: string) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await duplicateSimApi(simId);
      toast({ title: "Simulation duplicated", variant: "success" });
      fetchSimulations();
    } catch {
      toast({ title: "Failed to duplicate", variant: "error" });
    }
  }

  async function handleDelete(e: React.MouseEvent, simId: string) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await deleteSimApi(simId);
      setSimulations((prev) => prev.filter((s) => s.id !== simId));
      toast({ title: "Simulation deleted" });
    } catch {
      toast({ title: "Failed to delete", variant: "error" });
    }
  }

  const filtered = simulations.filter((s) => {
    if (filter !== "all" && s.status !== filter) return false;
    if (search && !s.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const statusCounts = simulations.reduce<Record<string, number>>((acc, s) => {
    acc[s.status] = (acc[s.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <p className="text-xs text-white/25 mb-1 tracking-wide">sylor / simulations</p>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            all simulations
          </h1>
          {!loading && (
            <p className="text-xs text-white/25 mt-1">
              {simulations.length} total
              {statusCounts.completed ? ` · ${statusCounts.completed} completed` : ""}
              {statusCounts.running ? ` · ${statusCounts.running} running` : ""}
            </p>
          )}
        </div>
        <Link href="/simulations/new" className="btn-primary text-xs py-2 px-4 inline-flex items-center gap-1.5">
          <Plus className="w-3 h-3" />
          new simulation
        </Link>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-white/20" />
          <input
            type="text"
            placeholder="search simulations..."
            className="w-full bg-transparent border border-white/[0.06] text-xs text-white/60 pl-7 pr-3 py-2 focus:outline-none focus:border-white/15 placeholder:text-white/15"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1">
          {["all", "completed", "running", "draft", "failed"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-[10px] px-2.5 py-1.5 border transition-colors ${
                filter === f
                  ? "border-white/20 text-white/60 bg-white/[0.05]"
                  : "border-transparent text-white/20 hover:text-white/40"
              }`}
            >
              {f}
              {f !== "all" && statusCounts[f] ? ` (${statusCounts[f]})` : ""}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="surface">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={`flex items-center gap-4 px-5 py-4 ${i < 4 ? "border-b border-white/[0.04]" : ""}`}>
              <div className="w-2 h-2 bg-white/[0.06] animate-pulse shrink-0" />
              <div className="flex-1">
                <div className="h-3.5 w-52 bg-white/[0.04] animate-pulse mb-1.5" />
                <div className="h-2.5 w-32 bg-white/[0.04] animate-pulse" />
              </div>
              <div className="h-4 w-16 bg-white/[0.04] animate-pulse" />
            </div>
          ))
        ) : error ? (
          <div className="px-5 py-16 text-center">
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
                <Link href="/simulations/new" className="btn-primary text-xs py-2 px-4 inline-flex items-center gap-1.5">
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
                <div className="flex items-center gap-3 text-[10px] text-white/20 mt-0.5">
                  <span>{timeAgo(sim.updatedAt)}</span>
                  {sim.runCount > 0 && <span>{sim.runCount} run{sim.runCount !== 1 ? "s" : ""}</span>}
                  {sim.description && <span className="truncate max-w-[200px]">{sim.description}</span>}
                </div>
              </div>
              <span className={`tag ${statusTagClass[sim.status] || "tag-yellow"} shrink-0`}>
                {sim.status}
                {sim.status === "running" && <Loader2 className="w-2.5 h-2.5 animate-spin inline ml-1" />}
              </span>
              <span className="tag shrink-0">{categoryLabels[sim.category] || sim.category}</span>
              {sim.results?.successProbability != null && (
                <div className="flex items-center gap-2 w-24 shrink-0">
                  <div className="progress-bar flex-1">
                    <div className="progress-fill" style={{ width: `${Math.round(sim.results.successProbability)}%` }} />
                  </div>
                  <span className="text-xs text-white/35 w-7 text-right">
                    {Math.round(sim.results.successProbability)}%
                  </span>
                </div>
              )}
              {/* Action buttons */}
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button
                  onClick={(e) => handleDuplicate(e, sim.id)}
                  className="p-1.5 text-white/20 hover:text-white/60 hover:bg-white/[0.05] transition-colors"
                  title="Duplicate"
                >
                  <Copy className="w-3 h-3" />
                </button>
                <button
                  onClick={(e) => handleDelete(e, sim.id)}
                  className="p-1.5 text-white/20 hover:text-red-400/60 hover:bg-red-400/[0.05] transition-colors"
                  title="Delete"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
              <ArrowRight className="w-3 h-3 text-white/20 group-hover:text-white/50 transition-colors shrink-0" />
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
