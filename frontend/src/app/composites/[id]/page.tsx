"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Loader2, AlertTriangle, Boxes, Play, Trash2,
  TrendingUp, DollarSign, Workflow, ArrowRight, Sparkles, Target,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { useRouter } from "next/navigation";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import {
  getComposite, runComposite, deleteComposite,
} from "@/lib/api";
import { onAuthChange } from "@/lib/firebase/auth";
import { useToast } from "@/components/ui/toast";
import { CATEGORY_COLOR, FROM_METRICS } from "@/lib/composite-templates";
import { ChartDataTable } from "@/components/ui/chart-data-table";
import type {
  CompositeDetail, CompositeRunResult, CompositeNode,
} from "@/types";

const NUM_RUNS_OPTIONS = [100, 500, 1000, 2000, 5000];

const metricLabel: Record<string, string> = Object.fromEntries(
  FROM_METRICS.map((m) => [m.value, m.label])
);

// ── DAG layout (left-to-right by topological layer) ──────────
const NODE_W = 168;
const NODE_H = 64;
const COL_GAP = 96;
const ROW_GAP = 28;

interface LaidNode {
  node: CompositeNode;
  layer: number;
  row: number;
}

// Assign each node a layer = longest path from any source, so edges always
// point rightward. Falls back gracefully if the (client-trusted) graph has a
// cycle — the backend is the real source of truth.
function layoutDag(nodes: CompositeNode[], links: CompositeDetail["links"]) {
  const ids = nodes.map((n) => n.node_id);
  const idSet = new Set(ids);
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  ids.forEach((id) => { incoming.set(id, []); outgoing.set(id, []); });
  for (const l of links) {
    if (idSet.has(l.from_node) && idSet.has(l.to_node)) {
      outgoing.get(l.from_node)!.push(l.to_node);
      incoming.get(l.to_node)!.push(l.from_node);
    }
  }

  // longest-path layering via memoized DFS (cycle-guarded)
  const layer = new Map<string, number>();
  const visiting = new Set<string>();
  function depth(id: string): number {
    if (layer.has(id)) return layer.get(id)!;
    if (visiting.has(id)) return 0; // cycle guard
    visiting.add(id);
    const preds = incoming.get(id) || [];
    const d = preds.length === 0 ? 0 : Math.max(...preds.map((p) => depth(p) + 1));
    visiting.delete(id);
    layer.set(id, d);
    return d;
  }
  ids.forEach((id) => depth(id));

  // group by layer, assign rows
  const byLayer = new Map<number, string[]>();
  ids.forEach((id) => {
    const ly = layer.get(id) ?? 0;
    if (!byLayer.has(ly)) byLayer.set(ly, []);
    byLayer.get(ly)!.push(id);
  });

  const byId = new Map(nodes.map((n) => [n.node_id, n]));
  const laid: LaidNode[] = [];
  Array.from(byLayer.keys()).sort((a, b) => a - b).forEach((ly) => {
    byLayer.get(ly)!.forEach((id, row) => {
      const node = byId.get(id);
      if (node) laid.push({ node, layer: ly, row });
    });
  });
  return laid;
}

export default function CompositeDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { toast } = useToast();
  const [authReady, setAuthReady] = useState(false);
  const [composite, setComposite] = useState<CompositeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [numRuns, setNumRuns] = useState(1000);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CompositeRunResult | null>(null);

  useEffect(() => {
    const unsub = onAuthChange(() => setAuthReady(true));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authReady) return;
    let cancelled = false;
    getComposite(params.id)
      .then((data) => {
        if (cancelled) return;
        setComposite(data);
        if (data.num_runs) setNumRuns(data.num_runs);
        if (data.results) setResult(data.results);
      })
      .catch((e: any) => {
        if (!cancelled) {
          setError(e.message || "failed to load composite");
          toast({ title: "couldn't load composite", description: e.message || "try again in a moment", variant: "error" });
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, params.id]);

  async function handleRun() {
    if (!composite) return;
    setRunning(true);
    try {
      const data = await runComposite(params.id, { num_runs: numRuns });
      setResult(data);
      toast({ title: "composite run complete", description: `success ${Math.round(data.composite_outcome.success_probability)}% on the terminal node`, variant: "success" });
    } catch (e: any) {
      toast({ title: "run failed", description: e.message || "try again in a moment", variant: "error" });
    } finally {
      setRunning(false);
    }
  }

  async function handleDelete() {
    try {
      await deleteComposite(params.id);
      toast({ title: "composite deleted" });
      router.push("/composites");
    } catch {
      toast({ title: "failed to delete", variant: "error" });
    }
  }

  // category by node_id (for coloring the DAG + result cards)
  const categoryByNode = useMemo(() => {
    const map = new Map<string, string>();
    (composite?.nodes ?? []).forEach((n) => {
      map.set(n.node_id, (n.config?.category as string) || "custom");
    });
    // run result is authoritative if present
    (result?.nodes ?? []).forEach((n) => map.set(n.node_id, n.category));
    return map;
  }, [composite, result]);

  const laid = useMemo(() => {
    if (!composite) return [];
    return layoutDag(composite.nodes ?? [], composite.links ?? []);
  }, [composite]);

  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const item of laid) {
      map.set(item.node.node_id, {
        x: item.layer * (NODE_W + COL_GAP),
        y: item.row * (NODE_H + ROW_GAP),
      });
    }
    return map;
  }, [laid]);

  const canvas = useMemo(() => {
    let maxX = 0, maxY = 0;
    Array.from(positions.values()).forEach((p) => {
      maxX = Math.max(maxX, p.x + NODE_W);
      maxY = Math.max(maxY, p.y + NODE_H);
    });
    return { width: Math.max(maxX, 1), height: Math.max(maxY, 1) };
  }, [positions]);

  const labelByNode = useMemo(() => {
    const map = new Map<string, string>();
    (composite?.nodes ?? []).forEach((n) => map.set(n.node_id, n.label));
    return map;
  }, [composite]);

  if (!authReady || loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="w-6 h-6 animate-spin text-white/20" />
      </div>
    );
  }

  if (error || !composite) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <AlertTriangle className="w-5 h-5 text-red-400/50 mb-3" />
        <div className="text-xs text-red-400/70 mb-2">{error || "composite not found"}</div>
        <Link href="/composites" className="text-xs text-white/40 hover:text-white/70 border border-white/10 px-3 py-1.5 transition-colors">
          back to composites
        </Link>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-start gap-4">
          <Link href="/composites" className="text-white/30 hover:text-white/60 transition-colors mt-1" aria-label="back">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <p className="text-xs text-white/25 mb-1 tracking-wide">sylor / composites</p>
            <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
              <Boxes className="w-5 h-5 text-white/40" /> {composite.name}
            </h1>
            <p className="text-xs text-white/30 mt-1">
              {(composite.nodes ?? []).length} nodes · {(composite.links ?? []).length} links · {composite.status}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={numRuns}
            onChange={(e) => setNumRuns(Number(e.target.value))}
            disabled={running}
            className="bg-[var(--page-bg)] border border-white/10 text-xs text-white/70 px-2.5 py-2 focus:outline-none focus:border-white/20"
          >
            {NUM_RUNS_OPTIONS.map((n) => (
              <option key={n} value={n}>{n.toLocaleString()} runs</option>
            ))}
          </select>
          <button
            onClick={handleRun}
            disabled={running}
            className={cn(
              "text-xs py-2 px-4 inline-flex items-center gap-1.5 transition-colors",
              running ? "border border-white/[0.06] text-white/30" : "btn-primary"
            )}
          >
            {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            {running ? "running..." : result ? "re-run" : "run composite"}
          </button>
          <button
            onClick={handleDelete}
            className="p-2 text-white/20 hover:text-red-400/60 hover:bg-red-400/[0.05] transition-colors"
            title="delete composite"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* DAG */}
      <div className="surface p-6 mb-6 overflow-auto">
        <div className="flex items-center gap-2 mb-4">
          <Workflow className="w-3.5 h-3.5 text-white/20" />
          <span className="text-xs text-white/25 tracking-widest uppercase">composite graph</span>
        </div>
        <div className="relative" style={{ width: canvas.width, height: canvas.height, minWidth: "100%" }}>
          <svg className="absolute inset-0 pointer-events-none" width={canvas.width} height={canvas.height}>
            <defs>
              <marker id="comp-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(255,255,255,0.35)" />
              </marker>
            </defs>
            {(composite.links ?? []).map((l, i) => {
              const from = positions.get(l.from_node);
              const to = positions.get(l.to_node);
              if (!from || !to) return null;
              const x1 = from.x + NODE_W;
              const y1 = from.y + NODE_H / 2;
              const x2 = to.x;
              const y2 = to.y + NODE_H / 2;
              const midX = (x1 + x2) / 2;
              return (
                <g key={i}>
                  <path
                    d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2 - 8} ${y2}`}
                    fill="none"
                    stroke="rgba(255,255,255,0.18)"
                    strokeWidth={1.5}
                    markerEnd="url(#comp-arrow)"
                  />
                  <text
                    x={midX}
                    y={(y1 + y2) / 2 - 4}
                    textAnchor="middle"
                    fontSize={9}
                    fill="rgba(255,255,255,0.35)"
                    className="pointer-events-none"
                  >
                    {(metricLabel[l.from_metric] || l.from_metric).replace(" (per-path)", "")} → {l.to_variable}
                  </text>
                </g>
              );
            })}
          </svg>

          {laid.map(({ node }) => {
            const pos = positions.get(node.node_id)!;
            const cat = categoryByNode.get(node.node_id) || "custom";
            const isTerminal = result?.composite_outcome.terminal_node === node.node_id;
            return (
              <div
                key={node.node_id}
                className={cn(
                  "absolute surface-raised p-3 flex flex-col justify-center",
                  isTerminal && "ring-1 ring-white/30"
                )}
                style={{ left: pos.x, top: pos.y, width: NODE_W, height: NODE_H }}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: CATEGORY_COLOR[cat] || CATEGORY_COLOR.custom }}
                  />
                  <span className="text-xs font-medium text-white/80 truncate">{node.label}</span>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[9px] text-white/25 uppercase tracking-wider">{cat}</span>
                  {isTerminal && <span className="text-[9px] text-white/40 uppercase tracking-wider">outcome</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Run results */}
      {running && !result && (
        <div className="surface p-12 flex flex-col items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-white/20 mb-3" />
          <div className="text-xs text-white/40">running composite across domains...</div>
          <div className="text-[10px] text-white/20 mt-1">propagating uncertainty path-by-path — this can take a moment</div>
        </div>
      )}

      {result && (
        <div className="space-y-6">
          {/* Composite outcome headline */}
          <div className="surface-raised p-6">
            <div className="flex items-center gap-2 mb-4">
              <Target className="w-3.5 h-3.5 text-white/30" />
              <span className="text-xs text-white/25 tracking-widest uppercase">
                composite outcome — {labelByNode.get(result.composite_outcome.terminal_node) || result.composite_outcome.terminal_node}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <div className="text-[10px] text-white/25 uppercase tracking-wider mb-1">success probability</div>
                <div className="text-4xl font-bold text-white tabular-nums">
                  {Math.round(result.composite_outcome.success_probability)}%
                </div>
              </div>
              <div>
                <div className="text-[10px] text-white/25 uppercase tracking-wider mb-1">avg revenue</div>
                <div className="text-4xl font-bold text-white tabular-nums">
                  {formatCurrency(result.composite_outcome.avg_revenue)}
                </div>
              </div>
            </div>
          </div>

          {/* Topo order */}
          <div className="surface-raised p-5">
            <div className="text-[10px] text-white/25 uppercase tracking-wider mb-3">execution order</div>
            <div className="flex flex-wrap items-center gap-2">
              {result.order.map((id, i) => (
                <span key={id} className="inline-flex items-center gap-2">
                  <span className="text-xs text-white/70 bg-white/[0.04] px-2.5 py-1 border border-white/[0.06]">
                    {labelByNode.get(id) || id}
                  </span>
                  {i < result.order.length - 1 && <ArrowRight className="w-3 h-3 text-white/20" />}
                </span>
              ))}
            </div>
            <div className="text-[10px] text-white/20 mt-3">base seed {formatNumber(result.base_seed)} — shared across all nodes for paired uncertainty</div>
          </div>

          {/* Per-node results */}
          <div>
            <div className="text-[10px] text-white/25 uppercase tracking-wider mb-3">per-domain results</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {result.nodes.map((nodeResult) => {
                const r = nodeResult.results || {};
                const success = typeof r.success_probability === "number" ? r.success_probability : 0;
                const revenue = typeof r.avg_revenue === "number" ? r.avg_revenue : 0;
                const dist = Array.isArray(r.outcome_distribution) ? r.outcome_distribution : [];
                const chartData = dist.slice(0, 8).map((d: any, i: number) => ({
                  range: d.range ?? `b${i}`,
                  count: d.count ?? 0,
                  probability: d.probability ?? 0,
                }));
                const color = CATEGORY_COLOR[nodeResult.category] || CATEGORY_COLOR.custom;
                return (
                  <div key={nodeResult.node_id} className="surface-raised p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
                      <span className="text-sm font-medium text-white/80">{nodeResult.label}</span>
                      <span className="text-[9px] text-white/25 uppercase tracking-wider ml-auto">{nodeResult.category}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div>
                        <div className="text-[10px] text-white/25 uppercase tracking-wider mb-0.5 inline-flex items-center gap-1">
                          <TrendingUp className="w-2.5 h-2.5" /> success
                        </div>
                        <div className="text-xl font-bold text-white tabular-nums">{Math.round(success)}%</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-white/25 uppercase tracking-wider mb-0.5 inline-flex items-center gap-1">
                          <DollarSign className="w-2.5 h-2.5" /> avg revenue
                        </div>
                        <div className="text-xl font-bold text-white tabular-nums">{formatCurrency(revenue)}</div>
                      </div>
                    </div>
                    {chartData.length > 0 && (
                      <div role="img" aria-label={`Bar chart: outcome distribution for ${nodeResult.label} — probability of runs by outcome range`}>
                      <ResponsiveContainer width="100%" height={120}>
                        <BarChart data={chartData} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                          <XAxis dataKey="range" tick={{ fontSize: 8, fill: "var(--chart-text)" }} axisLine={false} tickLine={false} />
                          <YAxis tick={{ fontSize: 9, fill: "var(--chart-text)" }} axisLine={false} tickLine={false} />
                          <Tooltip
                            contentStyle={{ background: "var(--chart-tooltip-bg)", border: "1px solid var(--chart-tooltip-border)", fontSize: 11 }}
                            formatter={(v: number) => [`${formatNumber(v)}%`, "of runs"]}
                          />
                          <Bar dataKey="probability" radius={[2, 2, 0, 0]}>
                            {chartData.map((_, i) => (
                              <Cell key={i} fill={color} fillOpacity={0.55 + (i / Math.max(chartData.length, 1)) * 0.4} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                      <ChartDataTable
                        caption={`Outcome distribution for ${nodeResult.label}: probability of runs by outcome range`}
                        data={chartData}
                        columns={[
                          { key: "outcome range", value: (row) => row.range },
                          { key: "probability (% of runs)", value: (row) => row.probability },
                          { key: "count", value: (row) => row.count },
                        ]}
                      />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Links applied */}
          {result.links_applied.length > 0 && (
            <div className="surface-raised p-5">
              <div className="text-[10px] text-white/25 uppercase tracking-wider mb-3">links applied</div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] text-white/25 uppercase tracking-wider text-left border-b border-white/[0.06]">
                      <th className="py-2 pr-4 font-medium">from</th>
                      <th className="py-2 pr-4 font-medium">metric</th>
                      <th className="py-2 pr-4 font-medium">into</th>
                      <th className="py-2 pr-4 font-medium">variable</th>
                      <th className="py-2 pr-4 font-medium">transform</th>
                      <th className="py-2 font-medium text-right">mean injected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.links_applied.map((l, i) => (
                      <tr key={i} className="border-b border-white/[0.03] text-white/60">
                        <td className="py-2 pr-4">{labelByNode.get(l.from_node) || l.from_node}</td>
                        <td className="py-2 pr-4">{(metricLabel[l.from_metric] || l.from_metric).replace(" (per-path)", "")}</td>
                        <td className="py-2 pr-4">{labelByNode.get(l.to_node) || l.to_node}</td>
                        <td className="py-2 pr-4 font-mono text-white/50">{l.to_variable}</td>
                        <td className="py-2 pr-4">{l.transform}</td>
                        <td className="py-2 text-right tabular-nums text-white/80">{formatNumber(l.mean_injected_value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Contribution notes */}
          {result.contribution.length > 0 && (
            <div className="surface-raised p-5">
              <div className="text-[10px] text-white/25 uppercase tracking-wider mb-3">domain contributions</div>
              <div className="space-y-3">
                {result.contribution.map((c) => {
                  const color = CATEGORY_COLOR[categoryByNode.get(c.node_id) || "custom"] || CATEGORY_COLOR.custom;
                  return (
                    <div key={c.node_id} className="flex items-start gap-2.5">
                      <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: color }} />
                      <div>
                        <div className="text-xs font-medium text-white/70">{c.label}</div>
                        <div className="text-[11px] text-white/40 leading-relaxed">{c.note}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Summary narrative */}
          {result.summary && (
            <div className="surface-raised p-5">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-3.5 h-3.5 text-white/30" />
                <span className="text-[10px] text-white/25 uppercase tracking-wider">how the domains fed each other</span>
              </div>
              <p className="text-sm text-white/55 leading-relaxed">{result.summary}</p>
            </div>
          )}
        </div>
      )}

      {!result && !running && (
        <div className="surface p-12 flex flex-col items-center justify-center text-center">
          <Boxes className="w-7 h-7 text-white/15 mb-3" />
          <div className="text-sm text-white/40 mb-1">not run yet</div>
          <div className="text-xs text-white/20 max-w-sm mb-5">
            run the composite to execute each sub-simulation in topological order and propagate
            uncertainty across domains
          </div>
          <button
            onClick={handleRun}
            className="btn-primary text-xs py-2 px-4 inline-flex items-center gap-1.5"
          >
            <Play className="w-3 h-3" /> run composite
          </button>
        </div>
      )}
    </div>
  );
}
