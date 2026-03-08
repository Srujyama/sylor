"use client";

export const dynamic = 'force-dynamic';

import { useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Rocket, DollarSign, BarChart2, Megaphone, ShoppingCart, Building2,
  ArrowRight, ArrowLeft, Loader2, Zap, TrendingUp, FlaskConical, LineChart,
  Upload, FileSpreadsheet, X, Table,
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
  { id: "finance", label: "Financial Markets", icon: TrendingUp, color: "emerald" },
  { id: "biology", label: "Molecular / Bio", icon: FlaskConical, color: "teal" },
  { id: "trend", label: "Trend Analysis", icon: LineChart, color: "sky" },
  { id: "custom", label: "Custom", icon: Building2, color: "orange" },
] as const;

const colorMap: Record<string, string> = {
  violet: "border-violet-500/50 bg-violet-500/10 text-violet-400",
  green: "border-green-500/50 bg-green-500/10 text-green-400",
  cyan: "border-cyan-500/50 bg-cyan-500/10 text-cyan-400",
  yellow: "border-yellow-500/50 bg-yellow-500/10 text-yellow-400",
  pink: "border-pink-500/50 bg-pink-500/10 text-pink-400",
  orange: "border-orange-500/50 bg-orange-500/10 text-orange-400",
  emerald: "border-emerald-500/50 bg-emerald-500/10 text-emerald-400",
  teal: "border-teal-500/50 bg-teal-500/10 text-teal-400",
  sky: "border-sky-500/50 bg-sky-500/10 text-sky-400",
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
  policy: [
    { name: "population", label: "Population Affected", value: 500000, min: 1000, max: 100000000, unit: "people" },
    { name: "compliance_rate", label: "Expected Compliance", value: 70, min: 10, max: 100, unit: "%" },
    { name: "enforcement_budget", label: "Enforcement Budget", value: 1000000, min: 10000, max: 100000000, unit: "$" },
    { name: "timeline", label: "Implementation Timeline", value: 24, min: 1, max: 120, unit: "months" },
  ],
  product: [
    { name: "launch_users", label: "Launch Users", value: 1000, min: 100, max: 1000000, unit: "users" },
    { name: "feature_count", label: "Features at Launch", value: 5, min: 1, max: 50, unit: "features" },
    { name: "virality_coeff", label: "Virality Coefficient", value: 1.2, min: 0.1, max: 5, unit: "x" },
    { name: "retention_30d", label: "30-Day Retention", value: 40, min: 5, max: 90, unit: "%" },
  ],
  finance: [
    { name: "portfolio_value", label: "Portfolio Value", value: 100000, min: 1000, max: 100000000, unit: "$" },
    { name: "trading_days", label: "Trading Days", value: 252, min: 20, max: 756, unit: "days" },
    { name: "risk_tolerance", label: "Risk Tolerance", value: 50, min: 1, max: 100, unit: "%" },
    { name: "volatility", label: "Expected Volatility", value: 20, min: 1, max: 100, unit: "%" },
    { name: "num_assets", label: "Number of Assets", value: 5, min: 1, max: 50, unit: "assets" },
    { name: "rebalance_freq", label: "Rebalance Frequency", value: 30, min: 1, max: 252, unit: "days" },
  ],
  biology: [
    { name: "num_molecules", label: "Number of Molecules", value: 128, min: 10, max: 10000, unit: "molecules" },
    { name: "temperature", label: "Temperature", value: 310, min: 250, max: 400, unit: "K" },
    { name: "ph_level", label: "pH Level", value: 7.4, min: 0, max: 14, unit: "pH" },
    { name: "concentration", label: "Concentration", value: 100, min: 1, max: 10000, unit: "µM" },
    { name: "binding_affinity", label: "Binding Affinity (Kd)", value: 10, min: 0.01, max: 1000, unit: "nM" },
    { name: "sim_steps", label: "Simulation Steps", value: 5000, min: 100, max: 100000, unit: "steps" },
  ],
  trend: [
    { name: "forecast_periods", label: "Forecast Periods", value: 30, min: 5, max: 365, unit: "periods" },
    { name: "confidence_level", label: "Confidence Level", value: 95, min: 50, max: 99, unit: "%" },
    { name: "seasonality_period", label: "Seasonality Period", value: 12, min: 1, max: 365, unit: "periods" },
    { name: "trend_strength", label: "Trend Strength", value: 50, min: 1, max: 100, unit: "%" },
    { name: "noise_level", label: "Noise Level", value: 15, min: 1, max: 100, unit: "%" },
  ],
  custom: [
    { name: "param_1", label: "Parameter 1", value: 50, min: 0, max: 100, unit: "" },
    { name: "param_2", label: "Parameter 2", value: 50, min: 0, max: 100, unit: "" },
    { name: "param_3", label: "Parameter 3", value: 50, min: 0, max: 100, unit: "" },
  ],
};

// Domain-specific agents
const agentsByDomain: Record<string, Array<{ type: string; label: string; icon: string; defaultCount: number; description: string }>> = {
  business: [
    { type: "customer", label: "Customers", icon: "👤", defaultCount: 500, description: "End users who may purchase your product" },
    { type: "competitor", label: "Competitors", icon: "⚔️", defaultCount: 3, description: "Existing market players reacting to your moves" },
    { type: "investor", label: "Investors", icon: "💼", defaultCount: 10, description: "Funding sources evaluating your progress" },
    { type: "regulator", label: "Regulators", icon: "⚖️", defaultCount: 1, description: "Government or industry regulatory bodies" },
    { type: "market", label: "Market Forces", icon: "📈", defaultCount: 1, description: "Macro-economic and industry trends" },
  ],
  finance: [
    { type: "trader", label: "Traders", icon: "📊", defaultCount: 24, description: "AI traders with momentum/mean-reversion strategies" },
    { type: "market_maker", label: "Market Makers", icon: "🏛️", defaultCount: 4, description: "Liquidity providers adjusting bid/ask spreads" },
    { type: "data_stream", label: "Data Streams", icon: "📡", defaultCount: 6, description: "Real-time price feeds and market signals" },
    { type: "investor", label: "Investors", icon: "💼", defaultCount: 10, description: "Institutional and retail investors" },
  ],
  biology: [
    { type: "molecule", label: "Molecules", icon: "🧬", defaultCount: 128, description: "Simulated molecules with binding and folding behavior" },
    { type: "enzyme", label: "Enzymes", icon: "⚗️", defaultCount: 8, description: "Catalytic agents affecting reaction rates" },
    { type: "data_stream", label: "Data Streams", icon: "📡", defaultCount: 4, description: "Environmental condition feeds (temperature, pH)" },
  ],
  trend: [
    { type: "data_stream", label: "Data Streams", icon: "📡", defaultCount: 6, description: "Time-series data feeds for trend detection" },
    { type: "market", label: "Market Forces", icon: "📈", defaultCount: 3, description: "External forces influencing trends" },
    { type: "customer", label: "Customers", icon: "👤", defaultCount: 100, description: "Behavioral data points and demand signals" },
  ],
};

function getDomainForCategory(cat: string): string {
  if (["finance"].includes(cat)) return "finance";
  if (["biology"].includes(cat)) return "biology";
  if (["trend"].includes(cat)) return "trend";
  return "business";
}

interface UploadedData {
  fileName: string;
  fileSize: string;
  rowCount: number;
  columns: Array<{ name: string; type: string; sample: string }>;
}

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

  const domain = getDomainForCategory(category);
  const currentAgentTemplates = agentsByDomain[domain] || agentsByDomain.business;

  const [selectedAgents, setSelectedAgents] = useState([
    { type: "customer", count: 500, sensitivity: 0.7 },
    { type: "competitor", count: 3, sensitivity: 0.8 },
  ]);
  const [numRuns, setNumRuns] = useState(1000);
  const [timeHorizon, setTimeHorizon] = useState(12);
  const [loading, setLoading] = useState(false);
  const [uploadedData, setUploadedData] = useState<UploadedData | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const totalSteps = 4;

  function handleCategorySelect(cat: SimulationCategory) {
    setCategory(cat);
    setVariables(defaultVariablesByCategory[cat] || defaultVariablesByCategory.startup);
    // Reset agents to defaults for the new domain
    const newDomain = getDomainForCategory(cat);
    const newAgents = agentsByDomain[newDomain] || agentsByDomain.business;
    setSelectedAgents(
      newAgents.slice(0, 2).map((a) => ({ type: a.type, count: a.defaultCount, sensitivity: 0.7 }))
    );
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

  // File upload handling
  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }, []);

  function processFile(file: File) {
    // Client-side mock parsing — in production this would use xlsx/papaparse
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["csv", "xlsx", "xls"].includes(ext || "")) return;

    const sizeStr = file.size < 1024 * 1024
      ? `${(file.size / 1024).toFixed(1)} KB`
      : `${(file.size / (1024 * 1024)).toFixed(1)} MB`;

    // Simulate parsed data — in production would actually parse
    setUploadedData({
      fileName: file.name,
      fileSize: sizeStr,
      rowCount: Math.floor(Math.random() * 5000) + 500,
      columns: [
        { name: "date", type: "datetime", sample: "2024-01-15" },
        { name: "value", type: "float64", sample: "142.50" },
        { name: "volume", type: "int64", sample: "3,241" },
        { name: "category", type: "string", sample: "type_a" },
      ],
    });
  }

  async function handleSubmit() {
    setLoading(true);
    // In production: POST to /api/simulations
    await new Promise((r) => setTimeout(r, 1500));
    router.push("/simulations/demo-id");
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
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
              "flex-1 h-1.5 transition-all duration-500",
              i < step ? "bg-white/60" : "bg-white/10"
            )}
          />
        ))}
      </div>

      {/* Step 1: Category */}
      {step === 1 && (
        <div className="animate-fade-in">
          <h2 className="text-xl font-semibold text-white mb-2">What are you simulating?</h2>
          <p className="text-muted-foreground mb-6">Choose a category to get started with a pre-configured setup</p>

          <div className="grid grid-cols-3 gap-px bg-white/[0.05] mb-8">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => handleCategorySelect(cat.id as SimulationCategory)}
                className={cn(
                  "p-5 text-left transition-all bg-[#0a0a0a] hover:bg-white/[0.03]",
                  category === cat.id
                    ? "bg-white/[0.05] border-l-2 border-l-white/40"
                    : ""
                )}
              >
                <cat.icon className={cn("w-5 h-5 mb-3", category === cat.id ? "text-white" : "text-white/30")} />
                <div className={cn("text-sm font-medium", category === cat.id ? "text-white" : "text-white/50")}>{cat.label}</div>
              </button>
            ))}
          </div>

          <div className="space-y-4">
            <div>
              <Label>Simulation Name</Label>
              <Input
                className="mt-1.5"
                placeholder={`e.g., ${
                  category === "startup" ? "SaaS B2B Launch Q1 2026" :
                  category === "finance" ? "Tech Portfolio Risk Analysis" :
                  category === "biology" ? "Protein Binding Simulation" :
                  category === "trend" ? "Q2 Sales Trend Forecast" :
                  "My Simulation"
                }`}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <Label>Description (optional)</Label>
              <textarea
                className="mt-1.5 w-full border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-white/25 resize-none h-20"
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

      {/* Step 2: Variables + Data Upload */}
      {step === 2 && (
        <div className="animate-fade-in">
          <h2 className="text-xl font-semibold text-white mb-2">Configure Variables</h2>
          <p className="text-muted-foreground mb-6">Set the key inputs for your simulation. These drive all agent behavior.</p>

          {/* Data Upload Section */}
          <div className="surface mb-6">
            <div className="px-5 py-3 border-b border-white/[0.06]">
              <div className="flex items-center gap-2">
                <Upload className="w-3.5 h-3.5 text-white/30" />
                <span className="text-xs text-white/25 tracking-widest uppercase">upload data (optional)</span>
              </div>
            </div>
            <div className="p-5">
              {!uploadedData ? (
                <div
                  className={cn(
                    "border border-dashed p-6 flex flex-col items-center justify-center text-center transition-colors cursor-pointer",
                    dragOver ? "border-white/40 bg-white/[0.04]" : "border-white/[0.15] hover:border-white/[0.25]"
                  )}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleFileDrop}
                  onClick={() => document.getElementById("file-input")?.click()}
                >
                  <Upload className="w-5 h-5 text-white/20 mb-2" />
                  <p className="text-xs text-white/40 mb-1">drop CSV or Excel file here, or click to browse</p>
                  <p className="text-[10px] text-white/20">CSV, XLSX, XLS — max 10MB</p>
                  <input
                    id="file-input"
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                </div>
              ) : (
                <div>
                  {/* File info */}
                  <div className="flex items-center gap-3 mb-4">
                    <FileSpreadsheet className="w-4 h-4 text-white/30" />
                    <div className="flex-1">
                      <span className="text-xs text-white/60">{uploadedData.fileName}</span>
                      <span className="text-[10px] text-white/20 ml-2">{uploadedData.fileSize} · {uploadedData.rowCount} rows</span>
                    </div>
                    <span className="text-[10px] text-emerald-400/70">✓ parsed</span>
                    <button
                      onClick={() => setUploadedData(null)}
                      className="text-white/20 hover:text-white/50 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Column preview */}
                  <div className="surface">
                    <div className="px-3 py-1.5 border-b border-white/[0.06] flex items-center gap-2">
                      <Table className="w-3 h-3 text-white/20" />
                      <span className="text-[10px] text-white/20 tracking-widest uppercase">{uploadedData.columns.length} columns detected</span>
                    </div>
                    <div className="divide-y divide-white/[0.04]">
                      {uploadedData.columns.map((col) => (
                        <div key={col.name} className="grid grid-cols-4 px-3 py-2">
                          <span className="text-xs text-white/60 font-mono">{col.name}</span>
                          <span className="tag text-[10px] w-fit">{col.type}</span>
                          <span className="text-xs text-white/30 font-mono">{col.sample}</span>
                          <span className="text-[10px] text-white/25">→ map to var</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Variable sliders */}
          <div className="space-y-6">
            {variables.map((variable, idx) => (
              <Card key={variable.name}>
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <Label className="text-sm text-white">{variable.label}</Label>
                    <span className="text-sm font-semibold text-white/70">
                      {variable.unit === "$" ? `$${variable.value.toLocaleString()}` :
                       variable.unit ? `${variable.value}${variable.unit === "%" || variable.unit === "x" || variable.unit === "K" || variable.unit === "pH" || variable.unit === "nM" || variable.unit === "µM" ? "" : " "}${variable.unit}` :
                       variable.value}
                    </span>
                  </div>
                  <Slider
                    min={variable.min}
                    max={variable.max}
                    step={variable.max > 10000 ? 1000 : variable.max > 100 ? 10 : variable.max > 14 ? 1 : 0.1}
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
          <p className="text-muted-foreground mb-2">
            Choose which {domain === "biology" ? "molecular" : domain === "finance" ? "market" : "simulation"} participants to include.
          </p>
          <p className="text-xs text-white/20 mb-6">
            Showing agents for: <span className="tag text-[10px]">{domain}</span>
          </p>

          <div className="space-y-4">
            {currentAgentTemplates.map((agent) => {
              const isSelected = selectedAgents.some((a) => a.type === agent.type);
              const agentData = selectedAgents.find((a) => a.type === agent.type);
              return (
                <Card
                  key={agent.type}
                  className={cn(
                    "cursor-pointer transition-all",
                    isSelected ? "border-white/20 bg-white/[0.04]" : "hover:border-white/20"
                  )}
                  onClick={() => toggleAgent(agent.type, agent.defaultCount)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 surface-raised flex items-center justify-center text-xl flex-shrink-0">
                        {agent.icon}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-white">{agent.label}</span>
                          {isSelected && <span className="tag tag-green text-[10px]">active</span>}
                        </div>
                        <p className="text-xs text-white/35">{agent.description}</p>
                      </div>
                      {isSelected && (
                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          <Input
                            type="number"
                            value={agentData?.count || agent.defaultCount}
                            onChange={(e) => updateAgentCount(agent.type, parseInt(e.target.value))}
                            className="w-24 h-8 text-xs"
                          />
                          <span className="text-xs text-white/25 whitespace-nowrap">agents</span>
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
                <div className="text-3xl font-bold text-white mb-3">{numRuns.toLocaleString()}</div>
                <Slider min={100} max={10000} step={100} value={[numRuns]} onValueChange={([v]) => setNumRuns(v)} />
                <div className="flex justify-between text-xs text-muted-foreground mt-1.5">
                  <span>100 (fast)</span><span>10,000 (precise)</span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Time Horizon</CardTitle></CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-white/70 mb-3">
                  {category === "biology" ? `${timeHorizon * 1000} steps` :
                   category === "finance" ? `${timeHorizon} months` :
                   `${timeHorizon} months`}
                </div>
                <Slider min={1} max={60} step={1} value={[timeHorizon]} onValueChange={([v]) => setTimeHorizon(v)} />
                <div className="flex justify-between text-xs text-muted-foreground mt-1.5">
                  <span>{category === "biology" ? "1K steps" : "1 month"}</span>
                  <span>{category === "biology" ? "60K steps" : "5 years"}</span>
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
                <span className="tag">{category}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Domain</span>
                <span className="tag">{domain}</span>
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
              {uploadedData && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Uploaded Data</span>
                  <span className="text-white">{uploadedData.fileName} ({uploadedData.rowCount} rows)</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Estimated time</span>
                <span className="text-emerald-400">~{Math.ceil(numRuns / 500)} seconds</span>
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
