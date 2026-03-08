"use client";

export const dynamic = 'force-dynamic';

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Plus, Search, Filter, CheckCircle2, Loader2, XCircle, Clock,
  ArrowRight, ChartBar, Calendar, Zap,
} from "lucide-react";

const simulations = [
  { id: "1", name: "SaaS Startup Launch Q1", status: "completed", successProb: 73, category: "Startup", runs: 1000, updatedAt: "2 hours ago", agents: 515 },
  { id: "2", name: "Pricing Experiment v3", status: "running", successProb: null, category: "Pricing", runs: 500, updatedAt: "Just now", agents: 1008 },
  { id: "3", name: "EU Market Entry 2026", status: "completed", successProb: 41, category: "Strategy", runs: 2000, updatedAt: "1 day ago", agents: 3012 },
  { id: "4", name: "Marketing Channel Mix", status: "failed", successProb: null, category: "Marketing", runs: 0, updatedAt: "2 days ago", agents: 2000 },
  { id: "5", name: "Product Feature Rollout", status: "completed", successProb: 88, category: "Product", runs: 5000, updatedAt: "3 days ago", agents: 5004 },
  { id: "6", name: "Series A Fundraise Model", status: "completed", successProb: 55, category: "Startup", runs: 3000, updatedAt: "1 week ago", agents: 12 },
  { id: "7", name: "Policy Impact: Carbon Tax", status: "draft", successProb: null, category: "Policy", runs: 0, updatedAt: "1 week ago", agents: 13003 },
];

const statusConfig = {
  completed: { icon: CheckCircle2, color: "text-green-400", label: "Completed", badge: "success" as const },
  running: { icon: Loader2, color: "text-violet-400 animate-spin", label: "Running", badge: "purple" as const },
  failed: { icon: XCircle, color: "text-red-400", label: "Failed", badge: "destructive" as const },
  draft: { icon: Clock, color: "text-yellow-400", label: "Draft", badge: "warning" as const },
};

export default function SimulationsPage() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  const filtered = simulations.filter((s) => {
    const matchesSearch = s.name.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === "all" || s.status === filter;
    return matchesSearch && matchesFilter;
  });

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white mb-1">Simulations</h1>
          <p className="text-muted-foreground">{simulations.length} simulations total</p>
        </div>
        <Button variant="gradient" asChild>
          <Link href="/simulations/new"><Plus className="w-4 h-4" /> New Simulation</Link>
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search simulations..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          {["all", "completed", "running", "draft", "failed"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-2 rounded-lg text-xs font-medium capitalize transition-all ${
                filter === f
                  ? "bg-violet-500/20 text-violet-400 border border-violet-500/30"
                  : "text-muted-foreground hover:text-white border border-white/10 hover:border-white/20"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="space-y-3">
        {filtered.map((sim) => {
          const status = statusConfig[sim.status as keyof typeof statusConfig];
          return (
            <Link key={sim.id} href={`/simulations/${sim.id}`}>
              <Card className="group hover:border-violet-500/30 hover:bg-violet-500/5 transition-all duration-200 cursor-pointer mb-3">
                <CardContent className="p-5">
                  <div className="flex items-center gap-4">
                    {/* Status icon */}
                    <div className={`w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center flex-shrink-0`}>
                      <status.icon className={`w-5 h-5 ${status.color}`} />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-semibold text-white truncate">{sim.name}</h3>
                        <Badge variant={status.badge} className="text-xs flex-shrink-0">{status.label}</Badge>
                        <Badge variant="outline" className="text-xs flex-shrink-0">{sim.category}</Badge>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Zap className="w-3 h-3" /> {sim.runs.toLocaleString()} runs
                        </span>
                        <span className="flex items-center gap-1">
                          <ChartBar className="w-3 h-3" /> {sim.agents.toLocaleString()} agents
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" /> {sim.updatedAt}
                        </span>
                      </div>
                    </div>

                    {/* Success prob */}
                    {sim.successProb !== null ? (
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <div className="text-right">
                          <div className={`text-lg font-bold ${sim.successProb >= 70 ? "text-green-400" : sim.successProb >= 50 ? "text-yellow-400" : "text-red-400"}`}>
                            {sim.successProb}%
                          </div>
                          <div className="text-xs text-muted-foreground">success</div>
                        </div>
                        <div className="w-24">
                          <Progress value={sim.successProb} className="h-2" />
                        </div>
                      </div>
                    ) : (
                      <div className="w-28" />
                    )}

                    <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-violet-400 transition-colors flex-shrink-0" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}

        {filtered.length === 0 && (
          <div className="text-center py-16">
            <div className="text-4xl mb-4">🔍</div>
            <h3 className="text-white font-medium mb-2">No simulations found</h3>
            <p className="text-muted-foreground text-sm">Try adjusting your search or filters</p>
          </div>
        )}
      </div>
    </div>
  );
}
