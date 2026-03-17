"use client";

export const dynamic = 'force-dynamic';

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Plus, GitBranch } from "lucide-react";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";

const compareData = [
  {
    name: "Success Rate",
    "Scenario A (Base)": 73,
    "Scenario B ($129 price)": 61,
    "Scenario C (2x budget)": 81,
  },
  {
    name: "Avg Revenue",
    "Scenario A (Base)": 65,
    "Scenario B ($129 price)": 72,
    "Scenario C (2x budget)": 85,
  },
  {
    name: "Market Share",
    "Scenario A (Base)": 41,
    "Scenario B ($129 price)": 35,
    "Scenario C (2x budget)": 52,
  },
  {
    name: "Break-even Speed",
    "Scenario A (Base)": 68,
    "Scenario B ($129 price)": 60,
    "Scenario C (2x budget)": 78,
  },
  {
    name: "Risk Level",
    "Scenario A (Base)": 55,
    "Scenario B ($129 price)": 48,
    "Scenario C (2x budget)": 62,
  },
];

const scenarios = [
  {
    name: "Scenario A (Base)",
    color: "#8b5cf6",
    successProb: 73,
    avgRevenue: "$2.4M",
    breakeven: "8.2 mo",
    riskLevel: "Medium",
    price: "$99/mo",
    budget: "$50k/mo",
  },
  {
    name: "Scenario B ($129 price)",
    color: "#06b6d4",
    successProb: 61,
    avgRevenue: "$2.9M",
    breakeven: "10.1 mo",
    riskLevel: "Medium-High",
    price: "$129/mo",
    budget: "$50k/mo",
  },
  {
    name: "Scenario C (2x budget)",
    color: "#22c55e",
    successProb: 81,
    avgRevenue: "$3.8M",
    breakeven: "6.8 mo",
    riskLevel: "Medium",
    price: "$99/mo",
    budget: "$100k/mo",
  },
];

export default function ComparePage({ params }: { params: { id: string } }) {
  return (
    <div className="p-8">
      <div className="flex items-center gap-4 mb-8">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/simulations/${params.id}`}><ArrowLeft className="w-4 h-4" /></Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <GitBranch className="w-6 h-6 text-violet-400" />
            Compare Scenarios
          </h1>
          <p className="text-sm text-muted-foreground">SaaS Startup Launch Q1 — 3 scenarios</p>
        </div>
        <Button variant="glass" size="sm" className="ml-auto">
          <Plus className="w-4 h-4" /> Add Scenario
        </Button>
      </div>

      {/* Scenario cards */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {scenarios.map((s, i) => (
          <Card key={s.name} className={i === 2 ? "border-green-500/30 bg-green-500/5" : ""}>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />
                <CardTitle className="text-sm">{s.name}</CardTitle>
                {i === 2 && <Badge variant="success" className="text-xs ml-auto">Best</Badge>}
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Success Rate</span>
                <span className="font-semibold" style={{ color: s.color }}>{s.successProb}%</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Avg Revenue</span>
                <span className="text-white">{s.avgRevenue}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Break-even</span>
                <span className="text-white">{s.breakeven}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Price</span>
                <span className="text-white">{s.price}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Budget</span>
                <span className="text-white">{s.budget}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Radar chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Multi-Dimensional Comparison</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <RadarChart data={compareData}>
                <PolarGrid stroke="var(--chart-tooltip-border)" />
                <PolarAngleAxis dataKey="name" tick={{ fontSize: 11, fill: "#6b7280" }} />
                {scenarios.map((s) => (
                  <Radar key={s.name} name={s.name} dataKey={s.name} stroke={s.color} fill={s.color} fillOpacity={0.1} strokeWidth={2} />
                ))}
                <Legend wrapperStyle={{ fontSize: 11, color: "#6b7280" }} />
                <Tooltip contentStyle={{ background: "var(--chart-tooltip-bg)", border: "1px solid var(--chart-tooltip-border)", borderRadius: "10px", fontSize: 12 }} />
              </RadarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Bar comparison */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Success Probability</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={[
                  { name: "Scenario A", value: 73, fill: "#8b5cf6" },
                  { name: "Scenario B", value: 61, fill: "#06b6d4" },
                  { name: "Scenario C", value: 81, fill: "#22c55e" },
                ]}
                margin={{ top: 5, right: 20, left: -20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <Tooltip contentStyle={{ background: "var(--chart-tooltip-bg)", border: "1px solid var(--chart-tooltip-border)", borderRadius: "10px", fontSize: 12 }} formatter={(v: number) => [`${v}%`]} />
                <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                  {[{ fill: "#8b5cf6" }, { fill: "#06b6d4" }, { fill: "#22c55e" }].map((entry, i) => (
                    <rect key={i} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 p-5 rounded-xl bg-green-500/10 border border-green-500/20">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-green-400 font-semibold text-sm">Recommendation</span>
          <Badge variant="success">AI Analysis</Badge>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          <strong className="text-white">Scenario C (2x budget)</strong> is the optimal choice with 81% success probability.
          The additional $50k/month spend accelerates growth significantly — each dollar of extra budget generates $3.2 in expected revenue
          at 24 months. If budget is constrained, Scenario A is preferred over B, as the lower price point leads to higher conversion
          that offsets the revenue per customer gap.
        </p>
      </div>
    </div>
  );
}
