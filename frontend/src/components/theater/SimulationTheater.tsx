"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  Play, Pause, RotateCcw, Loader2, Clapperboard, Activity,
  ChevronDown, ChevronUp, BookOpen,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { getReplay, getTranscript } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import type { ReplayData, AgentTranscript } from "@/types";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

// Color language by agent type — mirrors the domain dot/chart palette.
const AGENT_COLORS: Record<string, string> = {
  customer: "#3b82f6",
  competitor: "#ef4444",
  regulator: "#eab308",
  investor: "#22c55e",
  market: "#06b6d4",
  trader: "#f97316",
  market_maker: "#8b5cf6",
  molecule: "#22c55e",
  enzyme: "#06b6d4",
  data_stream: "#ef4444",
};
const FALLBACK_PALETTE = ["#8b5cf6", "#06b6d4", "#22c55e", "#f97316", "#ef4444", "#eab308"];

function agentColor(type: string, idx: number): string {
  return AGENT_COLORS[type] || FALLBACK_PALETTE[idx % FALLBACK_PALETTE.length];
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

const TICKS_PER_SEC = 4; // ~3-6 ticks/sec

export function SimulationTheater({ simId }: { simId: string }) {
  const { toast } = useToast();
  const reduced = usePrefersReducedMotion();
  // Mirror `reduced` into a ref so the one-time replay fetch can read it
  // without listing it as a dependency (which would refetch + reset the cursor
  // when the post-paint media-query effect flips it for reduced-motion users).
  const reducedRef = useRef(reduced);
  useEffect(() => { reducedRef.current = reduced; }, [reduced]);

  const [replay, setReplay] = useState<ReplayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Playback: cursor is the index into ticks that has been "revealed".
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Transcript (lazy)
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [transcript, setTranscript] = useState<AgentTranscript | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const transcriptTried = useRef(false);

  // Fetch replay on mount
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getReplay(simId)
      .then((data) => {
        if (cancelled) return;
        setReplay(data);
        // Reduced motion → jump straight to the final state, no animation.
        const isReduced = reducedRef.current;
        const lastIdx = Math.max(0, (data.ticks?.length || 1) - 1);
        setCursor(isReduced ? lastIdx : 0);
        setPlaying(!isReduced && (data.ticks?.length || 0) > 1);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
        toast({ title: "couldn't load the theater replay", description: "this simulation may not have a captured path yet", variant: "error" });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simId]);

  const ticks = replay?.ticks || [];
  const lastIdx = Math.max(0, ticks.length - 1);

  // Stepper — advances the cursor while playing. Cleared on pause/unmount.
  useEffect(() => {
    if (!playing || ticks.length === 0) return;
    intervalRef.current = setInterval(() => {
      setCursor((c) => {
        if (c >= lastIdx) {
          setPlaying(false);
          return c;
        }
        return c + 1;
      });
    }, 1000 / TICKS_PER_SEC);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [playing, ticks.length, lastIdx]);

  const togglePlay = useCallback(() => {
    if (cursor >= lastIdx) {
      // At the end → restart from the top.
      setCursor(0);
      setPlaying(true);
    } else {
      setPlaying((p) => !p);
    }
  }, [cursor, lastIdx]);

  const restart = useCallback(() => {
    setCursor(0);
    setPlaying(!reduced);
  }, [reduced]);

  async function loadTranscript() {
    const next = !transcriptOpen;
    setTranscriptOpen(next);
    if (next && !transcriptTried.current) {
      transcriptTried.current = true;
      setTranscriptLoading(true);
      try {
        const data = await getTranscript(simId);
        setTranscript(data);
      } catch {
        toast({ title: "couldn't load the narrative transcript", description: "try again in a moment", variant: "error" });
        transcriptTried.current = false; // allow a retry on next open
      } finally {
        setTranscriptLoading(false);
      }
    }
  }

  const currentTick = ticks[cursor];
  const actedAgentIds = useMemo(
    () => new Set((currentTick?.events || []).map((e) => e.agent_id)),
    [currentTick]
  );

  // Live-building revenue line — only the revealed ticks.
  const chartData = useMemo(
    () =>
      ticks.slice(0, cursor + 1).map((t) => ({
        t: `${(replay?.time_unit || "t").charAt(0).toUpperCase()}${t.t}`,
        revenue: t.metrics?.revenue ?? 0,
      })),
    [ticks, cursor, replay?.time_unit]
  );

  // Event ticker — show the most recent ~8 events across revealed ticks.
  const tickerEvents = useMemo(() => {
    const out: Array<{ key: string; t: number; agent: string; color: string; action: string; value: number; note?: string }> = [];
    const agentById = new Map((replay?.agents || []).map((a, i) => [a.id, { name: a.name, color: agentColor(a.type, i) }]));
    for (let i = Math.max(0, cursor - 7); i <= cursor; i++) {
      const tk = ticks[i];
      if (!tk) continue;
      tk.events.forEach((e, ei) => {
        const meta = agentById.get(e.agent_id);
        out.push({
          key: `${i}-${ei}`,
          t: tk.t,
          agent: meta?.name || e.agent_id,
          color: meta?.color || "#8b5cf6",
          action: e.action,
          value: e.value,
          note: e.note,
        });
      });
    }
    return out.slice(-10).reverse();
  }, [ticks, cursor, replay?.agents]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 animate-spin text-white/20" />
      </div>
    );
  }

  if (error || !replay || ticks.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <Clapperboard className="w-6 h-6 text-white/15 mx-auto mb-4" />
          <p className="text-sm text-white/40 mb-1">no replay available</p>
          <p className="text-xs text-white/20">the theater needs a captured deterministic path — rerun the simulation to generate one</p>
        </CardContent>
      </Card>
    );
  }

  const progressPct = lastIdx > 0 ? (cursor / lastIdx) * 100 : 100;

  return (
    <div className="space-y-6">
      {/* Stage + ticker */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Agent stage */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clapperboard className="w-4 h-4 text-violet-400" />
              live simulation theater
              <span className="ml-auto text-[10px] font-mono text-white/25">
                {replay.time_unit} {currentTick?.t ?? 0} / {ticks[lastIdx]?.t ?? lastIdx}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Stage — agents as labeled nodes, pulsing when they act this tick */}
            <div className="relative min-h-[200px] flex flex-wrap items-center justify-center gap-x-8 gap-y-6 p-6 bg-white/[0.02] border border-white/[0.05]">
              {replay.agents.map((a, i) => {
                const color = agentColor(a.type, i);
                const active = actedAgentIds.has(a.id);
                return (
                  <div key={a.id} className="flex flex-col items-center gap-2 text-center w-24">
                    <div className="relative">
                      {active && !reduced && (
                        <span
                          className="absolute inset-0 rounded-full animate-ping"
                          style={{ backgroundColor: color, opacity: 0.35 }}
                        />
                      )}
                      <div
                        role="img"
                        aria-label={`${a.name} (${a.type})${active ? ", acting" : ""}`}
                        className="relative w-10 h-10 rounded-full border-2 flex items-center justify-center transition-all duration-200"
                        style={{
                          borderColor: color,
                          backgroundColor: active ? color : "transparent",
                          boxShadow: active ? `0 0 16px ${color}80` : "none",
                          transform: active && !reduced ? "scale(1.12)" : "scale(1)",
                        }}
                      >
                        <span aria-hidden="true" className="text-[9px] font-bold" style={{ color: active ? "#0a0a0a" : color }}>
                          {a.name.slice(0, 2).toUpperCase()}
                        </span>
                      </div>
                    </div>
                    <div className="text-[10px] text-white/50 leading-tight truncate w-full">{a.name}</div>
                    <div className="text-[9px] uppercase tracking-wider" style={{ color: `${color}99` }}>{a.type}</div>
                  </div>
                );
              })}
            </div>

            {/* Transport controls + scrubber */}
            <div className="mt-4 flex items-center gap-3">
              <Button variant="glass" size="sm" onClick={togglePlay}>
                {playing ? <Pause aria-hidden="true" className="w-4 h-4" /> : <Play aria-hidden="true" className="w-4 h-4" />}
                {playing ? "pause" : cursor >= lastIdx ? "replay" : "play"}
              </Button>
              <Button variant="ghost" size="icon" onClick={restart} title="restart" aria-label="restart">
                <RotateCcw aria-hidden="true" className="w-4 h-4" />
              </Button>
              <input
                type="range"
                min={0}
                max={lastIdx}
                value={cursor}
                onChange={(e) => { setPlaying(false); setCursor(Number(e.target.value)); }}
                className="flex-1 accent-violet-500 h-1 cursor-pointer"
                aria-label="scrub timeline"
              />
              <span className="text-[10px] font-mono text-white/30 w-10 text-right">{Math.round(progressPct)}%</span>
            </div>

            {/* Headline metrics this tick */}
            <div className="mt-4 grid grid-cols-3 gap-px bg-white/[0.05]">
              <div className="bg-[var(--page-bg)] p-3">
                <div className="text-[9px] text-white/25 uppercase tracking-wider mb-1">revenue</div>
                <div className="text-lg font-bold text-cyan-400">{formatCurrency(currentTick?.metrics?.revenue ?? 0)}</div>
              </div>
              <div className="bg-[var(--page-bg)] p-3">
                <div className="text-[9px] text-white/25 uppercase tracking-wider mb-1">customers</div>
                <div className="text-lg font-bold text-violet-400">{Math.round(currentTick?.metrics?.customers ?? 0).toLocaleString()}</div>
              </div>
              <div className="bg-[var(--page-bg)] p-3">
                <div className="text-[9px] text-white/25 uppercase tracking-wider mb-1">market share</div>
                <div className="text-lg font-bold text-green-400">{(currentTick?.metrics?.market_share ?? 0).toFixed(2)}%</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Event ticker */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="w-4 h-4 text-cyan-400" />
              event ticker
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5 max-h-[340px] overflow-y-auto">
              {tickerEvents.length === 0 ? (
                <p className="text-xs text-white/20 py-8 text-center">no events yet — press play</p>
              ) : (
                tickerEvents.map((e) => (
                  <div key={e.key} className="flex items-start gap-2 p-2 bg-white/[0.02] border border-white/[0.04]">
                    <span className="dot shrink-0 mt-1" style={{ backgroundColor: e.color }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] text-white/70 leading-tight">
                        <span className="font-medium" style={{ color: e.color }}>{e.agent}</span>{" "}
                        <span className="text-white/40">{e.action}</span>
                      </div>
                      <div className="text-[10px] text-white/25 mt-0.5">
                        {replay.time_unit} {e.t} · {e.value.toLocaleString()}
                        {e.note ? ` · ${e.note}` : ""}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Live-building outcome chart */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400" />
            revenue — building in as the path unfolds
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <defs>
                <linearGradient id="theaterRev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis dataKey="t" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} tickFormatter={(v) => formatCurrency(v)} />
              <Tooltip
                contentStyle={{ background: "var(--chart-tooltip-bg)", border: "1px solid var(--chart-tooltip-border)", borderRadius: 0, fontSize: 12 }}
                formatter={(v: number) => [formatCurrency(v), "revenue"]}
              />
              <Area type="monotone" dataKey="revenue" stroke="#06b6d4" strokeWidth={2} fill="url(#theaterRev)" isAnimationActive={!reduced} />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Narrative transcript — lazy-loaded on first expand */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-violet-400" />
            narrative transcript
            <button
              onClick={loadTranscript}
              className="ml-auto flex items-center gap-1 text-[10px] text-white/30 hover:text-white/60 transition-colors"
            >
              {transcriptOpen ? <>hide <ChevronUp className="w-3 h-3" /></> : <>read the story <ChevronDown className="w-3 h-3" /></>}
            </button>
          </CardTitle>
        </CardHeader>
        {transcriptOpen && (
          <CardContent>
            {transcriptLoading ? (
              <div className="flex items-center gap-2 text-xs text-white/30 py-6">
                <Loader2 className="w-3 h-3 animate-spin" /> voicing the agents as characters...
              </div>
            ) : transcript ? (
              <div className="space-y-4">
                {transcript.summary && (
                  <blockquote className="border-l-2 border-violet-500/40 pl-4 py-1 text-sm text-white/60 italic leading-relaxed">
                    {transcript.summary}
                  </blockquote>
                )}
                <div className="relative pl-5 border-l border-white/[0.08] space-y-4">
                  {transcript.transcript.map((step) => (
                    <div key={step.t} className="relative">
                      <span className="absolute -left-[1.42rem] top-1 w-2 h-2 rounded-full bg-violet-500/60" />
                      <div className="text-[10px] text-white/25 uppercase tracking-wider mb-1">{replay.time_unit} {step.t}</div>
                      <p className="text-xs text-white/55 leading-relaxed">{step.narrative}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-white/20 py-6 text-center">transcript unavailable</p>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
