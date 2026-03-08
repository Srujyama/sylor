"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, ArrowRight, TrendingUp, Activity, Zap, Clock } from "lucide-react";
import { onAuthChange } from "@/lib/firebase/auth";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

const mockActivity = [
  { month: "Jan", simulations: 4, success: 3 },
  { month: "Feb", simulations: 7, success: 5 },
  { month: "Mar", simulations: 5, success: 4 },
  { month: "Apr", simulations: 10, success: 7 },
  { month: "May", simulations: 8, success: 6 },
  { month: "Jun", simulations: 14, success: 10 },
  { month: "Jul", simulations: 12, success: 9 },
];

const recentSimulations = [
  { id: "1", name: "SaaS Startup Launch Q1", status: "completed", successProb: 73, category: "startup", updatedAt: "2 hours ago" },
  { id: "2", name: "Pricing Experiment v3", status: "running", successProb: null, category: "pricing", updatedAt: "just now" },
  { id: "3", name: "EU Market Entry", status: "completed", successProb: 41, category: "strategy", updatedAt: "1 day ago" },
  { id: "4", name: "Marketing Channel Mix", status: "failed", successProb: null, category: "marketing", updatedAt: "2 days ago" },
  { id: "5", name: "Product Feature Rollout", status: "completed", successProb: 88, category: "product", updatedAt: "3 days ago" },
];

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

export default function DashboardPage() {
  const [userName, setUserName] = useState("there");

  useEffect(() => {
    const unsubscribe = onAuthChange((user) => {
      if (user?.displayName) {
        setUserName(user.displayName.split(" ")[0]);
      } else if (user?.email) {
        setUserName(user.email.split("@")[0]);
      }
    });
    return () => unsubscribe();
  }, []);

  const stats = [
    { label: "total simulations", value: "24", delta: "+4 this month", icon: Activity },
    { label: "avg success rate", value: "68%", delta: "+5% vs last month", icon: TrendingUp },
    { label: "runs executed", value: "48K", delta: "across all scenarios", icon: Zap },
    { label: "time saved", value: "~120h", delta: "vs manual analysis", icon: Clock },
  ];

  return (
    <div className="p-8 max-w-6xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-10">
        <div>
          <p className="text-xs text-white/25 mb-1 tracking-wide">sylor / dashboard</p>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            good morning, {userName}
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
            <div className="text-2xl font-bold text-white tracking-tight mb-1">{stat.value}</div>
            <div className="text-xs text-white/30 mb-0.5">{stat.label}</div>
            <div className="text-xs text-emerald-400/70">{stat.delta}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-px bg-white/[0.05] mb-8">
        {/* Activity chart */}
        <div className="bg-[#0a0a0a] p-5 lg:col-span-2">
          <div className="text-xs text-white/25 mb-4 tracking-widest uppercase">simulation activity</div>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={mockActivity} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="simGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="rgba(255,255,255,0.15)" stopOpacity={1} />
                  <stop offset="95%" stopColor="rgba(255,255,255,0)" stopOpacity={1} />
                </linearGradient>
                <linearGradient id="successGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="rgba(74,222,128,0.15)" stopOpacity={1} />
                  <stop offset="95%" stopColor="rgba(74,222,128,0)" stopOpacity={1} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.25)", fontFamily: "inherit" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.25)", fontFamily: "inherit" }} axisLine={false} tickLine={false} />
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
              <Area type="monotone" dataKey="simulations" stroke="rgba(255,255,255,0.3)" strokeWidth={1.5} fill="url(#simGrad)" name="total" />
              <Area type="monotone" dataKey="success" stroke="rgba(74,222,128,0.5)" strokeWidth={1.5} fill="url(#successGrad)" name="successful" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Quick start */}
        <div className="bg-[#0a0a0a] p-5">
          <div className="text-xs text-white/25 mb-4 tracking-widest uppercase">quick start</div>
          <div className="space-y-0.5">
            {[
              { label: "startup launch", href: "/simulations/new?template=startup" },
              { label: "pricing strategy", href: "/simulations/new?template=pricing" },
              { label: "market entry", href: "/simulations/new?template=market-entry" },
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

      {/* Recent simulations */}
      <div className="surface">
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06]">
          <span className="text-xs text-white/25 tracking-widest uppercase">recent simulations</span>
          <Link href="/simulations" className="text-xs text-white/25 hover:text-white/60 transition-colors flex items-center gap-1">
            view all <ArrowRight className="w-3 h-3" />
          </Link>
        </div>

        <div>
          {recentSimulations.map((sim, i) => (
            <Link
              key={sim.id}
              href={`/simulations/${sim.id}`}
              className={`flex items-center gap-4 px-5 py-3.5 hover:bg-white/[0.025] transition-colors group ${i < recentSimulations.length - 1 ? "border-b border-white/[0.04]" : ""}`}
            >
              <span className={`dot ${statusDot[sim.status]} shrink-0`} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-white/80 truncate group-hover:text-white transition-colors">{sim.name}</div>
                <div className="text-xs text-white/25 mt-0.5">{sim.updatedAt}</div>
              </div>
              <span className={`tag ${statusTagClass[sim.status]} shrink-0`}>{statusLabel[sim.status]}</span>
              <span className="tag shrink-0">{sim.category}</span>
              {sim.successProb !== null && (
                <div className="flex items-center gap-2 w-24 shrink-0">
                  <div className="progress-bar flex-1">
                    <div className="progress-fill" style={{ width: `${sim.successProb}%` }} />
                  </div>
                  <span className="text-xs text-white/35 w-7 text-right">{sim.successProb}%</span>
                </div>
              )}
              <ArrowRight className="w-3 h-3 text-white/20 group-hover:text-white/50 transition-colors shrink-0" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
