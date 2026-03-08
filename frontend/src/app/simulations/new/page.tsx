"use client";

export const dynamic = 'force-dynamic';

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Rocket, DollarSign, BarChart2, Megaphone, ShoppingCart, Building2,
  ArrowRight, ArrowLeft, Loader2, Users2, Plus, Trash2, Zap,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { SimulationCategory } from "@/types";

const categories = [
  { id: "startup", label: "Startup Launch", icon: Rocket, color: "violet" },
  { id: "pricing", label: "Pricing Strategy", icon: DollarSign, color: "green" },
  { id: "policy", label: "Policy Impact", icon: BarChart2, color: "cyan" },
  { id: "marketing", label: "Marketing", icon: Megaphone, color: "yellow" },
  { id: "product", label: "Product Launch", icon: ShoppingCart, color: "pink" },
  { id: "custom", label: "Custom", icon: Building2, color: "orange" },
] as const;

const colorMap: Record<string, string> = {
  violet: "border-violet-500/50 bg-violet-500/10 text-violet-400",
  green: "border-green-500/50 bg-green-500/10 text-green-400",
  cyan: "border-cyan-500/50 bg-cyan-500/10 text-cyan-400",
  yellow: "border-yellow-500/50 bg-yellow-500/10 text-yellow-400",
  pink: "border-pink-500/50 bg-pink-500/10 text-pink-400",
  orange: "border-orange-500/50 bg-orange-500/10 text-orange-400",
};

const defaultVariablesByCategory: Record<string, Array<{ name: string; label: string; value: number; min: number; max: number; unit: string }>> = {
  startup: [
    { name: "budget", label: "Monthly Budget", value: 50000, min: 5000, max: 1000000, unit: "$" },
    { name: "team_size", label: "Team Size", value: 5, min: 1, max: 100, unit: "people" },
    { name: "price_per_unit", label: "Price per Unit", value: 99, min: 1, max: 10000, unit: "$" },
    { name: "market_size", label: "Total Addressable Market", value: 1000000, min: 10000, max: 100000000, unit: "users" },
    { name: "conversion_rate", label: "Conversion Rate", value: 5, min: 0.1, max: 50, unit: "%" },
    { name: "churn_rate", label: "Monthly Churn", value: 5, min: 0.5, max: 30, unit: "%" },
  ],
  pricing: [
    { name: "current_price", label: "Current Price", value: 49, min: 1, max: 10000, unit: "$" },
    { name: "test_price", label: "Test Price", value: 79, min: 1, max: 10000, unit: "$" },
    { name: "customer_base", label: "Customer Base", value: 1000, min: 100, max: 1000000, unit: "users" },
    { name: "price_elasticity", label: "Price Elasticity", value: 1.5, min: 0.1, max: 5, unit: "x" },
  ],
  marketing: [
    { name: "budget", label: "Campaign Budget", value: 20000, min: 1000, max: 1000000, unit: "$" },
    { name: "cac_target", label: "Target CAC", value: 50, min: 5, max: 1000, unit: "$" },
    { name: "audience_size", label: "Target Audience", value: 100000, min: 1000, max: 100000000, unit: "people" },
    { name: "brand_awareness", label: "Current Brand Awareness", value: 10, min: 0, max: 100, unit: "%" },
  ],
};

const agentTemplates = [
  { type: "customer", label: "Customers", icon: "👤", defaultCount: 500, description: "End users who may purchase your product" },
  { type: "competitor", label: "Competitors", icon: "⚔️", defaultCount: 3, description: "Existing market players reacting to your moves" },
  { type: "investor", label: "Investors", icon: "💼", defaultCount: 10, description: "Funding sources evaluating your progress" },
  { type: "regulator", label: "Regulators", icon: "⚖️", defaultCount: 1, description: "Government or industry regulatory bodies" },
  { type: "market", label: "Market Forces", icon: "📈", defaultCount: 1, description: "Macro-economic and industry trends" },
];

export default function NewSimulationPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const templateId = searchParams.get("template");

  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<SimulationCategory>(
    (templateId as SimulationCategory) || "startup"
  );
  const [variables, setVariables] = useState(
    defaultVariablesByCategory[templateId || "startup"] || defaultVariablesByCategory.startup
  );
  const [selectedAgents, setSelectedAgents] = useState([
    { type: "customer", count: 500, sensitivity: 0.7 },
    { type: "competitor", count: 3, sensitivity: 0.8 },
  ]);
  const [numRuns, setNumRuns] = useState(1000);
  const [timeHorizon, setTimeHorizon] = useState(12);
  const [loading, setLoading] = useState(false);

  const totalSteps = 4;

  function handleCategorySelect(cat: SimulationCategory) {
    setCategory(cat);
    setVariables(defaultVariablesByCategory[cat] || defaultVariablesByCategory.startup);
  }

  function toggleAgent(type: string, defaultCount: number) {
    const exists = selectedAgents.find((a) => a.type === type);
    if (exists) {
      setSelectedAgents(selectedAgents.filter((a) => a.type !== type));
    } else {
      setSelectedAgents([...selectedAgents, { type, count: defaultCount, sensitivity: 0.7 }]);
    }
  }

  function updateAgentCount(type: string, count: number) {
    setSelectedAgents(selectedAgents.map((a) => a.type === type ? { ...a, count } : a));
  }

  async function handleSubmit() {
    setLoading(true);
    // In production: POST to /api/simulations
    await new Promise((r) => setTimeout(r, 1500));
    router.push("/simulations/demo-id");
  }

  return (
    <div className="p-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard"><ArrowLeft className="w-4 h-4" /></Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-white">New Simulation</h1>
          <p className="text-sm text-muted-foreground">Step {step} of {totalSteps}</p>
        </div>
      </div>

      {/* Progress */}
      <div className="flex gap-2 mb-8">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "flex-1 h-1.5 rounded-full transition-all duration-500",
              i < step ? "bg-gradient-to-r from-violet-500 to-cyan-500" : "bg-white/10"
            )}
          />
        ))}
      </div>

      {/* Step 1: Category */}
      {step === 1 && (
        <div className="animate-fade-in">
          <h2 className="text-xl font-semibold text-white mb-2">What are you simulating?</h2>
          <p className="text-muted-foreground mb-6">Choose a category to get started with a pre-configured setup</p>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => handleCategorySelect(cat.id as SimulationCategory)}
                className={cn(
                  "p-5 rounded-2xl border-2 text-left transition-all hover:scale-[1.02]",
                  category === cat.id
                    ? colorMap[cat.color]
                    : "border-white/10 bg-white/5 hover:border-white/20"
                )}
              >
                <cat.icon className={cn("w-7 h-7 mb-3", category === cat.id ? "" : "text-muted-foreground")} />
                <div className={cn("font-medium", category === cat.id ? "" : "text-white")}>{cat.label}</div>
              </button>
            ))}
          </div>

          <div className="space-y-4">
            <div>
              <Label>Simulation Name</Label>
              <Input
                className="mt-1.5"
                placeholder={`e.g., ${category === "startup" ? "SaaS B2B Launch Q1 2026" : "My Simulation"}`}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <Label>Description (optional)</Label>
              <textarea
                className="mt-1.5 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-violet-500/50 resize-none h-20"
                placeholder="What decision are you trying to validate?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>

          <div className="flex justify-end mt-8">
            <Button variant="gradient" onClick={() => setStep(2)} disabled={!name.trim()}>
              Continue <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Variables */}
      {step === 2 && (
        <div className="animate-fade-in">
          <h2 className="text-xl font-semibold text-white mb-2">Configure Variables</h2>
          <p className="text-muted-foreground mb-6">Set the key inputs for your simulation. These drive all agent behavior.</p>

          <div className="space-y-6">
            {variables.map((variable, idx) => (
              <Card key={variable.name}>
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <Label className="text-sm text-white">{variable.label}</Label>
                    <span className="text-sm font-semibold text-violet-400">
                      {variable.unit === "$" ? `$${variable.value.toLocaleString()}` : `${variable.value}${variable.unit}`}
                    </span>
                  </div>
                  <Slider
                    min={variable.min}
                    max={variable.max}
                    step={variable.max > 10000 ? 1000 : variable.max > 100 ? 10 : 0.5}
                    value={[variable.value]}
                    onValueChange={([val]) => {
                      const updated = [...variables];
                      updated[idx] = { ...updated[idx], value: val };
                      setVariables(updated);
                    }}
                  />
                  <div className="flex justify-between text-xs text-muted-foreground mt-1.5">
                    <span>{variable.unit === "$" ? `$${variable.min.toLocaleString()}` : `${variable.min}${variable.unit}`}</span>
                    <span>{variable.unit === "$" ? `$${variable.max.toLocaleString()}` : `${variable.max}${variable.unit}`}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="flex justify-between mt-8">
            <Button variant="ghost" onClick={() => setStep(1)}>
              <ArrowLeft className="w-4 h-4" /> Back
            </Button>
            <Button variant="gradient" onClick={() => setStep(3)}>
              Continue <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Agents */}
      {step === 3 && (
        <div className="animate-fade-in">
          <h2 className="text-xl font-semibold text-white mb-2">Set Up AI Agents</h2>
          <p className="text-muted-foreground mb-6">Choose which market participants to include. Each agent reacts independently to your decisions.</p>

          <div className="space-y-4">
            {agentTemplates.map((agent) => {
              const isSelected = selectedAgents.some((a) => a.type === agent.type);
              const agentData = selectedAgents.find((a) => a.type === agent.type);
              return (
                <Card
                  key={agent.type}
                  className={cn(
                    "cursor-pointer transition-all",
                    isSelected ? "border-violet-500/40 bg-violet-500/5" : "hover:border-white/20"
                  )}
                  onClick={() => toggleAgent(agent.type, agent.defaultCount)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-xl flex-shrink-0">
                        {agent.icon}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-white">{agent.label}</span>
                          {isSelected && <Badge variant="purple" className="text-xs">Active</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground">{agent.description}</p>
                      </div>
                      {isSelected && (
                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          <Input
                            type="number"
                            value={agentData?.count || agent.defaultCount}
                            onChange={(e) => updateAgentCount(agent.type, parseInt(e.target.value))}
                            className="w-24 h-8 text-xs"
                          />
                          <span className="text-xs text-muted-foreground whitespace-nowrap">agents</span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="flex justify-between mt-8">
            <Button variant="ghost" onClick={() => setStep(2)}>
              <ArrowLeft className="w-4 h-4" /> Back
            </Button>
            <Button variant="gradient" onClick={() => setStep(4)} disabled={selectedAgents.length === 0}>
              Continue <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 4: Review & Run */}
      {step === 4 && (
        <div className="animate-fade-in">
          <h2 className="text-xl font-semibold text-white mb-2">Configure & Launch</h2>
          <p className="text-muted-foreground mb-6">Review your setup and configure simulation parameters.</p>

          <div className="grid grid-cols-2 gap-6 mb-6">
            <Card>
              <CardHeader><CardTitle className="text-sm">Number of Runs</CardTitle></CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-violet-400 mb-3">{numRuns.toLocaleString()}</div>
                <Slider min={100} max={10000} step={100} value={[numRuns]} onValueChange={([v]) => setNumRuns(v)} />
                <div className="flex justify-between text-xs text-muted-foreground mt-1.5">
                  <span>100 (fast)</span><span>10,000 (precise)</span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Time Horizon</CardTitle></CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-cyan-400 mb-3">{timeHorizon} months</div>
                <Slider min={1} max={60} step={1} value={[timeHorizon]} onValueChange={([v]) => setTimeHorizon(v)} />
                <div className="flex justify-between text-xs text-muted-foreground mt-1.5">
                  <span>1 month</span><span>5 years</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Summary */}
          <Card className="mb-6">
            <CardHeader><CardTitle className="text-sm">Simulation Summary</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Name</span>
                <span className="text-white font-medium">{name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Category</span>
                <Badge variant="purple">{category}</Badge>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Variables</span>
                <span className="text-white">{variables.length} configured</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Agents</span>
                <span className="text-white">
                  {selectedAgents.reduce((sum, a) => sum + a.count, 0).toLocaleString()} total
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Estimated time</span>
                <span className="text-cyan-400">~{Math.ceil(numRuns / 500)} seconds</span>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(3)}>
              <ArrowLeft className="w-4 h-4" /> Back
            </Button>
            <Button variant="gradient" size="lg" onClick={handleSubmit} disabled={loading}>
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Running simulation...</>
              ) : (
                <><Zap className="w-4 h-4" /> Launch Simulation</>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
