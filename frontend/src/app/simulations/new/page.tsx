"use client";

export const dynamic = 'force-dynamic';

import { useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { SliderWithInput } from "@/components/ui/slider-with-input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import {
  Rocket, DollarSign, BarChart2, Megaphone, ShoppingCart, Building2,
  ArrowRight, ArrowLeft, Loader2, Zap, TrendingUp, FlaskConical, LineChart,
  Upload, FileSpreadsheet, X, Table, Sparkles, Check, AlertCircle, HelpCircle,
} from "lucide-react";
import Link from "next/link";
import { cn, getApiUrl } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import type { SimulationCategory, AIAnalysisResponse } from "@/types";

// ---------- constants ----------

const categories = [
  { id: "startup", label: "Startup Launch", icon: Rocket },
  { id: "pricing", label: "Pricing Strategy", icon: DollarSign },
  { id: "policy", label: "Policy Impact", icon: BarChart2 },
  { id: "marketing", label: "Marketing", icon: Megaphone },
  { id: "product", label: "Product Launch", icon: ShoppingCart },
  { id: "finance", label: "Financial Markets", icon: TrendingUp },
  { id: "biology", label: "Molecular / Bio", icon: FlaskConical },
  { id: "trend", label: "Trend Analysis", icon: LineChart },
  { id: "custom", label: "Custom", icon: Building2 },
] as const;

const industryOptions = [
  "SaaS / Software", "E-commerce", "Fintech", "Healthcare / Biotech",
  "EdTech", "Consumer Apps", "Marketplace", "Hardware / IoT",
  "Media / Content", "Real Estate", "Logistics", "Energy / CleanTech", "Other",
];

const businessModelOptions = [
  "SaaS (subscription)", "Marketplace (take rate)", "E-commerce (direct sales)",
  "Freemium", "Usage-based pricing", "Enterprise licenses",
  "Advertising", "Hardware + software", "Services / consulting", "Other",
];

const stageOptions = [
  "Idea / pre-product", "Pre-revenue (has product)", "Early revenue (<$10K MRR)",
  "Growing ($10K-$100K MRR)", "Scaling ($100K-$1M MRR)", "Established ($1M+ MRR)",
];

const channelOptions = [
  "Paid ads (Google/Meta)", "Organic / SEO", "Content marketing",
  "Referral / word-of-mouth", "Outbound sales", "Partnerships / affiliates",
  "Social media", "Events / conferences",
];

const riskProfileOptions = ["Conservative", "Moderate", "Aggressive", "Very aggressive"];
const marketConditionOptions = ["Bull market", "Bear market", "Sideways / range-bound", "Uncertain / volatile"];
const dataFrequencyOptions = ["Hourly", "Daily", "Weekly", "Monthly", "Quarterly", "Yearly"];

// ---------- component ----------

export default function NewSimulationPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const templateId = searchParams.get("template");
  const { toast } = useToast();

  const [step, setStep] = useState(1);
  const [category, setCategory] = useState<SimulationCategory>(
    (templateId as SimulationCategory) || "startup"
  );
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // Company context — flexible object, fields depend on category
  const [context, setContext] = useState<Record<string, any>>({});
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);

  // AI analysis result
  const [analysis, setAnalysis] = useState<AIAnalysisResponse | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState("");

  // Editable variables (populated by AI, user can tweak)
  const [variables, setVariables] = useState<AIAnalysisResponse["variables"]>([]);
  const [agents, setAgents] = useState<AIAnalysisResponse["agents"]>([]);
  const [numRuns, setNumRuns] = useState(1000);
  const [timeHorizon, setTimeHorizon] = useState(12);

  // Data upload
  const [uploadedData, setUploadedData] = useState<{ fileName: string; fileSize: string; rowCount: number; columns: Array<{ name: string; type: string; sample: string }> } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [loading, setLoading] = useState(false);

  const totalSteps = 5;

  // ---------- context field helpers ----------

  function updateContext(key: string, value: any) {
    setContext((prev) => ({ ...prev, [key]: value }));
  }

  function toggleChannel(ch: string) {
    setSelectedChannels((prev) =>
      prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch]
    );
  }

  // ---------- AI analysis ----------

  async function runAnalysis() {
    setAnalyzing(true);
    setAnalysisError("");

    const fullContext = {
      ...context,
      acquisitionChannels: selectedChannels,
    };

    try {
      const res = await fetch(`${getApiUrl()}/api/context/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, context: fullContext }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Server error ${res.status}`);
      }

      const data: AIAnalysisResponse = await res.json();
      setAnalysis(data);
      setVariables(data.variables);
      setAgents(data.agents);
      setNumRuns(data.numRuns);
      setTimeHorizon(data.timeHorizon);
      toast({ title: "Analysis complete", description: `Generated ${data.variables.length} variables and ${data.agents.length} agents`, variant: "success" });
    } catch (e: any) {
      setAnalysisError(e.message || "Failed to analyze context");
      toast({ title: "Analysis failed", description: e.message || "Check your connection and try again", variant: "error" });
    } finally {
      setAnalyzing(false);
    }
  }

  // ---------- file upload ----------

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
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["csv", "xlsx", "xls"].includes(ext || "")) return;
    const sizeStr = file.size < 1024 * 1024
      ? `${(file.size / 1024).toFixed(1)} KB`
      : `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
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

  // ---------- submit ----------

  async function handleSubmit() {
    setLoading(true);
    try {
      const config = {
        name: name || `${category} simulation`,
        description,
        category,
        variables: variables.map((v, i) => ({
          id: `var-${i}`,
          name: v.name,
          label: v.label,
          type: "number" as const,
          value: v.value,
          min: v.min,
          max: v.max,
          unit: v.unit,
        })),
        agents: agents.map((a, i) => ({
          id: `agent-${i}`,
          type: a.type,
          name: a.label,
          count: a.count,
          sensitivity: a.sensitivity,
          behavior_rules: [],
        })),
        num_runs: numRuns,
        time_horizon: timeHorizon,
        company_context: { ...context, acquisitionChannels: selectedChannels },
      };

      const res = await fetch(`${getApiUrl()}/api/simulations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config, user_id: "demo-user" }),
      });

      if (!res.ok) throw new Error("Failed to create simulation");
      const sim = await res.json();

      // Auto-run the simulation
      await fetch(`${getApiUrl()}/api/simulations/${sim.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ num_runs: numRuns }),
      });

      toast({ title: "Simulation launched", description: `Running ${numRuns.toLocaleString()} Monte Carlo iterations...`, variant: "success" });
      router.push(`/simulations/${sim.id}`);
    } catch (err: any) {
      console.error("Submit error:", err);
      toast({ title: "Failed to launch simulation", description: err.message || "Check your connection", variant: "error" });
      setLoading(false);
    }
  }

  // ---------- domain helpers ----------

  const isBusiness = ["startup", "pricing", "policy", "marketing", "product", "custom"].includes(category);
  const isFinance = category === "finance";
  const isBiology = category === "biology";
  const isTrend = category === "trend";

  const hasMinContext = (() => {
    if (isBusiness) return !!(context.companyName && context.industry);
    if (isFinance) return !!(context.investmentType && context.startingCapital);
    if (isBiology) return !!(context.researchGoal && context.targetMolecule);
    if (isTrend) return !!(context.dataDomain && context.forecastHorizon);
    return true;
  })();

  // ---------- helpers ----------

  const FieldLabel = ({ label, tip, required }: { label: string; tip?: string; required?: boolean }) => (
    <div className="flex items-center gap-1.5">
      <Label className="text-xs text-white/50">{label}{required && " *"}</Label>
      {tip && (
        <Tooltip>
          <TooltipTrigger asChild>
            <HelpCircle className="w-3 h-3 text-white/20 hover:text-white/40 transition-colors cursor-help" />
          </TooltipTrigger>
          <TooltipContent>{tip}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );

  // ---------- render ----------

  return (
    <TooltipProvider delayDuration={200}>
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard"><ArrowLeft className="w-4 h-4" /></Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-white">New Simulation</h1>
            <span className="text-[10px] text-white/20 tracking-widest uppercase">
              step {step} of {totalSteps}
            </span>
          </div>
        </div>
      </div>

      {/* Step Progress with labels */}
      <div className="mb-8">
        <div className="flex gap-1 mb-2">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "flex-1 h-0.5 transition-all duration-500",
                i < step ? "bg-white/50" : i === step - 1 ? "bg-white/30" : "bg-white/[0.06]"
              )}
            />
          ))}
        </div>
        <div className="flex justify-between">
          {["scenario", "analysis", "variables", "data", "review"].map((label, i) => (
            <span
              key={label}
              className={cn(
                "text-[9px] tracking-widest uppercase transition-colors",
                i < step ? "text-white/40" : i === step - 1 ? "text-white/60" : "text-white/10"
              )}
            >
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* ==================== STEP 1: Category + Company Context ==================== */}
      {step === 1 && (
        <div className="animate-fade-in">
          <h2 className="text-xl font-semibold text-white mb-1">Tell us about your scenario</h2>
          <p className="text-xs text-white/35 mb-6">The more detail you provide, the more accurate your simulation will be.</p>

          {/* Category picker */}
          <div className="grid grid-cols-3 gap-px bg-white/[0.05] mb-8">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => { setCategory(cat.id as SimulationCategory); setContext({}); setSelectedChannels([]); setAnalysis(null); }}
                className={cn(
                  "p-4 text-left transition-all bg-[#0a0a0a] hover:bg-white/[0.03]",
                  category === cat.id ? "bg-white/[0.05] border-l-2 border-l-white/40" : ""
                )}
              >
                <cat.icon className={cn("w-4 h-4 mb-2", category === cat.id ? "text-white" : "text-white/25")} />
                <div className={cn("text-xs font-medium", category === cat.id ? "text-white" : "text-white/40")}>{cat.label}</div>
              </button>
            ))}
          </div>

          {/* Simulation name */}
          <div className="space-y-4 mb-6">
            <div>
              <Label className="text-xs text-white/50">Simulation Name</Label>
              <Input className="mt-1" placeholder="e.g., Q2 Launch Scenario" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs text-white/50">What are you trying to figure out? (optional)</Label>
              <textarea
                className="mt-1 w-full border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/20 resize-none h-16"
                placeholder="e.g., Should we raise prices 20% or expand into EU first?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>

          {/* ---- BUSINESS CONTEXT FORM ---- */}
          {isBusiness && (
            <div className="space-y-4">
              <div className="text-xs text-white/20 tracking-widest uppercase mb-2">company details</div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-white/50">Company Name *</Label>
                  <Input className="mt-1" placeholder="Acme Inc." value={context.companyName || ""} onChange={(e) => updateContext("companyName", e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs text-white/50">Industry *</Label>
                  <Select value={context.industry || ""} onValueChange={(v) => updateContext("industry", v)}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select industry" /></SelectTrigger>
                    <SelectContent>
                      {industryOptions.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-white/50">Business Model</Label>
                  <Select value={context.businessModel || ""} onValueChange={(v) => updateContext("businessModel", v)}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select model" /></SelectTrigger>
                    <SelectContent>
                      {businessModelOptions.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-white/50">Stage</Label>
                  <Select value={context.stage || ""} onValueChange={(v) => updateContext("stage", v)}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select stage" /></SelectTrigger>
                    <SelectContent>
                      {stageOptions.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="text-xs text-white/20 tracking-widest uppercase mt-6 mb-2">financials</div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <FieldLabel label="Current MRR" tip="Monthly Recurring Revenue — your predictable monthly income from subscriptions or contracts." />
                  <Input className="mt-1" placeholder="$0" value={context.currentMrr || ""} onChange={(e) => updateContext("currentMrr", e.target.value)} />
                </div>
                <div>
                  <FieldLabel label="Monthly Burn Rate" tip="Total monthly cash outflow including salaries, rent, tools, and other operating costs." />
                  <Input className="mt-1" placeholder="$25,000" value={context.monthlyBurn || ""} onChange={(e) => updateContext("monthlyBurn", e.target.value)} />
                </div>
                <div>
                  <FieldLabel label="Runway" tip="How many months of cash you have left at the current burn rate before running out." />
                  <Input className="mt-1" placeholder="18" value={context.runwayMonths || ""} onChange={(e) => updateContext("runwayMonths", e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label className="text-xs text-white/50">Team Size</Label>
                  <Input className="mt-1" placeholder="5" value={context.teamSize || ""} onChange={(e) => updateContext("teamSize", e.target.value)} />
                </div>
                <div>
                  <FieldLabel label="Total Funding Raised" tip="Total capital raised from investors (seed, Series A, etc.) — helps AI calibrate growth expectations." />
                  <Input className="mt-1" placeholder="$500K" value={context.fundingRaised || ""} onChange={(e) => updateContext("fundingRaised", e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs text-white/50">Current Customers</Label>
                  <Input className="mt-1" placeholder="150" value={context.customerCount || ""} onChange={(e) => updateContext("customerCount", e.target.value)} />
                </div>
              </div>

              <div className="text-xs text-white/20 tracking-widest uppercase mt-6 mb-2">market & competition</div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FieldLabel label="Target Market Size (TAM)" tip="Total Addressable Market — the total revenue opportunity available if you captured 100% of the market." />
                  <Input className="mt-1" placeholder="$2B" value={context.targetMarketSize || ""} onChange={(e) => updateContext("targetMarketSize", e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs text-white/50">Geographic Market</Label>
                  <Input className="mt-1" placeholder="US, Europe" value={context.geoMarket || ""} onChange={(e) => updateContext("geoMarket", e.target.value)} />
                </div>
              </div>

              <div>
                <Label className="text-xs text-white/50">Top Competitors (comma-separated)</Label>
                <Input className="mt-1" placeholder="Competitor A, Competitor B, Competitor C" value={context.competitors || ""} onChange={(e) => updateContext("competitors", e.target.value)} />
              </div>

              <div>
                <Label className="text-xs text-white/50">Key Differentiator</Label>
                <textarea
                  className="mt-1 w-full border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/20 resize-none h-16"
                  placeholder="What makes your product different from competitors?"
                  value={context.differentiator || ""}
                  onChange={(e) => updateContext("differentiator", e.target.value)}
                />
              </div>

              <div className="text-xs text-white/20 tracking-widest uppercase mt-6 mb-2">pricing & growth</div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-white/50">Pricing Model</Label>
                  <Input className="mt-1" placeholder="$49/mo subscription" value={context.pricingModel || ""} onChange={(e) => updateContext("pricingModel", e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs text-white/50">Current Price Point</Label>
                  <Input className="mt-1" placeholder="$49/mo" value={context.currentPrice || ""} onChange={(e) => updateContext("currentPrice", e.target.value)} />
                </div>
              </div>

              <div>
                <Label className="text-xs text-white/50">Acquisition Channels</Label>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {channelOptions.map((ch) => (
                    <button
                      key={ch}
                      onClick={() => toggleChannel(ch)}
                      className={cn(
                        "px-2.5 py-1 text-[11px] border transition-colors",
                        selectedChannels.includes(ch)
                          ? "border-white/30 bg-white/10 text-white"
                          : "border-white/10 text-white/30 hover:border-white/20"
                      )}
                    >
                      {ch}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ---- FINANCE CONTEXT FORM ---- */}
          {isFinance && (
            <div className="space-y-4">
              <div className="text-xs text-white/20 tracking-widest uppercase mb-2">investment details</div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-white/50">Investment Type *</Label>
                  <Select value={context.investmentType || ""} onValueChange={(v) => updateContext("investmentType", v)}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select type" /></SelectTrigger>
                    <SelectContent>
                      {["Stocks / Equities", "Crypto", "Forex", "Commodities", "Mixed portfolio", "Options / Derivatives"].map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-white/50">Starting Capital *</Label>
                  <Input className="mt-1" placeholder="$100,000" value={context.startingCapital || ""} onChange={(e) => updateContext("startingCapital", e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-white/50">Investment Horizon</Label>
                  <Input className="mt-1" placeholder="12 months" value={context.investmentHorizon || ""} onChange={(e) => updateContext("investmentHorizon", e.target.value)} />
                </div>
                <div>
                  <FieldLabel label="Risk Profile" tip="Your tolerance for volatility — conservative means lower risk/reward, aggressive means higher." />
                  <Select value={context.riskProfile || ""} onValueChange={(v) => updateContext("riskProfile", v)}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select profile" /></SelectTrigger>
                    <SelectContent>
                      {riskProfileOptions.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-xs text-white/50">Target Assets / Tickers</Label>
                <Input className="mt-1" placeholder="AAPL, TSLA, BTC, ETH" value={context.targetAssets || ""} onChange={(e) => updateContext("targetAssets", e.target.value)} />
              </div>
              <div>
                <Label className="text-xs text-white/50">Current Portfolio (describe what you hold)</Label>
                <textarea className="mt-1 w-full border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/20 resize-none h-16" placeholder="60% S&P 500 index, 20% tech stocks, 10% bonds, 10% crypto" value={context.portfolioComposition || ""} onChange={(e) => updateContext("portfolioComposition", e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-white/50">Market Conditions</Label>
                  <Select value={context.marketCondition || ""} onValueChange={(v) => updateContext("marketCondition", v)}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select condition" /></SelectTrigger>
                    <SelectContent>
                      {marketConditionOptions.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <FieldLabel label="Income Requirements" tip="Monthly income you need the portfolio to generate (e.g., for living expenses)." />
                  <Input className="mt-1" placeholder="$0 / month" value={context.incomeRequirements || ""} onChange={(e) => updateContext("incomeRequirements", e.target.value)} />
                </div>
              </div>
            </div>
          )}

          {/* ---- BIOLOGY CONTEXT FORM ---- */}
          {isBiology && (
            <div className="space-y-4">
              <div className="text-xs text-white/20 tracking-widest uppercase mb-2">research details</div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-white/50">Research Goal *</Label>
                  <Select value={context.researchGoal || ""} onValueChange={(v) => updateContext("researchGoal", v)}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select goal" /></SelectTrigger>
                    <SelectContent>
                      {["Drug binding simulation", "Protein folding dynamics", "Enzyme kinetics", "Molecular interaction screening", "Conformational analysis", "Other"].map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-white/50">Target Molecule / Protein *</Label>
                  <Input className="mt-1" placeholder="e.g., EGFR, insulin, aspirin" value={context.targetMolecule || ""} onChange={(e) => updateContext("targetMolecule", e.target.value)} />
                </div>
              </div>
              <div>
                <FieldLabel label="Known Binding Partners / Ligands" tip="Molecules known to interact with your target — helps calibrate binding affinity parameters." />
                <Input className="mt-1" placeholder="e.g., gefitinib, erlotinib" value={context.bindingPartners || ""} onChange={(e) => updateContext("bindingPartners", e.target.value)} />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label className="text-xs text-white/50">Temperature Range</Label>
                  <Input className="mt-1" placeholder="298-310 K" value={context.temperatureRange || ""} onChange={(e) => updateContext("temperatureRange", e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs text-white/50">pH Range</Label>
                  <Input className="mt-1" placeholder="6.5-8.0" value={context.phRange || ""} onChange={(e) => updateContext("phRange", e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs text-white/50">Solvent</Label>
                  <Input className="mt-1" placeholder="Water, PBS buffer" value={context.solvent || ""} onChange={(e) => updateContext("solvent", e.target.value)} />
                </div>
              </div>
              <div>
                <Label className="text-xs text-white/50">Existing Experimental Data</Label>
                <textarea className="mt-1 w-full border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/20 resize-none h-16" placeholder="Describe any IC50, Kd, or kinetic data you have" value={context.experimentalData || ""} onChange={(e) => updateContext("experimentalData", e.target.value)} />
              </div>
              <div>
                <FieldLabel label="Desired Outcome" tip="The success criteria for your simulation — e.g., binding affinity threshold, reaction rate target." />
                <Input className="mt-1" placeholder="e.g., Binding affinity < 10 nM" value={context.desiredOutcome || ""} onChange={(e) => updateContext("desiredOutcome", e.target.value)} />
              </div>
            </div>
          )}

          {/* ---- TREND CONTEXT FORM ---- */}
          {isTrend && (
            <div className="space-y-4">
              <div className="text-xs text-white/20 tracking-widest uppercase mb-2">data & forecast details</div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-white/50">Data Domain *</Label>
                  <Select value={context.dataDomain || ""} onValueChange={(v) => updateContext("dataDomain", v)}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select domain" /></SelectTrigger>
                    <SelectContent>
                      {["Sales / revenue", "Web traffic / analytics", "Stock prices", "Sensor / IoT data", "Economic indicators", "Social media metrics", "Scientific measurements", "Other"].map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-white/50">Forecast Horizon *</Label>
                  <Input className="mt-1" placeholder="30 days, 6 months, etc." value={context.forecastHorizon || ""} onChange={(e) => updateContext("forecastHorizon", e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-white/50">Historical Data Period</Label>
                  <Input className="mt-1" placeholder="2 years of daily data" value={context.historicalPeriod || ""} onChange={(e) => updateContext("historicalPeriod", e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs text-white/50">Data Frequency</Label>
                  <Select value={context.dataFrequency || ""} onValueChange={(v) => updateContext("dataFrequency", v)}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select frequency" /></SelectTrigger>
                    <SelectContent>
                      {dataFrequencyOptions.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-xs text-white/50">Known Seasonal Patterns</Label>
                <Input className="mt-1" placeholder="e.g., spikes in Q4, dips in summer" value={context.seasonalPatterns || ""} onChange={(e) => updateContext("seasonalPatterns", e.target.value)} />
              </div>
              <div>
                <Label className="text-xs text-white/50">External Factors to Consider</Label>
                <textarea className="mt-1 w-full border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/20 resize-none h-16" placeholder="e.g., competitor launches, marketing campaigns, regulatory changes" value={context.externalFactors || ""} onChange={(e) => updateContext("externalFactors", e.target.value)} />
              </div>
            </div>
          )}

          <div className="flex justify-end mt-8">
            <Button variant="gradient" onClick={() => { setStep(2); runAnalysis(); }} disabled={!name.trim() || !hasMinContext}>
              Analyze with AI <Sparkles className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ==================== STEP 2: AI Analysis ==================== */}
      {step === 2 && (
        <div className="animate-fade-in">
          <h2 className="text-xl font-semibold text-white mb-1">AI Analysis</h2>
          <p className="text-xs text-white/35 mb-8">Claude is analyzing your scenario and generating a realistic simulation configuration.</p>

          {analyzing && (
            <div className="surface p-12 flex flex-col items-center justify-center text-center">
              <Loader2 className="w-8 h-8 text-white/30 animate-spin mb-4" />
              <p className="text-sm text-white/50 mb-1">Analyzing your scenario...</p>
              <p className="text-xs text-white/25">Building simulation variables from your company data</p>
            </div>
          )}

          {analysisError && (
            <div className="surface p-8">
              <div className="flex items-start gap-3 mb-4">
                <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm text-white mb-1">Analysis failed</p>
                  <p className="text-xs text-white/40">{analysisError}</p>
                </div>
              </div>
              <Button variant="ghost" onClick={() => { runAnalysis(); }}>
                <Loader2 className="w-3 h-3 mr-1" /> Retry
              </Button>
            </div>
          )}

          {analysis && !analyzing && (
            <div className="space-y-6">
              {/* Generated variables preview */}
              <div className="surface">
                <div className="px-5 py-3 border-b border-white/[0.06] flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-white/30" />
                  <span className="text-xs text-white/25 tracking-widest uppercase">generated variables</span>
                  <span className="text-[10px] text-white/15 ml-auto">{analysis.variables.length} variables</span>
                </div>
                <div className="divide-y divide-white/[0.04]">
                  {analysis.variables.map((v) => (
                    <div key={v.name} className="px-5 py-3 flex items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-white/70 font-medium">{v.label}</div>
                        <div className="text-[10px] text-white/25 truncate">{v.reasoning}</div>
                      </div>
                      <div className="text-sm text-white font-mono shrink-0">
                        {v.unit === "$" ? `$${v.value.toLocaleString()}` : `${v.value}${v.unit}`}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Generated agents preview */}
              <div className="surface">
                <div className="px-5 py-3 border-b border-white/[0.06] flex items-center gap-2">
                  <span className="text-xs text-white/25 tracking-widest uppercase">agents</span>
                  <span className="text-[10px] text-white/15 ml-auto">{analysis.agents.length} agent types</span>
                </div>
                <div className="divide-y divide-white/[0.04]">
                  {analysis.agents.map((a) => (
                    <div key={a.type} className="px-5 py-3 flex items-center gap-4">
                      <div className="flex-1">
                        <div className="text-xs text-white/70 font-medium">{a.label}</div>
                        <div className="text-[10px] text-white/25">{a.reasoning}</div>
                      </div>
                      <span className="tag text-[10px]">{a.count} agents</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Assumptions */}
              <div className="surface">
                <div className="px-5 py-3 border-b border-white/[0.06]">
                  <span className="text-xs text-white/25 tracking-widest uppercase">key assumptions</span>
                </div>
                <div className="px-5 py-3 space-y-1.5">
                  {analysis.assumptions.map((a, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-white/40">
                      <div className="w-1 h-1 bg-white/20 shrink-0 mt-1.5" />
                      <span>{a}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Success criteria */}
              <div className="surface px-5 py-3">
                <div className="text-[10px] text-white/20 tracking-widest uppercase mb-1">success criteria</div>
                <p className="text-xs text-white/50">{analysis.successCriteria}</p>
              </div>

              <div className="flex justify-between mt-8">
                <Button variant="ghost" onClick={() => setStep(1)}>
                  <ArrowLeft className="w-4 h-4" /> Edit Context
                </Button>
                <Button variant="gradient" onClick={() => setStep(3)}>
                  Looks Good — Fine-Tune <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================== STEP 3: Fine-Tune Variables ==================== */}
      {step === 3 && (
        <div className="animate-fade-in">
          <h2 className="text-xl font-semibold text-white mb-1">Fine-Tune Variables</h2>
          <p className="text-xs text-white/35 mb-6">AI-generated values pre-filled from your context. Adjust anything that doesn't look right.</p>

          {/* Data upload (optional) */}
          <div className="surface mb-6">
            <div className="px-5 py-3 border-b border-white/[0.06] flex items-center gap-2">
              <Upload className="w-3.5 h-3.5 text-white/30" />
              <span className="text-xs text-white/25 tracking-widest uppercase">upload data (optional)</span>
            </div>
            <div className="p-5">
              {!uploadedData ? (
                <div
                  className={cn("border border-dashed p-5 flex flex-col items-center justify-center text-center transition-colors cursor-pointer", dragOver ? "border-white/40 bg-white/[0.04]" : "border-white/[0.15] hover:border-white/[0.25]")}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleFileDrop}
                  onClick={() => document.getElementById("file-input")?.click()}
                >
                  <Upload className="w-4 h-4 text-white/20 mb-1.5" />
                  <p className="text-[11px] text-white/35">Drop CSV or Excel to override variables with real data</p>
                  <input id="file-input" type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleFileSelect} />
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <FileSpreadsheet className="w-4 h-4 text-white/30" />
                  <span className="text-xs text-white/60">{uploadedData.fileName}</span>
                  <span className="text-[10px] text-emerald-400/70">✓ parsed</span>
                  <button onClick={() => setUploadedData(null)} className="ml-auto text-white/20 hover:text-white/50"><X className="w-3.5 h-3.5" /></button>
                </div>
              )}
            </div>
          </div>

          {/* Variable sliders */}
          <div className="space-y-4">
            {variables.map((variable, idx) => (
              <div key={variable.name} className="surface p-4">
                <SliderWithInput
                  label={variable.label}
                  sublabel={variable.reasoning}
                  min={variable.min}
                  max={variable.max}
                  value={variable.value}
                  onChange={(val) => {
                    const updated = [...variables];
                    updated[idx] = { ...updated[idx], value: val };
                    setVariables(updated);
                  }}
                  unit={variable.unit}
                  unitPosition={variable.unit === "$" ? "prefix" : "suffix"}
                />
              </div>
            ))}
          </div>

          <div className="flex justify-between mt-8">
            <Button variant="ghost" onClick={() => setStep(2)}>
              <ArrowLeft className="w-4 h-4" /> Back
            </Button>
            <Button variant="gradient" onClick={() => setStep(4)}>
              Continue <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ==================== STEP 4: Agents ==================== */}
      {step === 4 && (
        <div className="animate-fade-in">
          <h2 className="text-xl font-semibold text-white mb-1">AI Agents</h2>
          <p className="text-xs text-white/35 mb-6">These agents were configured based on your scenario. Adjust counts or remove any.</p>

          <div className="space-y-3">
            {agents.map((agent, idx) => (
              <div key={agent.type} className="surface p-4 flex items-center gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-medium text-white">{agent.label}</span>
                    <span className="tag tag-green text-[10px]">active</span>
                  </div>
                  <p className="text-[10px] text-white/25">{agent.reasoning}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={agent.count}
                    onChange={(e) => {
                      const updated = [...agents];
                      updated[idx] = { ...updated[idx], count: parseInt(e.target.value) || 1 };
                      setAgents(updated);
                    }}
                    className="w-20 h-8 text-xs"
                  />
                  <button
                    onClick={() => setAgents(agents.filter((_, i) => i !== idx))}
                    className="text-white/20 hover:text-red-400 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-between mt-8">
            <Button variant="ghost" onClick={() => setStep(3)}>
              <ArrowLeft className="w-4 h-4" /> Back
            </Button>
            <Button variant="gradient" onClick={() => setStep(5)} disabled={agents.length === 0}>
              Continue <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ==================== STEP 5: Review & Launch ==================== */}
      {step === 5 && (
        <div className="animate-fade-in">
          <h2 className="text-xl font-semibold text-white mb-1">Review & Launch</h2>
          <p className="text-xs text-white/35 mb-6">Final check before running Monte Carlo simulation.</p>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <Card>
              <CardHeader><CardTitle className="text-sm">Number of Runs</CardTitle></CardHeader>
              <CardContent>
                <SliderWithInput min={100} max={10000} step={100} value={numRuns} onChange={setNumRuns} unit="runs" unitPosition="suffix" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Time Horizon</CardTitle></CardHeader>
              <CardContent>
                <SliderWithInput min={1} max={60} step={1} value={timeHorizon} onChange={setTimeHorizon} unit={isBiology ? "periods" : "months"} unitPosition="suffix" />
              </CardContent>
            </Card>
          </div>

          {/* Summary */}
          <div className="surface mb-6">
            <div className="px-5 py-3 border-b border-white/[0.06]">
              <span className="text-xs text-white/25 tracking-widest uppercase">simulation summary</span>
            </div>
            <div className="px-5 py-3 space-y-2.5">
              {[
                ["name", name],
                ["category", category],
                ["variables", `${variables.length} configured`],
                ["agents", `${agents.reduce((s, a) => s + a.count, 0).toLocaleString()} total across ${agents.length} types`],
                ["runs", numRuns.toLocaleString()],
                ["time horizon", `${timeHorizon} ${isBiology ? "periods" : "months"}`],
                ...(uploadedData ? [["uploaded data", `${uploadedData.fileName} (${uploadedData.rowCount} rows)`]] : []),
                ["est. time", `~${Math.ceil(numRuns / 500)} seconds`],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between text-xs">
                  <span className="text-white/30">{label}</span>
                  <span className="text-white/70">{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Assumptions reminder */}
          {analysis && (
            <div className="surface mb-6 px-5 py-3">
              <div className="text-[10px] text-white/20 tracking-widest uppercase mb-2">ai assumptions</div>
              <div className="space-y-1">
                {analysis.assumptions.slice(0, 5).map((a, i) => (
                  <div key={i} className="flex items-start gap-2 text-[11px] text-white/30">
                    <div className="w-1 h-1 bg-white/15 shrink-0 mt-1.5" />
                    <span>{a}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(4)}>
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
    </TooltipProvider>
  );
}
