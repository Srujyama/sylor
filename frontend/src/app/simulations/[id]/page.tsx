"use client";

export const dynamic = 'force-dynamic';

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import {
  ArrowLeft, Zap, TrendingUp, AlertTriangle, CheckCircle, Info,
  BarChart3, GitBranch, Users2, Lightbulb, RefreshCw, Download,
} from "lucide-react";
import Link from "next/link";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, Legend,
  ReferenceLine, ReferenceArea,
} from "recharts";

// Mock data for demo
const timelineData = Array.from({ length: 24 }, (_, i) => ({
  month: `M${i + 1}`,
  p10: Math.max(0, 5000 + i * 2000 - Math.random() * 8000),
  p50: 8000 + i * 4500 + Math.random() * 3000,
  p90: 15000 + i * 8000 + Math.random() * 5000,
  customers: Math.floor(50 + i * 120 + Math.random() * 50),
  marketShare: Math.min(25, 0.5 + i * 0.9 + Math.random() * 0.3),
  competitorStrength: Math.max(20, 80 - i * 2 - Math.random() * 5),
}));

const outcomeDistribution = [
  { range: "< -50%", probability: 8, color: "#ef4444" },
  { range: "-50% to -20%", probability: 12, color: "#f97316" },
  { range: "-20% to 0%", probability: 7, color: "#eab308" },
  { range: "0% to 30%", probability: 22, color: "#84cc16" },
  { range: "30% to 100%", probability: 31, color: "#22c55e" },
  { range: "> 100%", probability: 20, color: "#06b6d4" },
];

const riskFactors = [
  { name: "Market Saturation", severity: "high", probability: 34, description: "Competitors may flood market within 6 months", mitigation: "Accelerate brand moat building" },
  { name: "Pricing Pressure", severity: "medium", probability: 58, description: "Customers show moderate price elasticity", mitigation: "Bundle features to increase perceived value" },
  { name: "Regulatory Risk", severity: "low", probability: 12, description: "Low chance of restrictive regulation in target market", mitigation: "Monitor regulatory landscape quarterly" },
  { name: "Funding Risk", severity: "high", probability: 29, description: "Runway may run short if growth is below P30 scenario", mitigation: "Raise bridge or cut burn rate by month 8" },
];

const agentActivity = [
  { name: "Customers", value: 500, color: "#8b5cf6" },
  { name: "Competitors", value: 3, color: "#ef4444" },
  { name: "Investors", value: 12, color: "#eab308" },
  { name: "Market", value: 1, color: "#06b6d4" },
];

const keyInsights = [
  "Your pricing at $99/month is optimal — simulations show diminishing returns above $129",
  "Month 8-10 is the critical growth inflection point across 73% of successful scenarios",
  "Competitor reaction in 65% of runs was delayed 3+ months, giving you a market window",
  "CAC payback period is 4.2 months in median scenario — strong unit economics",
  "Adding a freemium tier increased success probability by 11 percentage points",
];

const severityColor = {
  low: { badge: "success" as const, icon: CheckCircle, color: "text-green-400" },
  medium: { badge: "warning" as const, icon: AlertTriangle, color: "text-yellow-400" },
  high: { badge: "destructive" as const, icon: AlertTriangle, color: "text-red-400" },
  critical: { badge: "destructive" as const, icon: AlertTriangle, color: "text-red-500" },
};

export default function SimulationDetailPage({ params }: { params: { id: string } }) {
  const [budget, setBudget] = useState(50000);
  const [price, setPrice] = useState(99);
  const [isRerunning, setIsRerunning] = useState(false);
  const [successProb, setSuccessProb] = useState(73);

  async function handleRerun() {
    setIsRerunning(true);
    await new Promise((r) => setTimeout(r, 2000));
    // Simulate result change based on inputs
    const newProb = Math.min(95, Math.max(10, 73 + (budget - 50000) / 10000 + (price - 99) * -0.3));
    setSuccessProb(Math.round(newProb));
    setIsRerunning(false);
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/simulations"><ArrowLeft className="w-4 h-4" /></Link>
          </Button>
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-bold text-white">SaaS Startup Launch Q1</h1>
              <Badge variant="success">Completed</Badge>
              <Badge variant="outline">Startup</Badge>
            </div>
            <p className="text-sm text-muted-foreground">1,000 runs · 24 month horizon · 516 agents · Last run 2 hours ago</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="glass" size="sm">
            <Download className="w-4 h-4" /> Export
          </Button>
          <Button variant="gradient" size="sm" asChild>
            <Link href={`/simulations/${params.id}/compare`}>
              <GitBranch className="w-4 h-4" /> Compare
            </Link>
          </Button>
        </div>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: "Success Probability", value: `${successProb}%`, sub: "CI: 61% — 84%", color: "text-green-400", bg: "from-green-500/20 to-green-500/5" },
          { label: "Avg Revenue @ 24mo", value: "$2.4M", sub: "P50 scenario", color: "text-cyan-400", bg: "from-cyan-500/20 to-cyan-500/5" },
          { label: "Break-even", value: "8.2 mo", sub: "Median across runs", color: "text-violet-400", bg: "from-violet-500/20 to-violet-500/5" },
          { label: "Market Share", value: "4.1%", sub: "At 24 months (P50)", color: "text-yellow-400", bg: "from-yellow-500/20 to-yellow-500/5" },
        ].map((m) => (
          <Card key={m.label} className={`bg-gradient-to-br ${m.bg}`}>
            <CardContent className="p-5">
              <div className="text-xs text-muted-foreground mb-1">{m.label}</div>
              <div className={`text-3xl font-bold ${m.color} mb-0.5`}>{m.value}</div>
              <div className="text-xs text-muted-foreground">{m.sub}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="results">
        <TabsList className="mb-6">
          <TabsTrigger value="results">Results</TabsTrigger>
          <TabsTrigger value="what-if">What-If</TabsTrigger>
          <TabsTrigger value="agents">Agents</TabsTrigger>
          <TabsTrigger value="insights">AI Insights</TabsTrigger>
        </TabsList>

        {/* Results Tab */}
        <TabsContent value="results" className="space-y-6">
          {/* Revenue projection */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-violet-400" />
                Revenue Projection — Percentile Bands
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={timelineData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <defs>
                    <linearGradient id="p90grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="p50grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false}
                    tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    contentStyle={{ background: "rgba(0,0,0,0.85)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", fontSize: 12 }}
                    formatter={(v: number, name: string) => [`$${(v / 1000).toFixed(1)}k`, name === "p90" ? "Best 10%" : name === "p50" ? "Median" : "Worst 10%"]}
                  />
                  <Area type="monotone" dataKey="p90" stroke="#8b5cf6" strokeWidth={1.5} fill="url(#p90grad)" strokeDasharray="4 2" />
                  <Area type="monotone" dataKey="p50" stroke="#06b6d4" strokeWidth={2} fill="url(#p50grad)" />
                  <Area type="monotone" dataKey="p10" stroke="#ef4444" strokeWidth={1.5} fill="none" strokeDasharray="4 2" />
                </AreaChart>
              </ResponsiveContainer>
              <div className="flex gap-6 mt-3 justify-center text-xs">
                <div className="flex items-center gap-1.5"><div className="w-6 h-0.5 border-t-2 border-dashed border-violet-500" /><span className="text-muted-foreground">Best 10%</span></div>
                <div className="flex items-center gap-1.5"><div className="w-6 h-0.5 bg-cyan-500" /><span className="text-muted-foreground">Median</span></div>
                <div className="flex items-center gap-1.5"><div className="w-6 h-0.5 border-t-2 border-dashed border-red-500" /><span className="text-muted-foreground">Worst 10%</span></div>
              </div>
            </CardContent>
          </Card>

          {/* Outcome distribution + Market share */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-cyan-400" />
                  Outcome Distribution
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={outcomeDistribution} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="range" tick={{ fontSize: 9, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                    <Tooltip
                      contentStyle={{ background: "rgba(0,0,0,0.85)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", fontSize: 12 }}
                      formatter={(v: number) => [`${v}%`, "Probability"]}
                    />
                    <Bar dataKey="probability" radius={[4, 4, 0, 0]}>
                      {outcomeDistribution.map((entry, i) => (
                        <Cell key={i} fill={entry.color} opacity={0.8} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-green-400" />
                  Market Share & Competition
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={timelineData} margin={{ top: 5, right: 20, left: -20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                    <Tooltip
                      contentStyle={{ background: "rgba(0,0,0,0.85)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", fontSize: 12 }}
                    />
                    <Line type="monotone" dataKey="marketShare" stroke="#22c55e" strokeWidth={2} dot={false} name="Your Market Share %" />
                    <Line type="monotone" dataKey="competitorStrength" stroke="#ef4444" strokeWidth={2} dot={false} name="Competitor Strength" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Risk factors */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-yellow-400" />
                Risk Factors
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {riskFactors.map((risk) => {
                const config = severityColor[risk.severity as keyof typeof severityColor];
                return (
                  <div key={risk.name} className="p-4 rounded-xl bg-white/5 border border-white/5">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <config.icon className={`w-4 h-4 ${config.color}`} />
                        <span className="text-sm font-medium text-white">{risk.name}</span>
                        <Badge variant={config.badge} className="text-xs capitalize">{risk.severity}</Badge>
                      </div>
                      <span className="text-sm text-muted-foreground">{risk.probability}% probability</span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">{risk.description}</p>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-violet-400 font-medium">Mitigation:</span>
                      <span className="text-muted-foreground">{risk.mitigation}</span>
                    </div>
                    <Progress value={risk.probability} className="h-1 mt-2" />
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>

        {/* What-If Tab */}
        <TabsContent value="what-if" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-violet-400" />
                Adjust Variables & Rerun
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-8">
              <div>
                <div className="flex justify-between mb-3">
                  <label className="text-sm text-white">Monthly Budget</label>
                  <span className="text-sm font-semibold text-violet-400">${budget.toLocaleString()}</span>
                </div>
                <Slider min={10000} max={200000} step={5000} value={[budget]} onValueChange={([v]) => setBudget(v)} />
              </div>
              <div>
                <div className="flex justify-between mb-3">
                  <label className="text-sm text-white">Price per Month</label>
                  <span className="text-sm font-semibold text-cyan-400">${price}/mo</span>
                </div>
                <Slider min={19} max={499} step={10} value={[price]} onValueChange={([v]) => setPrice(v)} />
              </div>

              {/* Live preview */}
              <div className="p-5 rounded-xl bg-gradient-to-br from-violet-500/10 to-cyan-500/5 border border-violet-500/20">
                <div className="text-sm text-muted-foreground mb-1">Estimated Success Probability</div>
                <div className="text-4xl font-bold text-violet-400 mb-3">{successProb}%</div>
                <Progress value={successProb} />
                <p className="text-xs text-muted-foreground mt-2">
                  Based on your variable adjustments. Click Rerun for full simulation.
                </p>
              </div>

              <Button variant="gradient" className="w-full" onClick={handleRerun} disabled={isRerunning}>
                {isRerunning ? (
                  <><RefreshCw className="w-4 h-4 animate-spin" /> Running 1,000 scenarios...</>
                ) : (
                  <><Zap className="w-4 h-4" /> Rerun Simulation</>
                )}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Agents Tab */}
        <TabsContent value="agents" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Users2 className="w-4 h-4 text-cyan-400" />
                  Agent Distribution
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={agentActivity} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={3} dataKey="value">
                      {agentActivity.map((entry, i) => (
                        <Cell key={i} fill={entry.color} opacity={0.85} />
                      ))}
                    </Pie>
                    <Legend wrapperStyle={{ fontSize: 12, color: "#6b7280" }} />
                    <Tooltip contentStyle={{ background: "rgba(0,0,0,0.85)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Agent Behavior Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {[
                  { type: "Customers", icon: "👤", count: 500, behavior: "High sensitivity to pricing changes. 34% price-elastic in simulations. Primary churn driver: feature gaps." },
                  { type: "Competitors", icon: "⚔️", count: 3, behavior: "Competitor A reacted with price cuts in 65% of runs. Competitor B launched competing feature in month 6." },
                  { type: "Investors", icon: "💼", count: 12, behavior: "Bridge funding unlocked in 78% of scenarios where MoM growth exceeded 15%." },
                  { type: "Market", icon: "📈", count: 1, behavior: "Macro conditions favorable in 80% of scenarios. One recession event occurred in ~15% of runs." },
                ].map((agent) => (
                  <div key={agent.type} className="p-3 rounded-xl bg-white/5 border border-white/5">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-base">{agent.icon}</span>
                      <span className="text-sm font-medium text-white">{agent.type}</span>
                      <Badge variant="outline" className="text-xs ml-auto">{agent.count} agents</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{agent.behavior}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Customer growth */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Customer Growth Curve</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={timelineData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <defs>
                    <linearGradient id="custGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "rgba(0,0,0,0.85)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", fontSize: 12 }} />
                  <Area type="monotone" dataKey="customers" stroke="#06b6d4" strokeWidth={2} fill="url(#custGrad)" name="Customers" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* AI Insights Tab */}
        <TabsContent value="insights" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-yellow-400" />
                AI-Generated Insights
                <Badge variant="purple" className="ml-auto">Powered by Claude</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {keyInsights.map((insight, i) => (
                <div key={i} className="flex gap-3 p-4 rounded-xl bg-white/5 border border-white/5">
                  <div className="w-6 h-6 rounded-full bg-violet-500/20 border border-violet-500/30 flex items-center justify-center flex-shrink-0 text-xs font-bold text-violet-400 mt-0.5">
                    {i + 1}
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">{insight}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Why Scenarios Succeed vs Fail</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/20">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  <span className="text-sm font-medium text-green-400">Success Pattern (73% of runs)</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Successful scenarios consistently achieved product-market fit by month 4-5, with organic word-of-mouth
                  driving viral growth coefficient above 1.2. Initial pricing was maintained, and competition was outpaced
                  through feature velocity. Monthly churn stayed below 4%.
                </p>
              </div>
              <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  <span className="text-sm font-medium text-red-400">Failure Pattern (27% of runs)</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Failed scenarios ran out of runway before achieving 200 paying customers. Primary causes: slow sales cycle
                  (enterprise-heavy targeting), high churn due to poor onboarding, and aggressive competitor pricing that
                  undercut value proposition before brand trust was established.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
