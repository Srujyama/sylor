"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  TrendingUp, Activity, Zap, BarChart2, Target, Loader2, ChevronRight,
} from "lucide-react";
import { onAuthChange } from "@/lib/firebase/auth";
import { getAnalyticsSummary } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import type { AnalyticsSummary } from "@/types";
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, LineChart, Line,
} from "recharts";
import { ChartDataTable } from "@/components/ui/chart-data-table";

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

const statusDotClass: Record<string, string> = {
  completed: "bg-emerald-400",
  running: "bg-blue-400",
  failed: "bg-red-400",
  draft: "bg-yellow-400",
};

function timeAgo(dateStr: string): string {
  const diffMin = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return `${diffD}d ago`;
  return `${Math.floor(diffD / 30)}mo ago`;
}

export default function AnalyticsPage() {
  const { toast } = useToast();
  const [userId, setUserId] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthChange((user) => {
      if (user?.uid) setUserId(user.uid);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  const fetchData = useCallback(async () => {
    if (!userId) return;
    try {
      const data = await getAnalyticsSummary();
      setSummary(data);
    } catch (err: any) {
      toast({ title: "failed to load analytics", description: err.message || "check your connection and try again", variant: "error" });
    } finally {
      setLoading(false);
    }
  }, [userId, toast]);

  useEffect(() => {
    if (!authReady || !userId) {
      if (authReady) setLoading(false); // not logged in → stop spinner
      return;
    }
    fetchData();
  }, [authReady, userId, fetchData]);

  if (loading) {
    return (
      <div className="p-8">
        <div className="mb-8">
          <p className="text-xs text-white/25 mb-1">sylor / analytics</p>
          <h1 className="text-2xl font-bold text-white">analytics</h1>
        </div>
        <div className="flex items-center justify-center py-32">
          <Loader2 className="w-6 h-6 animate-spin text-white/20" />
        </div>
      </div>
    );
  }

  const totals = summary?.totals;
  const byCategory = (summary?.by_category || []).map((c) => ({
    ...c,
    avg_success: Math.round(c.avg_success),
    fill: categoryColors[c.category] || "rgba(148,163,184,0.7)",
  }));
  const trend = (summary?.success_trend || []).map((t) => ({
    ...t,
    avg_success: Math.round(t.avg_success * 10) / 10,
    label: new Date(`${t.date}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
  }));
  const recent = summary?.recent || [];
  const totalRuns = totals?.total_runs || 0;

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <p className="text-xs text-white/25 mb-1 tracking-wide">sylor / analytics</p>
        <h1 className="text-2xl font-bold text-white tracking-tight">analytics</h1>
        <p className="text-xs text-white/30 mt-1">performance insights across all your simulations</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-white/[0.05] mb-8">
        {[
          { label: "total simulations", value: totals?.simulations ?? 0, icon: Activity },
          { label: "completed", value: totals?.completed ?? 0, icon: Target },
          { label: "total monte carlo runs", value: totalRuns > 1000 ? `${(totalRuns / 1000).toFixed(1)}k` : totalRuns, icon: Zap },
          { label: "avg success rate", value: `${Math.round(totals?.avg_success_rate ?? 0)}%`, icon: TrendingUp },
        ].map((stat) => (
          <div key={stat.label} className="bg-[var(--page-bg)] p-5">
            <div className="flex items-center gap-2 mb-2">
              <stat.icon className="w-3.5 h-3.5 text-white/20" />
              <span className="text-[10px] text-white/25 uppercase tracking-wider">{stat.label}</span>
            </div>
            <div className="text-2xl font-bold text-white">{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-white/[0.05] mb-8">
        {/* Success rate by category */}
        <div className="bg-[var(--page-bg)] p-5">
          <div className="text-xs text-white/25 mb-4 tracking-widest uppercase">success rate by category</div>
          {byCategory.length > 0 ? (
            <div role="img" aria-label="Bar chart: average success rate by category">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={byCategory} layout="vertical" margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: "var(--chart-text)" }} axisLine={false} tickLine={false} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <YAxis type="category" dataKey="category" tick={{ fontSize: 10, fill: "var(--chart-text-strong)" }} axisLine={false} tickLine={false} width={70} />
                <Tooltip
                  contentStyle={{ background: "var(--chart-tooltip-bg)", border: "1px solid var(--chart-tooltip-border)", fontSize: 11 }}
                  formatter={(v: number, _n: string, props: any) => [`${v}% across ${props?.payload?.count ?? "?"} sims`, "avg success"]}
                />
                <Bar dataKey="avg_success" radius={[0, 2, 2, 0]}>
                  {byCategory.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <ChartDataTable
              caption="Average success rate by category"
              data={byCategory}
              columns={[
                { key: "category", value: (row) => row.category },
                { key: "avg success (%)", value: (row) => row.avg_success },
                { key: "simulations", value: (row) => row.count },
              ]}
            />
            </div>
          ) : (
            <div className="flex items-center justify-center h-[220px] text-xs text-white/20">
              complete some simulations to see category insights
            </div>
          )}
        </div>

        {/* 30-day success trend */}
        <div className="bg-[var(--page-bg)] p-5">
          <div className="text-xs text-white/25 mb-4 tracking-widest uppercase">success trend — last 30 days</div>
          {trend.length > 1 ? (
            <div role="img" aria-label="Line chart: average success rate over the last 30 days">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trend} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--chart-text)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "var(--chart-text)" }} axisLine={false} tickLine={false} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <Tooltip
                  contentStyle={{ background: "var(--chart-tooltip-bg)", border: "1px solid var(--chart-tooltip-border)", fontSize: 11 }}
                  formatter={(v: number, _n: string, props: any) => [`${v}% across ${props?.payload?.count ?? "?"} sims`, "avg success"]}
                />
                <Line type="monotone" dataKey="avg_success" stroke="rgba(74,222,128,0.7)" strokeWidth={2} dot={{ r: 2, fill: "rgba(74,222,128,0.7)" }} name="avg success" />
              </LineChart>
            </ResponsiveContainer>
            <ChartDataTable
              caption="Average success rate over the last 30 days"
              data={trend}
              columns={[
                { key: "date", value: (row) => row.label },
                { key: "avg success (%)", value: (row) => row.avg_success },
                { key: "simulations", value: (row) => row.count },
              ]}
            />
            </div>
          ) : (
            <div className="flex items-center justify-center h-[220px] text-xs text-white/20">
              run more simulations to see your 30-day trend
            </div>
          )}
        </div>
      </div>

      {/* Recent activity */}
      <div className="surface">
        <div className="px-5 py-3 border-b border-white/[0.06]">
          <span className="text-xs text-white/25 tracking-widest uppercase">recent activity</span>
        </div>
        {recent.length > 0 ? (
          <div>
            {recent.map((sim, i) => (
              <Link
                key={sim.id}
                href={`/simulations/${sim.id}`}
                className={`flex items-center gap-4 px-5 py-3 hover:bg-white/[0.025] transition-colors group ${
                  i < recent.length - 1 ? "border-b border-white/[0.04]" : ""
                }`}
              >
                <div className={`w-2 h-2 shrink-0 ${statusDotClass[sim.status] || "bg-white/20"}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-white/70 truncate group-hover:text-white transition-colors">{sim.name}</div>
                  <div className="text-[10px] text-white/20 mt-0.5">{sim.category} · {timeAgo(sim.updated_at)}</div>
                </div>
                {sim.success_probability != null && (
                  <div className="flex items-center gap-2">
                    <div className="progress-bar w-20">
                      <div className="progress-fill" style={{ width: `${Math.round(sim.success_probability)}%` }} />
                    </div>
                    <span className="text-xs font-mono text-white/50 w-8 text-right">
                      {Math.round(sim.success_probability)}%
                    </span>
                  </div>
                )}
                <ChevronRight className="w-3 h-3 text-white/10 group-hover:text-white/30" />
              </Link>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16">
            <BarChart2 className="w-5 h-5 text-white/10 mb-3" />
            <p className="text-xs text-white/20 mb-4">no simulations yet — run your first one to see analytics</p>
            <Link href="/simulations/new" className="btn-primary text-xs py-2 px-4">
              new simulation
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
