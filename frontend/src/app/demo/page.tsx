"use client";

export const dynamic = "force-dynamic";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight, Loader2, Rocket, DollarSign, BarChart2, TrendingUp,
  Lightbulb, BarChart3, Sparkles, Zap,
} from "lucide-react";
import { runDemo } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { SliderWithInput } from "@/components/ui/slider-with-input";
import type { DemoPreset, DemoRunResponse, StoredDemo } from "@/types";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
} from "recharts";
import { ChartDataTable } from "@/components/ui/chart-data-table";

const OUTCOME_COLORS = ["#ef4444", "#f97316", "#eab308", "#84cc16", "#22c55e", "#06b6d4"];

interface SliderDef {
  name: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  unit: string;
  unitPosition: "prefix" | "suffix";
}

interface PresetDef {
  key: DemoPreset;
  title: string;
  blurb: string;
  icon: React.ElementType;
  accent: string; // text color class
  sliders: SliderDef[];
}

// Three presets — the slider names/defaults mirror the hardcoded backend configs.
const PRESETS: PresetDef[] = [
  {
    key: "saas",
    title: "saas startup",
    blurb: "will your saas hit escape velocity? model price, market size, and burn.",
    icon: Rocket,
    accent: "text-violet-400",
    sliders: [
      { name: "price", label: "monthly price", min: 9, max: 199, step: 1, default: 49, unit: "$", unitPosition: "prefix" },
      { name: "market_size", label: "addressable market", min: 1000, max: 500000, step: 1000, default: 50000, unit: "", unitPosition: "suffix" },
      { name: "monthly_burn", label: "monthly burn", min: 5000, max: 200000, step: 1000, default: 40000, unit: "$", unitPosition: "prefix" },
    ],
  },
  {
    key: "pricing",
    title: "pricing strategy",
    blurb: "find the price that maximizes revenue without bleeding conversion.",
    icon: DollarSign,
    accent: "text-cyan-400",
    sliders: [
      { name: "price", label: "list price", min: 9, max: 299, step: 1, default: 79, unit: "$", unitPosition: "prefix" },
      { name: "conversion_rate", label: "conversion rate", min: 1, max: 25, step: 1, default: 8, unit: "%", unitPosition: "suffix" },
      { name: "market_size", label: "addressable market", min: 1000, max: 500000, step: 1000, default: 80000, unit: "", unitPosition: "suffix" },
    ],
  },
  {
    key: "portfolio",
    title: "investment portfolio",
    blurb: "how risky is your allocation? model capital, risk appetite, and horizon.",
    icon: BarChart2,
    accent: "text-green-400",
    sliders: [
      { name: "starting_capital", label: "starting capital", min: 10000, max: 1000000, step: 10000, default: 100000, unit: "$", unitPosition: "prefix" },
      { name: "risk_level", label: "risk level", min: 1, max: 10, step: 1, default: 5, unit: "", unitPosition: "suffix" },
      { name: "horizon_months", label: "horizon", min: 6, max: 60, step: 1, default: 24, unit: "mo", unitPosition: "suffix" },
    ],
  },
];

export default function DemoPage() {
  const { toast } = useToast();
  const [active, setActive] = useState<DemoPreset>("saas");
  const [overrides, setOverrides] = useState<Record<DemoPreset, Record<string, number>>>(() => {
    const init = {} as Record<DemoPreset, Record<string, number>>;
    PRESETS.forEach((p) => {
      init[p.key] = Object.fromEntries(p.sliders.map((s) => [s.name, s.default]));
    });
    return init;
  });
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DemoRunResponse | null>(null);

  const preset = PRESETS.find((p) => p.key === active)!;

  function setSlider(name: string, value: number) {
    setOverrides((prev) => ({ ...prev, [active]: { ...prev[active], [name]: value } }));
  }

  async function handleRun() {
    if (running) return;
    setRunning(true);
    setResult(null);
    try {
      const data = await runDemo(active, overrides[active]);
      setResult(data);
      // Stash for a post-signup claim.
      try {
        const stored: StoredDemo = { demo_id: data.demo_id, config: data.config, results: data.results };
        localStorage.setItem("sylor-demo", JSON.stringify(stored));
      } catch {
        // localStorage unavailable — the claim flow just won't fire later
      }
    } catch (e: any) {
      toast({ title: "demo couldn't run", description: e.message || "you may have hit the demo rate limit — try again shortly", variant: "error" });
    } finally {
      setRunning(false);
    }
  }

  const r = result?.results;
  const successProb = r ? Math.round(r.success_probability ?? 0) : 0;
  const ciLow = r?.confidence_interval?.[0] ?? 0;
  const ciHigh = r?.confidence_interval?.[1] ?? 0;

  const timeline = (r?.timeline_aggregated || []).map((t: any) => ({
    month: `M${t.month}`,
    p10: t.p10_revenue,
    p50: t.avg_revenue,
    p90: t.p90_revenue,
  }));

  const distribution = (r?.outcome_distribution || []).map((d: any, i: number) => ({
    range: d.range,
    probability: d.probability,
    color: OUTCOME_COLORS[i % OUTCOME_COLORS.length],
  }));

  const insights = r?.key_insights || [];

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="flex items-center justify-between mb-10">
        <Link href="/" className="text-sm font-bold tracking-tight text-white/80 hover:text-white transition-colors">
          sylor
        </Link>
        <Link href="/signup" className="btn-ghost text-xs py-2 px-4 inline-flex items-center gap-1.5">
          sign up free <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      <div className="mb-10">
        <span className="tag mb-4 inline-block">zero-signup demo</span>
        <h1 className="text-[clamp(1.8rem,4vw,3rem)] font-bold text-white tracking-tight leading-[1.1] mb-3">
          run a real simulation<br />right now — no account needed
        </h1>
        <p className="text-sm text-white/40 max-w-xl leading-relaxed">
          pick a preset, nudge a few variables, and run a real monte carlo simulation in your browser.
          these are the same engine results you get inside the product.
        </p>
      </div>

      {/* Preset cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-white/[0.05] mb-8">
        {PRESETS.map((p) => {
          const Icon = p.icon;
          const isActive = p.key === active;
          return (
            <button
              key={p.key}
              onClick={() => { setActive(p.key); setResult(null); }}
              className={`text-left p-5 transition-colors ${isActive ? "bg-white/[0.06]" : "bg-[var(--page-bg)] hover:bg-white/[0.03]"}`}
            >
              <Icon className={`w-5 h-5 mb-3 ${isActive ? p.accent : "text-white/30"}`} />
              <div className={`text-sm font-medium mb-1 ${isActive ? "text-white" : "text-white/60"}`}>{p.title}</div>
              <div className="text-[11px] text-white/30 leading-relaxed">{p.blurb}</div>
            </button>
          );
        })}
      </div>

      {/* Sliders + run */}
      <div className="surface p-6 mb-10">
        <div className="text-xs text-white/25 mb-5 tracking-widest uppercase flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5" /> {preset.title} — adjust & run
        </div>
        <div className="space-y-6 mb-6">
          {preset.sliders.map((s) => (
            <SliderWithInput
              key={s.name}
              label={s.label}
              min={s.min}
              max={s.max}
              step={s.step}
              value={overrides[active][s.name]}
              onChange={(v) => setSlider(s.name, v)}
              unit={s.unit}
              unitPosition={s.unitPosition}
            />
          ))}
        </div>
        <button
          onClick={handleRun}
          disabled={running}
          className="btn-primary inline-flex items-center gap-2 disabled:opacity-50"
        >
          {running ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> running monte carlo...</> : <><Zap className="w-3.5 h-3.5" /> run simulation</>}
        </button>
      </div>

      {/* Results */}
      {r && (
        <div className="space-y-6">
          {/* Hero metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-white/[0.05]">
            <div className="bg-[var(--page-bg)] p-8">
              <div className="text-[10px] text-white/25 uppercase tracking-widest mb-3">success probability</div>
              <div className="text-6xl font-bold text-emerald-400 tracking-tight mb-2">{successProb}%</div>
              <div className="text-xs text-white/30">95% confidence: {ciLow.toFixed(1)}% — {ciHigh.toFixed(1)}%</div>
            </div>
            <div className="bg-[var(--page-bg)] p-8">
              <div className="text-[10px] text-white/25 uppercase tracking-widest mb-3">avg revenue</div>
              <div className="text-6xl font-bold text-cyan-400 tracking-tight mb-2">{formatCurrency(r.avg_revenue ?? 0)}</div>
              <div className="text-xs text-white/30">median across all monte carlo runs</div>
            </div>
          </div>

          {/* Revenue timeline */}
          {timeline.length > 0 && (
            <div className="surface p-6">
              <div className="text-xs text-white/25 mb-5 tracking-widest uppercase flex items-center gap-2">
                <TrendingUp className="w-3.5 h-3.5" /> revenue projection — p10 / median / p90
              </div>
              <div role="img" aria-label="Area chart: revenue projection over months, showing p10 (worst 10%), p50 (median), and p90 (best 10%)">
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={timeline} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <defs>
                    <linearGradient id="demoBand" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.18} />
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="demoMedian" x1="0" y1="0" x2="0" y2="1">
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
                  <Area type="monotone" dataKey="p90" stroke="#8b5cf6" strokeWidth={1.5} fill="url(#demoBand)" strokeDasharray="4 2" />
                  <Area type="monotone" dataKey="p50" stroke="#06b6d4" strokeWidth={2} fill="url(#demoMedian)" />
                  <Area type="monotone" dataKey="p10" stroke="#ef4444" strokeWidth={1.5} fill="none" strokeDasharray="4 2" />
                </AreaChart>
              </ResponsiveContainer>
              <ChartDataTable
                caption="Revenue projection by month (p10, median, p90)"
                data={timeline}
                columns={[
                  { key: "month", value: (row: any) => row.month },
                  { key: "p10 (worst 10%)", value: (row: any) => row.p10 },
                  { key: "p50 (median)", value: (row: any) => row.p50 },
                  { key: "p90 (best 10%)", value: (row: any) => row.p90 },
                ]}
              />
              </div>
            </div>
          )}

          {/* Outcome distribution */}
          {distribution.length > 0 && (
            <div className="surface p-6">
              <div className="text-xs text-white/25 mb-5 tracking-widest uppercase flex items-center gap-2">
                <BarChart3 className="w-3.5 h-3.5" /> outcome distribution
              </div>
              <div role="img" aria-label="Bar chart: outcome distribution showing probability percentage per revenue range">
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
                    {distribution.map((entry: any, i: number) => (
                      <Cell key={i} fill={entry.color} opacity={0.8} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <ChartDataTable
                caption="Outcome distribution: probability by revenue range"
                data={distribution}
                columns={[
                  { key: "range", value: (row: any) => row.range },
                  { key: "probability %", value: (row: any) => row.probability },
                ]}
              />
              </div>
            </div>
          )}

          {/* Key insights */}
          {insights.length > 0 && (
            <div className="surface p-6">
              <div className="text-xs text-white/25 mb-5 tracking-widest uppercase flex items-center gap-2">
                <Lightbulb className="w-3.5 h-3.5" /> key insights
              </div>
              <div className="space-y-3">
                {insights.map((insight: string, i: number) => (
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

          {/* Save CTA */}
          <div className="surface p-8 text-center bg-gradient-to-br from-violet-500/10 to-cyan-500/5 border-violet-500/20">
            <p className="text-sm text-white mb-1">like what you see?</p>
            <p className="text-xs text-white/40 mb-5 max-w-md mx-auto leading-relaxed">
              save this simulation to your account — sign up free and we&apos;ll move it straight into your dashboard so you can rerun, branch, and share it.
            </p>
            <Link href="/signup?claim=1" className="btn-primary text-xs py-2.5 px-5 inline-flex items-center gap-1.5">
              save this simulation — sign up free <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      )}

      {!r && (
        <div className="border-t border-white/[0.06] pt-10 text-center">
          <p className="text-xs text-white/25">real monte carlo · runs in your browser · no signup required</p>
        </div>
      )}
    </div>
  );
}
