"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  SlidersHorizontal,
  Play,
  TrendingUp,
  DollarSign,
  Table2,
  Trophy,
  ChevronDown,
} from "lucide-react";
import { onAuthChange } from "@/lib/firebase/auth";
import { getSimulation, sweepVariable } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { ChartDataTable } from "@/components/ui/chart-data-table";

interface SweepPoint {
  value: number;
  success_probability: number;
  avg_revenue: number;
}

interface Variable {
  name: string;
  value: number;
  min?: number;
  max?: number;
  description?: string;
}

export default function SweepPage({ params }: { params: { id: string } }) {
  const searchParams = useSearchParams();
  const [authReady, setAuthReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [simulation, setSimulation] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [selectedVariable, setSelectedVariable] = useState<string>("");
  const [minValue, setMinValue] = useState<number>(0);
  const [maxValue, setMaxValue] = useState<number>(100);
  const [steps, setSteps] = useState<number>(10);
  const [numRuns, setNumRuns] = useState<number>(200);

  // Sweep state
  const [sweeping, setSweeping] = useState(false);
  const [sweepResults, setSweepResults] = useState<SweepPoint[] | null>(null);
  const [sweepError, setSweepError] = useState<string | null>(null);

  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Auth
  useEffect(() => {
    const unsub = onAuthChange((user) => {
      if (user?.uid) setUserId(user.uid);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // Load simulation
  const fetchSimulation = useCallback(async () => {
    try {
      const data = await getSimulation(params.id);
      setSimulation(data);

      const vars: Variable[] = (data?.config?.variables || []) as unknown as Variable[];
      if (vars.length > 0) {
        // Copilot "sweep" suggestions prefill via ?variable=&min=&max=.
        const qVar = searchParams.get("variable");
        const qMin = searchParams.get("min");
        const qMax = searchParams.get("max");
        const chosen = (qVar && vars.find((v) => v.name === qVar)) || vars[0];
        setSelectedVariable(chosen.name);
        const minNum = qMin != null && !Number.isNaN(Number(qMin)) ? Number(qMin) : null;
        const maxNum = qMax != null && !Number.isNaN(Number(qMax)) ? Number(qMax) : null;
        setMinValue(minNum ?? chosen.min ?? Math.round(chosen.value * 0.2));
        setMaxValue(maxNum ?? chosen.max ?? Math.round(chosen.value * 3));
      }
    } catch (err: any) {
      setError(err.message || "Failed to load simulation");
    } finally {
      setLoading(false);
    }
  }, [params.id, searchParams]);

  useEffect(() => {
    if (!authReady) return;
    if (!userId) {
      setLoading(false);
      return;
    }
    fetchSimulation();
  }, [authReady, userId, fetchSimulation]);

  // When variable selection changes, update min/max defaults
  function handleVariableChange(varName: string) {
    setSelectedVariable(varName);
    setDropdownOpen(false);
    const vars: Variable[] = simulation?.config?.variables || [];
    const v = vars.find((vr) => vr.name === varName);
    if (v) {
      setMinValue(v.min ?? Math.round(v.value * 0.2));
      setMaxValue(v.max ?? Math.round(v.value * 3));
    }
    setSweepResults(null);
    setSweepError(null);
  }

  // Run sweep
  async function handleRunSweep() {
    if (!selectedVariable) return;
    setSweeping(true);
    setSweepError(null);
    setSweepResults(null);
    try {
      const data = await sweepVariable(params.id, {
        variable_name: selectedVariable,
        min_value: minValue,
        max_value: maxValue,
        steps,
        num_runs: numRuns,
      });
      setSweepResults(Array.isArray(data) ? data : data.results || []);
    } catch (err: any) {
      setSweepError(err.message || "Sweep failed");
    } finally {
      setSweeping(false);
    }
  }

  const variables: Variable[] = simulation?.config?.variables || [];

  // Optimal point
  const optimalPoint = sweepResults
    ? sweepResults.reduce((best, p) =>
        p.success_probability > best.success_probability ? p : best
      )
    : null;

  // Loading
  if (loading) {
    return (
      <div className="p-8">
        <div className="mb-8">
          <p className="text-xs text-white/25 mb-1 tracking-wide">
            sylor / simulations / sweep
          </p>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            sensitivity analysis
          </h1>
        </div>
        <div className="flex items-center justify-center py-32">
          <Loader2 className="w-6 h-6 animate-spin text-white/20" />
        </div>
      </div>
    );
  }

  // Error loading sim
  if (error) {
    return (
      <div className="p-8">
        <div className="mb-8">
          <p className="text-xs text-white/25 mb-1 tracking-wide">
            sylor / simulations / sweep
          </p>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            sensitivity analysis
          </h1>
        </div>
        <div className="flex flex-col items-center justify-center py-32">
          <div className="text-xs text-red-400/70 mb-3">{error}</div>
          <Link
            href="/simulations"
            className="text-xs text-white/40 hover:text-white/70 border border-white/10 px-3 py-1.5 transition-colors"
          >
            back to simulations
          </Link>
        </div>
      </div>
    );
  }

  // No variables
  if (variables.length === 0) {
    return (
      <div className="p-8">
        <div className="mb-8">
          <p className="text-xs text-white/25 mb-1 tracking-wide">
            sylor / simulations / sweep
          </p>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            sensitivity analysis
          </h1>
        </div>
        <div className="flex flex-col items-center justify-center py-32">
          <div className="text-xs text-white/30 mb-3">
            this simulation has no variables to sweep
          </div>
          <Link
            href={`/simulations/${params.id}`}
            className="text-xs text-white/40 hover:text-white/70 border border-white/10 px-3 py-1.5 transition-colors"
          >
            back to simulation
          </Link>
        </div>
      </div>
    );
  }

  const selectedVar = variables.find((v) => v.name === selectedVariable);

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <p className="text-xs text-white/25 mb-1 tracking-wide">
          sylor / simulations / sweep
        </p>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">
              sensitivity analysis
            </h1>
            <p className="text-xs text-white/30 mt-1">
              {simulation?.name} — sweep a variable across its range to see how
              it affects outcomes
            </p>
          </div>
          <Link
            href={`/simulations/${params.id}`}
            className="text-xs text-white/30 hover:text-white/60 border border-white/[0.06] px-3 py-1.5 inline-flex items-center gap-1.5 transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
            back to simulation
          </Link>
        </div>
      </div>

      {/* Configuration form */}
      <div className="bg-white/[0.05] mb-8">
        <div className="bg-[var(--page-bg)] p-5">
          <div className="flex items-center gap-2 mb-5">
            <SlidersHorizontal className="w-3.5 h-3.5 text-white/20" />
            <span className="text-[10px] text-white/25 uppercase tracking-widest">
              sweep configuration
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-px bg-white/[0.05]">
            {/* Variable selector */}
            <div className="bg-[var(--page-bg)] p-4 lg:col-span-2">
              <label className="text-[10px] text-white/25 uppercase tracking-wider block mb-2">
                variable to sweep
              </label>
              <div className="relative">
                <button
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="w-full flex items-center justify-between bg-white/[0.03] border border-white/[0.06] px-3 py-2.5 text-xs text-white/70 hover:bg-white/[0.05] transition-colors"
                >
                  <span>{selectedVariable || "select variable"}</span>
                  <ChevronDown className="w-3 h-3 text-white/30" />
                </button>
                {dropdownOpen && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[var(--page-bg)] border border-white/[0.08] max-h-60 overflow-y-auto">
                    {variables.map((v) => (
                      <button
                        key={v.name}
                        onClick={() => handleVariableChange(v.name)}
                        className={`w-full text-left px-3 py-2.5 text-xs hover:bg-white/[0.05] transition-colors ${
                          v.name === selectedVariable
                            ? "text-violet-400 bg-violet-400/[0.05]"
                            : "text-white/50"
                        }`}
                      >
                        <div className="text-white/70">{v.name}</div>
                        <div className="text-[10px] text-white/20 mt-0.5">
                          current: {v.value.toLocaleString()}
                          {v.description ? ` — ${v.description}` : ""}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Min value */}
            <div className="bg-[var(--page-bg)] p-4">
              <label className="text-[10px] text-white/25 uppercase tracking-wider block mb-2">
                min value
              </label>
              <input
                type="number"
                value={minValue}
                onChange={(e) => setMinValue(Number(e.target.value))}
                className="w-full bg-white/[0.03] border border-white/[0.06] px-3 py-2.5 text-xs text-white/70 focus:outline-none focus:border-violet-400/30"
              />
            </div>

            {/* Max value */}
            <div className="bg-[var(--page-bg)] p-4">
              <label className="text-[10px] text-white/25 uppercase tracking-wider block mb-2">
                max value
              </label>
              <input
                type="number"
                value={maxValue}
                onChange={(e) => setMaxValue(Number(e.target.value))}
                className="w-full bg-white/[0.03] border border-white/[0.06] px-3 py-2.5 text-xs text-white/70 focus:outline-none focus:border-violet-400/30"
              />
            </div>

            {/* Steps */}
            <div className="bg-[var(--page-bg)] p-4">
              <label className="text-[10px] text-white/25 uppercase tracking-wider block mb-2">
                steps ({steps})
              </label>
              <input
                type="range"
                min={3}
                max={20}
                value={steps}
                onChange={(e) => setSteps(Number(e.target.value))}
                className="w-full mt-2 accent-violet-400"
              />
            </div>
          </div>

          {/* Num runs and run button */}
          <div className="flex items-end justify-between mt-4 gap-4">
            <div>
              <label className="text-[10px] text-white/25 uppercase tracking-wider block mb-2">
                runs per step ({numRuns})
              </label>
              <input
                type="range"
                min={50}
                max={2000}
                step={50}
                value={numRuns}
                onChange={(e) => setNumRuns(Number(e.target.value))}
                className="w-48 accent-violet-400"
              />
            </div>
            <button
              onClick={handleRunSweep}
              disabled={sweeping || !selectedVariable}
              className={`text-xs py-2.5 px-5 inline-flex items-center gap-2 transition-colors ${
                sweeping || !selectedVariable
                  ? "border border-white/[0.06] text-white/15 cursor-not-allowed"
                  : "btn-primary"
              }`}
            >
              {sweeping ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  running sweep...
                </>
              ) : (
                <>
                  <Play className="w-3 h-3" />
                  run sweep
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Sweep error */}
      {sweepError && (
        <div className="bg-red-400/[0.05] border border-red-400/20 p-4 mb-8">
          <div className="text-xs text-red-400/70">{sweepError}</div>
        </div>
      )}

      {/* Loading state */}
      {sweeping && (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-violet-400/40 mb-4" />
          <div className="text-xs text-white/30 mb-1">
            running {steps} steps x {numRuns} runs each
          </div>
          <div className="text-[10px] text-white/15">
            sweeping {selectedVariable} from{" "}
            {minValue.toLocaleString()} to {maxValue.toLocaleString()}
          </div>
        </div>
      )}

      {/* Results */}
      {sweepResults && sweepResults.length > 0 && (
        <>
          {/* Optimal point highlight */}
          {optimalPoint && (
            <div className="bg-white/[0.05] mb-8">
              <div className="bg-[var(--page-bg)] p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Trophy className="w-3.5 h-3.5 text-emerald-400/60" />
                  <span className="text-[10px] text-white/25 uppercase tracking-widest">
                    optimal value
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-px bg-white/[0.05]">
                  <div className="bg-[var(--page-bg)] p-4">
                    <div className="text-[10px] text-white/20 mb-1">
                      {selectedVariable}
                    </div>
                    <div className="text-2xl font-bold text-emerald-400">
                      {optimalPoint.value.toLocaleString()}
                    </div>
                  </div>
                  <div className="bg-[var(--page-bg)] p-4">
                    <div className="text-[10px] text-white/20 mb-1">
                      best success probability
                    </div>
                    <div className="text-2xl font-bold text-white">
                      {optimalPoint.success_probability.toFixed(1)}%
                    </div>
                  </div>
                  <div className="bg-[var(--page-bg)] p-4">
                    <div className="text-[10px] text-white/20 mb-1">
                      avg revenue at optimum
                    </div>
                    <div className="text-2xl font-bold text-white/70">
                      {formatCurrency(optimalPoint.avg_revenue)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-white/[0.05] mb-8">
            {/* Success probability line chart */}
            <div className="bg-[var(--page-bg)] p-5">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="w-3.5 h-3.5 text-white/20" />
                <span className="text-[10px] text-white/25 uppercase tracking-widest">
                  success probability vs {selectedVariable}
                </span>
              </div>
              <div role="img" aria-label={`Line chart: success probability versus ${selectedVariable}`}>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart
                  data={sweepResults}
                  margin={{ top: 5, right: 10, left: -10, bottom: 5 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--chart-grid)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="value"
                    tick={{ fontSize: 9, fill: "var(--chart-text)" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) =>
                      v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
                    }
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "var(--chart-text)" }}
                    axisLine={false}
                    tickLine={false}
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--chart-tooltip-bg)",
                      border: "1px solid var(--chart-tooltip-border)",
                      fontSize: 11,
                    }}
                    formatter={(v: number) => [
                      `${v.toFixed(1)}%`,
                      "Success Probability",
                    ]}
                    labelFormatter={(v: number) =>
                      `${selectedVariable}: ${v.toLocaleString()}`
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="success_probability"
                    stroke="rgba(139,92,246,0.8)"
                    strokeWidth={2}
                    dot={{ fill: "rgba(139,92,246,0.8)", r: 3 }}
                    activeDot={{ r: 5, fill: "rgba(139,92,246,1)" }}
                  />
                </LineChart>
              </ResponsiveContainer>
              <ChartDataTable
                caption={`Success probability versus ${selectedVariable}`}
                data={sweepResults}
                columns={[
                  { key: selectedVariable, value: (row) => row.value },
                  { key: "success probability (%)", value: (row) => row.success_probability },
                ]}
              />
              </div>
            </div>

            {/* Revenue area chart */}
            <div className="bg-[var(--page-bg)] p-5">
              <div className="flex items-center gap-2 mb-4">
                <DollarSign className="w-3.5 h-3.5 text-white/20" />
                <span className="text-[10px] text-white/25 uppercase tracking-widest">
                  avg revenue vs {selectedVariable}
                </span>
              </div>
              <div role="img" aria-label={`Area chart: average revenue versus ${selectedVariable}`}>
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart
                  data={sweepResults}
                  margin={{ top: 5, right: 10, left: -10, bottom: 5 }}
                >
                  <defs>
                    <linearGradient
                      id="revenueGrad"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="5%"
                        stopColor="rgba(6,182,212,0.3)"
                      />
                      <stop
                        offset="95%"
                        stopColor="rgba(6,182,212,0)"
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--chart-grid)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="value"
                    tick={{ fontSize: 9, fill: "var(--chart-text)" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) =>
                      v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
                    }
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "var(--chart-text)" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => formatCurrency(v)}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--chart-tooltip-bg)",
                      border: "1px solid var(--chart-tooltip-border)",
                      fontSize: 11,
                    }}
                    formatter={(v: number) => [
                      formatCurrency(v),
                      "Avg Revenue",
                    ]}
                    labelFormatter={(v: number) =>
                      `${selectedVariable}: ${v.toLocaleString()}`
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey="avg_revenue"
                    stroke="rgba(6,182,212,0.7)"
                    strokeWidth={2}
                    fill="url(#revenueGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
              <ChartDataTable
                caption={`Average revenue versus ${selectedVariable}`}
                data={sweepResults}
                columns={[
                  { key: selectedVariable, value: (row) => row.value },
                  { key: "avg revenue", value: (row) => row.avg_revenue },
                ]}
              />
              </div>
            </div>
          </div>

          {/* Results table */}
          <div className="bg-white/[0.05] mb-8">
            <div className="bg-[var(--page-bg)] p-5">
              <div className="flex items-center gap-2 mb-4">
                <Table2 className="w-3.5 h-3.5 text-white/20" />
                <span className="text-[10px] text-white/25 uppercase tracking-widest">
                  sweep results
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/[0.06]">
                      <th className="text-left text-[10px] text-white/20 uppercase tracking-wider py-2.5 pr-4 font-normal">
                        #
                      </th>
                      <th className="text-right text-[10px] text-white/20 uppercase tracking-wider py-2.5 px-4 font-normal">
                        {selectedVariable}
                      </th>
                      <th className="text-right text-[10px] text-white/20 uppercase tracking-wider py-2.5 px-4 font-normal">
                        success probability
                      </th>
                      <th className="text-right text-[10px] text-white/20 uppercase tracking-wider py-2.5 px-4 font-normal">
                        avg revenue
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sweepResults.map((point, i) => {
                      const isOptimal =
                        optimalPoint &&
                        point.value === optimalPoint.value;
                      return (
                        <tr
                          key={i}
                          className={`border-b border-white/[0.04] ${
                            isOptimal
                              ? "bg-emerald-400/[0.04]"
                              : ""
                          }`}
                        >
                          <td className="text-white/20 py-2.5 pr-4 font-mono">
                            {i + 1}
                          </td>
                          <td className="text-right text-white/60 py-2.5 px-4 font-mono">
                            {point.value.toLocaleString()}
                          </td>
                          <td
                            className={`text-right py-2.5 px-4 font-mono ${
                              isOptimal
                                ? "text-emerald-400/80 font-medium"
                                : "text-white/60"
                            }`}
                          >
                            {point.success_probability.toFixed(1)}%
                            {isOptimal && (
                              <span className="ml-2 text-[10px] text-emerald-400/50">
                                best
                              </span>
                            )}
                          </td>
                          <td className="text-right text-white/60 py-2.5 px-4 font-mono">
                            {formatCurrency(point.avg_revenue)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
