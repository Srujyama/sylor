"use client";

export const dynamic = 'force-dynamic';

import { useState, useEffect } from "react";
import Link from "next/link";
import { Loader2, ArrowRight, Lightbulb, TrendingUp, BarChart3, Link2 } from "lucide-react";
import { getSharedSimulation } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { SharedSnapshot } from "@/types";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
} from "recharts";

const OUTCOME_COLORS = ["#ef4444", "#f97316", "#eab308", "#84cc16", "#22c55e", "#06b6d4"];

export default function SharedSimulationPage({ params }: { params: { shareId: string } }) {
  const [snapshot, setSnapshot] = useState<SharedSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSharedSimulation(params.shareId)
      .then((data) => { if (!cancelled) setSnapshot(data); })
      .catch(() => { if (!cancelled) setNotFound(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [params.shareId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-5 h-5 animate-spin text-white/20" />
      </div>
    );
  }

  if (notFound || !snapshot) {
    return (
      <div className="flex items-center justify-center min-h-screen p-8">
        <div className="text-center max-w-sm">
          <Link2 className="w-6 h-6 text-white/15 mx-auto mb-5" />
          <h1 className="text-lg font-bold text-white mb-2">link not found</h1>
          <p className="text-xs text-white/30 mb-8 leading-relaxed">
            this share link has been revoked or never existed. shared snapshots are
            frozen at share time and can be revoked by their owner at any point.
          </p>
          <Link href="/signup" className="btn-primary text-xs py-2 px-4 inline-flex items-center gap-1.5">
            run your own simulation <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </div>
    );
  }

  const dm = snapshot.domain_metadata as Record<string, any> | null;
  const primaryLabel = (dm?.primary_metric_label || "revenue").toLowerCase();
  const timeUnit = (dm?.time_unit || "month").toLowerCase();
  const ciLow = snapshot.confidence_interval?.[0] ?? 0;
  const ciHigh = snapshot.confidence_interval?.[1] ?? 0;

  const timeline = (snapshot.timeline || []).map((t) => ({
    month: `${timeUnit.charAt(0).toUpperCase()}${t.month}`,
    p10: t.p10Revenue,
    p50: t.avgRevenue,
    p90: t.p90Revenue,
  }));

  const distribution = (snapshot.outcome_distribution || []).map((d, i) => ({
    range: d.range,
    probability: d.probability,
    color: OUTCOME_COLORS[i % OUTCOME_COLORS.length],
  }));

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="flex items-center justify-between mb-10">
        <Link href="/" className="text-sm font-bold tracking-tight text-white/80 hover:text-white transition-colors">
          sylor
        </Link>
        <span className="text-[10px] text-white/20 uppercase tracking-widest">shared simulation snapshot</span>
      </div>

      <div className="mb-10">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-2xl font-bold text-white tracking-tight">{snapshot.name}</h1>
          <span className="tag">{snapshot.category}</span>
        </div>
        <p className="text-xs text-white/25">
          frozen snapshot · shared {formatDate(snapshot.created_at)}
        </p>
      </div>

      {/* Hero metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-white/[0.05] mb-10">
        <div className="bg-[var(--page-bg)] p-8">
          <div className="text-[10px] text-white/25 uppercase tracking-widest mb-3">success probability</div>
          <div className="text-6xl font-bold text-emerald-400 tracking-tight mb-2">
            {Math.round(snapshot.success_probability)}%
          </div>
          <div className="text-xs text-white/30">
            95% confidence: {ciLow.toFixed(1)}% — {ciHigh.toFixed(1)}%
          </div>
        </div>
        <div className="bg-[var(--page-bg)] p-8">
          <div className="text-[10px] text-white/25 uppercase tracking-widest mb-3">avg {primaryLabel}</div>
          <div className="text-6xl font-bold text-cyan-400 tracking-tight mb-2">
            {formatCurrency(snapshot.avg_revenue)}
          </div>
          <div className="text-xs text-white/30">median across all monte carlo runs</div>
        </div>
      </div>

      {/* Revenue timeline with p10/p90 band */}
      {timeline.length > 0 && (
        <div className="surface p-6 mb-6">
          <div className="text-xs text-white/25 mb-5 tracking-widest uppercase flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5" /> {primaryLabel} projection — p10 / median / p90
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={timeline} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <defs>
                <linearGradient id="shareBand" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.18} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="shareMedian" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} tickFormatter={(v) => formatCurrency(v)} />
              <Tooltip
                contentStyle={{ background: "var(--chart-tooltip-bg)", border: "1px solid var(--chart-tooltip-border)", borderRadius: 0, fontSize: 12 }}
                formatter={(v: number, name: string) => [formatCurrency(v), name === "p90" ? "best 10%" : name === "p50" ? "median" : "worst 10%"]}
              />
              <Area type="monotone" dataKey="p90" stroke="#8b5cf6" strokeWidth={1.5} fill="url(#shareBand)" strokeDasharray="4 2" />
              <Area type="monotone" dataKey="p50" stroke="#06b6d4" strokeWidth={2} fill="url(#shareMedian)" />
              <Area type="monotone" dataKey="p10" stroke="#ef4444" strokeWidth={1.5} fill="none" strokeDasharray="4 2" />
            </AreaChart>
          </ResponsiveContainer>
          <div className="flex gap-6 mt-3 justify-center text-[10px] text-white/30">
            <div className="flex items-center gap-1.5"><div className="w-5 h-0.5 border-t-2 border-dashed border-violet-500" />best 10%</div>
            <div className="flex items-center gap-1.5"><div className="w-5 h-0.5 bg-cyan-500" />median</div>
            <div className="flex items-center gap-1.5"><div className="w-5 h-0.5 border-t-2 border-dashed border-red-500" />worst 10%</div>
          </div>
        </div>
      )}

      {/* Outcome distribution */}
      {distribution.length > 0 && (
        <div className="surface p-6 mb-6">
          <div className="text-xs text-white/25 mb-5 tracking-widest uppercase flex items-center gap-2">
            <BarChart3 className="w-3.5 h-3.5" /> outcome distribution
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={distribution} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey="range" tick={{ fontSize: 9, fill: "#6b7280" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
              <Tooltip
                contentStyle={{ background: "var(--chart-tooltip-bg)", border: "1px solid var(--chart-tooltip-border)", borderRadius: 0, fontSize: 12 }}
                formatter={(v: number) => [`${v}%`, "probability"]}
              />
              <Bar dataKey="probability" radius={[2, 2, 0, 0]}>
                {distribution.map((entry, i) => (
                  <Cell key={i} fill={entry.color} opacity={0.8} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Key insights */}
      {(snapshot.key_insights || []).length > 0 && (
        <div className="surface p-6 mb-12">
          <div className="text-xs text-white/25 mb-5 tracking-widest uppercase flex items-center gap-2">
            <Lightbulb className="w-3.5 h-3.5" /> key insights
          </div>
          <div className="space-y-3">
            {snapshot.key_insights.map((insight, i) => (
              <div key={i} className="flex gap-3 p-4 bg-white/[0.03] border border-white/[0.05]">
                <div className="w-5 h-5 bg-violet-500/20 border border-violet-500/30 flex items-center justify-center shrink-0 text-[10px] font-bold text-violet-400 mt-0.5">
                  {i + 1}
                </div>
                <p className="text-sm text-white/50 leading-relaxed">{insight}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer + CTA */}
      <div className="border-t border-white/[0.06] pt-10 text-center">
        <p className="text-xs text-white/25 mb-4">simulated with sylor — ai-powered monte carlo simulations</p>
        <Link href="/signup" className="btn-primary text-xs py-2.5 px-5 inline-flex items-center gap-1.5">
          run your own simulation <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
    </div>
  );
}
