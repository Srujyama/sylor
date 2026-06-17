"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles, Loader2, SlidersHorizontal, GitFork, Wand2, GitBranch, ArrowRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn, formatCurrency } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { useRunTray } from "@/components/run-tray";
import {
  getCopilotSuggestions, branchSimulation, runWhatIf,
} from "@/lib/api";
import type { CopilotSuggestion, CopilotActionType, WhatIfResponse } from "@/types";

const TYPE_META: Record<CopilotActionType, { icon: React.ElementType; label: string; tag: string }> = {
  sweep: { icon: SlidersHorizontal, label: "sweep", tag: "tag-blue" },
  branch: { icon: GitFork, label: "branch", tag: "tag-green" },
  whatif: { icon: Wand2, label: "what-if", tag: "tag-yellow" },
  compare: { icon: GitBranch, label: "compare", tag: "" },
};

export function CopilotPanel({
  simId,
  numRuns,
}: {
  simId: string;
  numRuns: number;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { trackExternalRun } = useRunTray();

  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<CopilotSuggestion[] | null>(null);
  // Which suggestion (by index) currently has an action running.
  const [runningIdx, setRunningIdx] = useState<number | null>(null);
  // Inline what-if result keyed by suggestion index.
  const [whatifResults, setWhatifResults] = useState<Record<number, WhatIfResponse>>({});

  async function fetchSuggestions() {
    if (loading) return;
    setLoading(true);
    try {
      const data = await getCopilotSuggestions(simId);
      setSuggestions(data.suggestions || []);
      if (!data.suggestions?.length) {
        toast({ title: "no suggestions returned", description: "try again in a moment", variant: "error" });
      }
    } catch (e: any) {
      toast({ title: "copilot couldn't suggest experiments", description: e.message || "try again in a moment", variant: "error" });
    } finally {
      setLoading(false);
    }
  }

  async function runSuggestion(s: CopilotSuggestion, idx: number) {
    if (runningIdx !== null) return;
    const { type, action } = s;

    if (type === "sweep") {
      // Navigate to the existing sweep page, prefilling via query params.
      const params = new URLSearchParams();
      if (action.variable_name) params.set("variable", action.variable_name);
      if (action.min_value != null) params.set("min", String(action.min_value));
      if (action.max_value != null) params.set("max", String(action.max_value));
      router.push(`/simulations/${simId}/sweep?${params.toString()}`);
      return;
    }

    if (type === "compare") {
      router.push(`/simulations/compare?ids=${simId}`);
      return;
    }

    if (type === "branch") {
      const overrides = action.variable_overrides || {};
      if (Object.keys(overrides).length === 0) {
        toast({ title: "nothing to branch", description: "this suggestion has no variable overrides", variant: "error" });
        return;
      }
      setRunningIdx(idx);
      const label = s.title.slice(0, 40);
      try {
        const { simulation_id } = await branchSimulation(simId, {
          variable_overrides: overrides,
          label,
          num_runs: numRuns,
        });
        trackExternalRun(simulation_id, label);
        toast({ title: "branch started", description: `running "${label}" — track it in the run tray`, variant: "success" });
        router.push(`/simulations/${simId}/tree`);
      } catch (e: any) {
        toast({ title: "couldn't start branch", description: e.message || "try again in a moment", variant: "error" });
      } finally {
        setRunningIdx(null);
      }
      return;
    }

    if (type === "whatif") {
      const prompt = (action.prompt || s.title).slice(0, 500);
      setRunningIdx(idx);
      try {
        const data = await runWhatIf(simId, prompt);
        setWhatifResults((prev) => ({ ...prev, [idx]: data }));
      } catch (e: any) {
        toast({ title: "what-if failed", description: e.message || "try again in a moment", variant: "error" });
      } finally {
        setRunningIdx(null);
      }
      return;
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-violet-400" />
          ai copilot — next experiments
          <Badge variant="purple" className="ml-auto">Powered by Claude</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-white/30 leading-relaxed">
          let claude read this simulation&apos;s results and suggest the highest-signal experiments to run
          next — each one maps onto a real sweep, branch, what-if, or comparison.
        </p>

        {!suggestions && (
          <Button variant="gradient" onClick={fetchSuggestions} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {loading ? "thinking through your next moves..." : "suggest next experiments"}
          </Button>
        )}

        {suggestions && (
          <div className="space-y-3">
            {suggestions.map((s, idx) => {
              const meta = TYPE_META[s.type] || TYPE_META.whatif;
              const Icon = meta.icon;
              const wf = whatifResults[idx];
              return (
                <div key={idx} className="p-4 bg-white/[0.02] border border-white/[0.06]">
                  <div className="flex items-start gap-3">
                    <div className="w-7 h-7 shrink-0 bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mt-0.5">
                      <Icon className="w-3.5 h-3.5 text-white/50" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-white truncate">{s.title}</span>
                        <span className={cn("tag text-[9px] shrink-0", meta.tag)}>{meta.label}</span>
                      </div>
                      <p className="text-xs text-white/40 leading-relaxed">{s.rationale}</p>

                      {/* Inline what-if result */}
                      {wf && (
                        <div className="mt-3 grid grid-cols-3 gap-px bg-white/[0.05]">
                          <div className="bg-[var(--page-bg)] p-2.5">
                            <div className="text-[9px] text-white/25 uppercase tracking-wider mb-0.5">success</div>
                            <div className={cn("text-sm font-bold", wf.deltas.success_probability_pp >= 0 ? "text-green-400" : "text-red-400")}>
                              {wf.deltas.success_probability_pp >= 0 ? "+" : ""}{wf.deltas.success_probability_pp.toFixed(1)}pp
                            </div>
                          </div>
                          <div className="bg-[var(--page-bg)] p-2.5">
                            <div className="text-[9px] text-white/25 uppercase tracking-wider mb-0.5">avg revenue</div>
                            <div className={cn("text-sm font-bold", wf.deltas.avg_revenue >= 0 ? "text-green-400" : "text-red-400")}>
                              {wf.deltas.avg_revenue >= 0 ? "+" : "−"}{formatCurrency(Math.abs(wf.deltas.avg_revenue))}
                            </div>
                          </div>
                          <div className="bg-[var(--page-bg)] p-2.5">
                            <div className="text-[9px] text-white/25 uppercase tracking-wider mb-0.5">breakeven</div>
                            <div className={cn("text-sm font-bold", wf.deltas.avg_time_to_breakeven <= 0 ? "text-green-400" : "text-red-400")}>
                              {wf.deltas.avg_time_to_breakeven >= 0 ? "+" : ""}{wf.deltas.avg_time_to_breakeven.toFixed(1)}
                            </div>
                          </div>
                        </div>
                      )}
                      {wf?.verdict && (
                        <p className="mt-2 text-[11px] text-white/45 italic leading-relaxed">{wf.verdict}</p>
                      )}

                      <button
                        onClick={() => runSuggestion(s, idx)}
                        disabled={runningIdx !== null}
                        className="mt-3 inline-flex items-center gap-1.5 text-xs text-violet-300 hover:text-violet-200 disabled:opacity-40 transition-colors"
                      >
                        {runningIdx === idx ? (
                          <><Loader2 className="w-3 h-3 animate-spin" /> running...</>
                        ) : (
                          <>run it <ArrowRight className="w-3 h-3" /></>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            <button
              onClick={fetchSuggestions}
              disabled={loading}
              className="text-[10px] text-white/25 hover:text-white/50 transition-colors inline-flex items-center gap-1"
            >
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              regenerate suggestions
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
