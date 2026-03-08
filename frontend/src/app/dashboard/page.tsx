"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Plus, TrendingUp, Activity, Zap, Clock, ArrowRight,
  CheckCircle2, Loader2, XCircle,
} from "lucide-react";
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
  { id: "1", name: "SaaS Startup Launch Q1", status: "completed", successProb: 73, category: "Startup", updatedAt: "2 hours ago" },
  { id: "2", name: "Pricing Experiment v3", status: "running", successProb: null, category: "Pricing", updatedAt: "Just now" },
  { id: "3", name: "EU Market Entry", status: "completed", successProb: 41, category: "Strategy", updatedAt: "1 day ago" },
  { id: "4", name: "Marketing Channel Mix", status: "failed", successProb: null, category: "Marketing", updatedAt: "2 days ago" },
  { id: "5", name: "Product Feature Rollout", status: "completed", successProb: 88, category: "Product", updatedAt: "3 days ago" },
];

const statusConfig = {
  completed: { icon: CheckCircle2, color: "text-green-400", label: "Completed", badge: "success" as const },
  running: { icon: Loader2, color: "text-violet-400 animate-spin", label: "Running", badge: "purple" as const },
  failed: { icon: XCircle, color: "text-red-400", label: "Failed", badge: "destructive" as const },
  draft: { icon: Clock, color: "text-yellow-400", label: "Draft", badge: "warning" as const },
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
    { label: "Total Simulations", value: "24", delta: "+4 this month", icon: Activity, color: "violet" },
    { label: "Avg Success Rate", value: "68%", delta: "+5% vs last month", icon: TrendingUp, color: "green" },
    { label: "Runs Executed", value: "48K", delta: "Across all scenarios", icon: Zap, color: "cyan" },
    { label: "Time Saved", value: "~120h", delta: "vs manual analysis", icon: Clock, color: "yellow" },
  ];

  const iconColors: Record<string, string> = {
    violet: "text-violet-400 bg-violet-500/20",
    green: "text-green-400 bg-green-500/20",
    cyan: "text-cyan-400 bg-cyan-500/20",
    yellow: "text-yellow-400 bg-yellow-500/20",
  };

  return (
    <div className="p-8 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-10">
        <div>
          <h1 className="text-3xl font-bold text-white mb-1">
            Good morning, {userName} 👋
          </h1>
          <p className="text-muted-foreground">
            Here&apos;s what&apos;s happening with your simulations
          </p>
        </div>
        <Button variant="gradient" asChild>
          <Link href="/simulations/new">
            <Plus className="w-4 h-4" />
            New Simulation
          </Link>
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat) => (
          <Card key={stat.label} className="group hover:border-white/20 transition-all">
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-4">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${iconColors[stat.color]}`}>
                  <stat.icon className="w-5 h-5" />
                </div>
              </div>
              <div className="text-2xl font-bold text-white mb-0.5">{stat.value}</div>
              <div className="text-xs text-muted-foreground">{stat.label}</div>
              <div className="text-xs text-green-400 mt-1">{stat.delta}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Activity chart */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Simulation Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={mockActivity} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                <defs>
                  <linearGradient id="simGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="successGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: "rgba(0,0,0,0.8)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", fontSize: 12 }}
                  labelStyle={{ color: "white" }}
                />
                <Area type="monotone" dataKey="simulations" stroke="#8b5cf6" strokeWidth={2} fill="url(#simGrad)" name="Total" />
                <Area type="monotone" dataKey="success" stroke="#06b6d4" strokeWidth={2} fill="url(#successGrad)" name="Successful" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Quick actions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quick Start</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: "Startup Launch", icon: "🚀", href: "/simulations/new?template=startup" },
              { label: "Pricing Strategy", icon: "💰", href: "/simulations/new?template=pricing" },
              { label: "Market Entry", icon: "🌍", href: "/simulations/new?template=market-entry" },
              { label: "Custom Simulation", icon: "⚡", href: "/simulations/new" },
            ].map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/5 hover:border-violet-500/30 hover:bg-violet-500/5 transition-all group"
              >
                <span className="text-lg">{item.icon}</span>
                <span className="text-sm text-muted-foreground group-hover:text-white transition-colors flex-1">{item.label}</span>
                <ArrowRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-violet-400 group-hover:translate-x-0.5 transition-all" />
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Recent simulations */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Recent Simulations</CardTitle>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/simulations">View all <ArrowRight className="w-3.5 h-3.5 ml-1" /></Link>
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {recentSimulations.map((sim) => {
              const status = statusConfig[sim.status as keyof typeof statusConfig];
              return (
                <Link
                  key={sim.id}
                  href={`/simulations/${sim.id}`}
                  className="flex items-center gap-4 p-4 rounded-xl bg-white/5 border border-white/5 hover:border-violet-500/20 hover:bg-violet-500/5 transition-all group"
                >
                  <status.icon className={`w-4 h-4 flex-shrink-0 ${status.color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white truncate">{sim.name}</div>
                    <div className="text-xs text-muted-foreground">{sim.updatedAt}</div>
                  </div>
                  <Badge variant={status.badge}>{status.label}</Badge>
                  <Badge variant="outline" className="text-xs">{sim.category}</Badge>
                  {sim.successProb !== null && (
                    <div className="flex items-center gap-2 w-28">
                      <Progress value={sim.successProb} className="h-1.5" />
                      <span className="text-xs text-muted-foreground w-8">{sim.successProb}%</span>
                    </div>
                  )}
                  <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-violet-400 transition-colors flex-shrink-0" />
                </Link>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
