"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  TrendingUp, Activity, Zap, BarChart2, Clock, Target, Brain,
  ArrowUpRight, ArrowDownRight, Loader2, ChevronRight,
} from "lucide-react";
import { onAuthChange } from "@/lib/firebase/auth";
import { listSimulations } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, PieChart, Pie, LineChart, Line, Legend,
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

interface SimData {
  id: string;
  name: string;
  category: string;
  status: string;
  results?: any;
  created_at: string;
  updated_at: string;
  run_count: number;
  config?: any;
}

export default function AnalyticsPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [simulations, setSimulations] = useState<SimData[]>([]);
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
      const data = await listSimulations(userId);
      setSimulations(data);
    } catch {} finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!authReady || !userId) {
      if (authReady) setLoading(false); // not logged in → stop spinner
      return;
    }
    fetchData();
  }, [authReady, userId, fetchData]);

  const completed = simulations.filter((s) => s.status === "completed");
  const totalRuns = simulations.reduce((acc, s) => acc + (s.run_count || 0), 0);
  const avgSuccess = completed.length > 0
    ? completed.reduce((acc, s) => acc + (s.results?.success_probability || 0), 0) / completed.length
    : 0;

  // Best performing simulation
  const bestSim = completed.length > 0
    ? completed.reduce((best, s) => (s.results?.success_probability || 0) > (best.results?.success_probability || 0) ? s : best)
    : null;

  // Category distribution
  const categoryBreakdown = Object.entries(
    simulations.reduce<Record<string, number>>((acc, s) => {
      acc[s.category] = (acc[s.category] || 0) + 1;
      return acc;
    }, {})
  ).map(([name, value]) => ({
    name,
    value,
    fill: categoryColors[name] || "rgba(148,163,184,0.7)",
  })).sort((a, b) => b.value - a.value);

  // Success rate by category
  const successByCategory = Object.entries(
    completed.reduce<Record<string, { total: number; sum: number }>>((acc, s) => {
      if (!acc[s.category]) acc[s.category] = { total: 0, sum: 0 };
      acc[s.category].total++;
      acc[s.category].sum += s.results?.success_probability || 0;
      return acc;
    }, {})
  ).map(([category, data]) => ({
    category,
    avgSuccess: Math.round(data.sum / data.total),
    count: data.total,
    fill: categoryColors[category] || "rgba(148,163,184,0.7)",
  })).sort((a, b) => b.avgSuccess - a.avgSuccess);

  // Status distribution
  const statusBreakdown = Object.entries(
    simulations.reduce<Record<string, number>>((acc, s) => {
      acc[s.status] = (acc[s.status] || 0) + 1;
      return acc;
    }, {})
  ).map(([name, value]) => ({ name, value }));

  // Simulations over time (by day)
  const timelineData = simulations
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .reduce<Array<{ date: string; count: number; cumulative: number }>>((acc, s) => {
      const date = new Date(s.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const last = acc[acc.length - 1];
      if (last && last.date === date) {
        last.count++;
        last.cumulative++;
      } else {
        acc.push({ date, count: 1, cumulative: (last?.cumulative || 0) + 1 });
      }
      return acc;
    }, []);

  // Success distribution histogram
  const successHistogram = completed.reduce<Record<string, number>>((acc, s) => {
    const prob = s.results?.success_probability || 0;
    const bucket = prob < 20 ? "0-20%" : prob < 40 ? "20-40%" : prob < 60 ? "40-60%" : prob < 80 ? "60-80%" : "80-100%";
    acc[bucket] = (acc[bucket] || 0) + 1;
    return acc;
  }, {});
  const histogramData = ["0-20%", "20-40%", "40-60%", "60-80%", "80-100%"].map((range) => ({
    range,
    count: successHistogram[range] || 0,
  }));

  // Top simulations
  const topSimulations = [...completed]
    .sort((a, b) => (b.results?.success_probability || 0) - (a.results?.success_probability || 0))
    .slice(0, 5);

  const statusDotClass: Record<string, string> = {
    completed: "bg-emerald-400",
    running: "bg-blue-400",
    failed: "bg-red-400",
    draft: "bg-yellow-400",
  };

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

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <p className="text-xs text-white/25 mb-1 tracking-wide">sylor / analytics</p>
        <h1 className="text-2xl font-bold text-white tracking-tight">analytics</h1>
        <p className="text-xs text-white/30 mt-1">performance insights across all your simulations</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-px bg-white/[0.05] mb-8">
        {[
          { label: "total simulations", value: simulations.length, icon: Activity },
          { label: "completed", value: completed.length, icon: Target },
          { label: "total monte carlo runs", value: totalRuns > 1000 ? `${(totalRuns / 1000).toFixed(1)}k` : totalRuns, icon: Zap },
          { label: "avg success rate", value: `${Math.round(avgSuccess)}%`, icon: TrendingUp },
          { label: "categories used", value: categoryBreakdown.length, icon: BarChart2 },
        ].map((stat) => (
          <div key={stat.label} className="bg-[#0a0a0a] p-5">
            <div className="flex items-center gap-2 mb-2">
              <stat.icon className="w-3.5 h-3.5 text-white/20" />
              <span className="text-[10px] text-white/25 uppercase tracking-wider">{stat.label}</span>
            </div>
            <div className="text-2xl font-bold text-white">{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-white/[0.05] mb-8">
        {/* Growth over time */}
        <div className="bg-[#0a0a0a] p-5">
          <div className="text-xs text-white/25 mb-4 tracking-widest uppercase">simulation growth</div>
          {timelineData.length > 1 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={timelineData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="growthGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="rgba(139,92,246,0.3)" />
                    <stop offset="95%" stopColor="rgba(139,92,246,0)" />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.25)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.25)" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "#111", border: "1px solid rgba(255,255,255,0.1)", fontSize: 11 }} />
                <Area type="monotone" dataKey="cumulative" stroke="rgba(139,92,246,0.7)" strokeWidth={2} fill="url(#growthGrad)" name="Total" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[220px] text-xs text-white/20">
              run more simulations to see growth trends
            </div>
          )}
        </div>

        {/* Success rate by category */}
        <div className="bg-[#0a0a0a] p-5">
          <div className="text-xs text-white/25 mb-4 tracking-widest uppercase">success rate by category</div>
          {successByCategory.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={successByCategory} layout="vertical" margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.25)" }} axisLine={false} tickLine={false} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <YAxis type="category" dataKey="category" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.4)" }} axisLine={false} tickLine={false} width={70} />
                <Tooltip contentStyle={{ background: "#111", border: "1px solid rgba(255,255,255,0.1)", fontSize: 11 }} formatter={(v: number) => [`${v}%`, "Avg Success"]} />
                <Bar dataKey="avgSuccess" radius={[0, 2, 2, 0]}>
                  {successByCategory.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[220px] text-xs text-white/20">
              complete some simulations to see category insights
            </div>
          )}
        </div>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-px bg-white/[0.05] mb-8">
        {/* Category pie */}
        <div className="bg-[#0a0a0a] p-5">
          <div className="text-xs text-white/25 mb-4 tracking-widest uppercase">category distribution</div>
          {categoryBreakdown.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={categoryBreakdown} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} dataKey="value">
                  {categoryBreakdown.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: "#111", border: "1px solid rgba(255,255,255,0.1)", fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[200px] text-xs text-white/20">no data</div>
          )}
        </div>

        {/* Success distribution */}
        <div className="bg-[#0a0a0a] p-5">
          <div className="text-xs text-white/25 mb-4 tracking-widest uppercase">success probability distribution</div>
          {completed.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={histogramData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                <XAxis dataKey="range" tick={{ fontSize: 9, fill: "rgba(255,255,255,0.25)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.25)" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "#111", border: "1px solid rgba(255,255,255,0.1)", fontSize: 11 }} />
                <Bar dataKey="count" fill="rgba(74,222,128,0.3)" stroke="rgba(74,222,128,0.6)" strokeWidth={1} radius={[2, 2, 0, 0]} name="Simulations" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[200px] text-xs text-white/20">no completed simulations</div>
          )}
        </div>

        {/* Status breakdown */}
        <div className="bg-[#0a0a0a] p-5">
          <div className="text-xs text-white/25 mb-4 tracking-widest uppercase">status overview</div>
          <div className="space-y-3">
            {statusBreakdown.map((s) => (
              <div key={s.name} className="flex items-center gap-3">
                <div className={`w-2 h-2 ${statusDotClass[s.name] || "bg-white/20"}`} />
                <span className="text-xs text-white/40 flex-1">{s.name}</span>
                <span className="text-sm font-bold text-white">{s.value}</span>
                <div className="w-20 h-1.5 bg-white/[0.05]">
                  <div
                    className={`h-full ${statusDotClass[s.name] || "bg-white/20"}`}
                    style={{ width: `${(s.value / simulations.length) * 100}%`, opacity: 0.6 }}
                  />
                </div>
              </div>
            ))}
          </div>
          {simulations.length === 0 && (
            <div className="flex items-center justify-center h-[140px] text-xs text-white/20">no simulations</div>
          )}
        </div>
      </div>

      {/* Top simulations + Best performer */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-px bg-white/[0.05]">
        {/* Top simulations */}
        <div className="bg-[#0a0a0a] p-5 lg:col-span-2">
          <div className="text-xs text-white/25 mb-4 tracking-widest uppercase">top performing simulations</div>
          {topSimulations.length > 0 ? (
            <div className="space-y-0">
              {topSimulations.map((sim, i) => (
                <Link
                  key={sim.id}
                  href={`/simulations/${sim.id}`}
                  className="flex items-center gap-4 py-3 px-2 hover:bg-white/[0.025] transition-colors group border-b border-white/[0.04] last:border-0"
                >
                  <span className="text-xs text-white/15 w-4 text-right font-mono">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-white/70 truncate group-hover:text-white">{sim.name}</div>
                    <div className="text-[10px] text-white/20 mt-0.5">{sim.category} · {sim.run_count} runs</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="progress-bar w-20">
                      <div className="progress-fill" style={{ width: `${Math.round(sim.results?.success_probability || 0)}%` }} />
                    </div>
                    <span className="text-xs font-mono text-white/50 w-8 text-right">
                      {Math.round(sim.results?.success_probability || 0)}%
                    </span>
                  </div>
                  <ChevronRight className="w-3 h-3 text-white/10 group-hover:text-white/30" />
                </Link>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center py-12 text-xs text-white/20">
              complete simulations to see rankings
            </div>
          )}
        </div>

        {/* Best performer highlight */}
        <div className="bg-[#0a0a0a] p-5">
          <div className="text-xs text-white/25 mb-4 tracking-widest uppercase">best performer</div>
          {bestSim ? (
            <Link href={`/simulations/${bestSim.id}`} className="block group">
              <div className="p-4 border border-emerald-500/20 bg-emerald-500/[0.03] hover:bg-emerald-500/[0.06] transition-colors">
                <div className="flex items-center gap-2 mb-3">
                  <Target className="w-4 h-4 text-emerald-400" />
                  <span className="tag tag-green text-[10px]">{bestSim.category}</span>
                </div>
                <div className="text-sm font-medium text-white/80 mb-1 group-hover:text-white truncate">
                  {bestSim.name}
                </div>
                <div className="text-3xl font-bold text-emerald-400 mb-2">
                  {Math.round(bestSim.results?.success_probability || 0)}%
                </div>
                <div className="text-[10px] text-white/20">success probability</div>
                <div className="mt-3 space-y-1.5">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-white/25">runs</span>
                    <span className="text-white/40">{bestSim.run_count?.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span className="text-white/25">avg revenue</span>
                    <span className="text-white/40">{formatCurrency(bestSim.results?.avg_revenue || 0)}</span>
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span className="text-white/25">breakeven</span>
                    <span className="text-white/40">{(bestSim.results?.avg_breakeven_month || 0).toFixed(1)} mo</span>
                  </div>
                </div>
              </div>
            </Link>
          ) : (
            <div className="flex items-center justify-center py-16 text-xs text-white/20">
              no completed simulations yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
