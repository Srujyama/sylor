"use client";

import { useState, useRef } from "react";
import {
  FlaskConical, Upload, Loader2, ArrowUpRight, ArrowDownRight, Minus,
  CheckCircle, Sparkles, FileSpreadsheet, X, Gauge,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { parseUpload, calibrateSimulation, applyCalibration } from "@/lib/api";
import { cn, formatNumber } from "@/lib/utils";
import type { CalibrationResult } from "@/types";

// A numeric column detected in the uploaded CSV (from parseUpload's ColumnInfo).
interface NumericColumn {
  name: string;
  mean: number;
  std: number;
  n: number; // non_null_count
  values: number[]; // raw series (parseUpload now returns this, capped server-side)
}

// One config variable we can map an observed column onto.
interface SimVar {
  name: string;
  label: string;
  value: number;
}

const NONE = "__none__";

// Lightweight fuzzy match: normalize to lowercase alphanum and check containment
// either way. Used to pre-select a default variable for each detected column.
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function fuzzyMatch(column: string, vars: SimVar[]): string {
  const nc = normalize(column);
  if (!nc) return NONE;
  // exact normalized hit on name or label first
  for (const v of vars) {
    if (normalize(v.name) === nc || normalize(v.label) === nc) return v.name;
  }
  // containment either direction
  for (const v of vars) {
    const nv = normalize(v.name);
    const nl = normalize(v.label);
    if (nv && (nv.includes(nc) || nc.includes(nv))) return v.name;
    if (nl && (nl.includes(nc) || nc.includes(nl))) return v.name;
  }
  return NONE;
}

export function CalibratePanel({
  simId,
  variables,
  onApplied,
}: {
  simId: string;
  variables: SimVar[];
  // Called after a successful apply so the parent can refresh the sim config.
  onApplied?: (posteriors: Record<string, number>) => void;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState<string>("");
  const [columns, setColumns] = useState<NumericColumn[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({}); // column -> variable name | NONE
  const [parsing, setParsing] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<CalibrationResult | null>(null);

  async function handleFile(file: File) {
    setParsing(true);
    setResult(null);
    try {
      const parsed = await parseUpload(file);
      const numeric: NumericColumn[] = (parsed.columns || [])
        .filter((c: any) => (c.type === "float64" || c.type === "int64") && c.mean != null)
        .map((c: any) => ({
          name: c.name,
          mean: Number(c.mean),
          std: Number(c.std ?? 0),
          n: Number(c.non_null_count ?? 0),
          values: Array.isArray(c.values) ? c.values.map(Number) : [],
        }));
      if (numeric.length === 0) {
        toast({ title: "no numeric columns found", description: "calibration needs at least one numeric column to fit against", variant: "error" });
        setParsing(false);
        return;
      }
      setFileName(parsed.file_name || file.name);
      setColumns(numeric);
      // Pre-seed the mapping with the fuzzy/name match per column.
      const seed: Record<string, string> = {};
      numeric.forEach((c) => { seed[c.name] = fuzzyMatch(c.name, variables); });
      setMapping(seed);
    } catch (e: any) {
      toast({ title: "couldn't parse that file", description: e.message || "use a CSV or Excel file", variant: "error" });
    } finally {
      setParsing(false);
    }
  }

  async function handleCalibrate() {
    if (calibrating) return;
    // Build observed series + mapping for only the columns the user mapped to a
    // variable. parseUpload returns the raw numeric series (capped server-side),
    // so the calibration fits against the real distribution; fall back to the
    // column mean only if a series somehow wasn't returned.
    const observed: Record<string, number[]> = {};
    const userMapping: Record<string, string> = {};
    columns.forEach((c) => {
      const target = mapping[c.name];
      if (!target || target === NONE) return;
      observed[c.name] = c.values && c.values.length > 0 ? c.values : [c.mean];
      userMapping[c.name] = target;
    });
    if (Object.keys(observed).length === 0) {
      toast({ title: "map at least one column", description: "pick a sim variable for a detected column first", variant: "error" });
      return;
    }
    setCalibrating(true);
    try {
      const data = await calibrateSimulation(simId, observed, userMapping);
      setResult(data);
    } catch (e: any) {
      toast({ title: "calibration failed", description: e.message || "try again in a moment", variant: "error" });
    } finally {
      setCalibrating(false);
    }
  }

  async function handleApply() {
    if (!result || applying) return;
    const posteriors: Record<string, number> = {};
    result.calibrated.forEach((p) => { posteriors[p.variable_name] = p.posterior_value; });
    if (Object.keys(posteriors).length === 0) return;
    setApplying(true);
    try {
      await applyCalibration(simId, posteriors);
      toast({ title: "calibration applied", description: "the sim config now reflects the fitted values", variant: "success" });
      onApplied?.(posteriors);
    } catch (e: any) {
      toast({ title: "couldn't apply calibration", description: e.message || "try again in a moment", variant: "error" });
    } finally {
      setApplying(false);
    }
  }

  function clearUpload() {
    setFileName("");
    setColumns([]);
    setMapping({});
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  const scoreColor = (s: number) =>
    s >= 66 ? "text-green-400" : s >= 33 ? "text-yellow-400" : "text-red-400";
  const scoreBar = (s: number) =>
    s >= 66 ? "bg-green-500/70" : s >= 33 ? "bg-yellow-500/70" : "bg-red-500/70";

  return (
    <div className="space-y-6">
      {/* Upload + map */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-violet-400" />
            calibrate to historical data
            <Badge variant="purple" className="ml-auto">bayesian fit</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-xs text-white/30 leading-relaxed">
            upload a csv/excel of your real history, map each numeric column to a sim variable, and
            we fit the engine to it. this is a lightweight moment-matching update (conjugate-normal
            posterior), not full mcmc — treat the posteriors as nudged priors, not ground truth.
          </p>

          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />

          {columns.length === 0 ? (
            <button
              onClick={() => fileRef.current?.click()}
              disabled={parsing}
              className="w-full border border-dashed border-white/[0.12] hover:border-white/25 bg-white/[0.01] hover:bg-white/[0.03] py-10 flex flex-col items-center gap-3 transition-all disabled:opacity-50"
            >
              {parsing ? (
                <Loader2 className="w-5 h-5 text-white/40 animate-spin" />
              ) : (
                <Upload className="w-5 h-5 text-white/30" />
              )}
              <span className="text-xs text-white/40">
                {parsing ? "parsing file..." : "click to upload a csv or excel file"}
              </span>
              <span className="text-[10px] text-white/20">numeric columns are detected automatically · max 10mb</span>
            </button>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-xs">
                <FileSpreadsheet className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-white/60">{fileName}</span>
                <span className="text-white/25">· {columns.length} numeric columns</span>
                <button onClick={clearUpload} className="ml-auto text-white/25 hover:text-red-400/70 flex items-center gap-1 text-[10px]">
                  <X className="w-3 h-3" /> clear
                </button>
              </div>

              {/* Column → variable mapping table */}
              <div className="border border-white/[0.06]">
                <div className="grid grid-cols-[1.4fr_1fr_1.2fr] gap-px bg-white/[0.05] text-[10px] uppercase tracking-wider text-white/25">
                  <div className="bg-[var(--page-bg)] px-3 py-2">detected column</div>
                  <div className="bg-[var(--page-bg)] px-3 py-2">observed (mean · n)</div>
                  <div className="bg-[var(--page-bg)] px-3 py-2">maps to variable</div>
                </div>
                {columns.map((c) => (
                  <div key={c.name} className="grid grid-cols-[1.4fr_1fr_1.2fr] gap-px bg-white/[0.04] border-t border-white/[0.04]">
                    <div className="bg-[var(--page-bg)] px-3 py-2 text-xs text-white/70 truncate" title={c.name}>{c.name}</div>
                    <div className="bg-[var(--page-bg)] px-3 py-2 text-xs text-white/40 font-mono">
                      {formatNumber(c.mean)} · n={c.n}
                    </div>
                    <div className="bg-[var(--page-bg)] px-2 py-1.5">
                      <select
                        value={mapping[c.name] ?? NONE}
                        onChange={(e) => setMapping((prev) => ({ ...prev, [c.name]: e.target.value }))}
                        className="w-full bg-white/[0.03] border border-white/[0.08] px-2 py-1.5 text-xs text-white/70 focus:outline-none focus:border-white/20"
                      >
                        <option value={NONE}>— don&apos;t map —</option>
                        {variables.map((v) => (
                          <option key={v.name} value={v.name}>{v.label || v.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
              </div>

              <Button variant="gradient" size="sm" onClick={handleCalibrate} disabled={calibrating}>
                {calibrating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {calibrating ? "fitting posteriors..." : "calibrate"}
              </Button>

              {calibrating && (
                <p className="text-xs text-white/30 flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  combining your priors with the observed data via a precision-weighted normal update...
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Gauge className="w-4 h-4 text-cyan-400" />
              calibration result
              <span className="text-[10px] font-normal text-white/25 ml-1 normal-case">{result.method}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Score gauge */}
            <div className="flex items-center gap-4">
              <div className="shrink-0">
                <div className="text-[10px] text-white/25 uppercase tracking-wider mb-1">calibration score</div>
                <div className={cn("text-3xl font-bold", scoreColor(result.calibration_score))}>
                  {Math.round(result.calibration_score)}
                  <span className="text-sm text-white/20">/100</span>
                </div>
              </div>
              <div className="flex-1">
                <div className="h-2 bg-white/[0.06] overflow-hidden">
                  <div
                    className={cn("h-full transition-all", scoreBar(result.calibration_score))}
                    style={{ width: `${Math.max(0, Math.min(100, result.calibration_score))}%` }}
                  />
                </div>
                <p className="text-[10px] text-white/25 mt-1.5">
                  how tightly your data constrained the fitted parameters — higher means the posteriors
                  moved confidently toward the observed values.
                </p>
              </div>
            </div>

            {/* Per-parameter cards */}
            <div className="space-y-2">
              <div className="text-[10px] text-white/25 uppercase tracking-wider">fitted parameters</div>
              {result.calibrated.length === 0 && (
                <p className="text-xs text-white/30">no parameters could be fit from the mapped columns.</p>
              )}
              {result.calibrated.map((p) => {
                const up = p.shift_pct > 0.05;
                const down = p.shift_pct < -0.05;
                const ShiftIcon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
                const shiftColor = up ? "text-green-400" : down ? "text-red-400" : "text-white/40";
                // uncertainty bar — posterior_std relative to |posterior_value| (clamped)
                const rel = p.posterior_value !== 0
                  ? Math.min(1, Math.abs(p.posterior_std / p.posterior_value))
                  : Math.min(1, Math.abs(p.posterior_std));
                return (
                  <div key={p.variable_name} className="p-4 bg-white/[0.02] border border-white/[0.06] space-y-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-white/80">{p.label || p.variable_name}</span>
                      <span className={cn("tag text-[10px] inline-flex items-center gap-1", up ? "tag-green" : down ? "tag-red" : "")}>
                        <ShiftIcon className="w-3 h-3" />
                        {p.shift_pct >= 0 ? "+" : ""}{p.shift_pct.toFixed(1)}%
                      </span>
                      <span className="text-[10px] text-white/25 ml-auto font-mono">
                        obs mean {formatNumber(p.observed_summary.mean)} · n={p.observed_summary.n}
                      </span>
                    </div>

                    {/* prior → posterior */}
                    <div className="flex items-center gap-3 text-sm">
                      <div className="flex flex-col">
                        <span className="text-[9px] text-white/25 uppercase tracking-wider">prior</span>
                        <span className="font-mono text-white/50">{formatNumber(p.prior_value)}</span>
                      </div>
                      <ShiftIcon className={cn("w-4 h-4", shiftColor)} />
                      <div className="flex flex-col">
                        <span className="text-[9px] text-white/25 uppercase tracking-wider">posterior</span>
                        <span className={cn("font-mono", shiftColor)}>{formatNumber(p.posterior_value)}</span>
                      </div>
                    </div>

                    {/* posterior uncertainty bar */}
                    <div>
                      <div className="flex items-center justify-between text-[9px] text-white/25 mb-1">
                        <span>posterior uncertainty (± std)</span>
                        <span className="font-mono">±{formatNumber(p.posterior_std)}</span>
                      </div>
                      <div className="h-1.5 bg-white/[0.06] overflow-hidden">
                        <div className="h-full bg-violet-500/60" style={{ width: `${Math.max(2, rel * 100)}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Unmatched columns */}
            {(result.unmatched_columns?.length || 0) > 0 && (
              <div className="space-y-1.5">
                <div className="text-[10px] text-white/25 uppercase tracking-wider">unmatched columns</div>
                <div className="flex flex-wrap gap-1.5">
                  {result.unmatched_columns.map((c) => (
                    <span key={c} className="tag text-[10px] text-white/30">{c}</span>
                  ))}
                </div>
                <p className="text-[10px] text-white/20">these columns couldn&apos;t map to a sim variable and were skipped.</p>
              </div>
            )}

            {/* Summary */}
            {result.summary && (
              <blockquote className="border-l-2 border-violet-500/40 pl-4 py-1 text-sm text-white/60 italic leading-relaxed">
                {result.summary}
              </blockquote>
            )}

            {/* Honest note + apply */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-1">
              <Button variant="gradient" onClick={handleApply} disabled={applying || result.calibrated.length === 0}>
                {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                {applying ? "applying..." : "apply calibration"}
              </Button>
              <p className="text-[10px] text-white/25 leading-relaxed">
                applying writes the posteriors into the sim config variable values. rerun the
                simulation afterward to see the fitted values in action.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
