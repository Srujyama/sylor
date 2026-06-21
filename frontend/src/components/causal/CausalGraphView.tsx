"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Loader2, AlertTriangle, GitBranch, ArrowUpRight, ArrowDownRight,
  Zap, X, Workflow, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { getCausalGraph, interveneCausal } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { CausalGraph, CausalNode, InterventionResult } from "@/types";

const NODE_PALETTE = [
  "#8b5cf6", "#06b6d4", "#22c55e", "#eab308", "#f97316",
  "#ec4899", "#6366f1", "#14b8a6", "#f43f5e", "#a3e635",
];

interface CausalLayoutNode {
  node: CausalNode;
  x: number;
  y: number;
  r: number;
  depth: number;
  color: string;
}

interface CausalLayoutEdge {
  source: string;
  target: string;
  x1: number; y1: number; x2: number; y2: number;
  sign: "positive" | "negative";
  weight: number;
}

interface CausalLayout {
  nodes: CausalLayoutNode[];
  edges: CausalLayoutEdge[];
  typeColors: Array<{ type: string; color: string }>;
  bounds: { x: number; y: number; w: number; h: number };
}

const COL_GAP = 220;
const ROW_GAP = 90;

/**
 * Left-to-right layered layout by causal depth. Depth = longest path from any
 * source (in-degree 0). Cycles are already broken server-side for layering, but
 * we also guard against any residual back-edges so depth assignment terminates.
 */
function computeCausalLayout(graph: CausalGraph): CausalLayout {
  const nodes = graph.nodes || [];
  const edges = (graph.edges || []).filter((e) => e.source_uuid !== e.target_uuid);
  const ids = new Set(nodes.map((n) => n.uuid));
  const validEdges = edges.filter((e) => ids.has(e.source_uuid) && ids.has(e.target_uuid));

  // adjacency
  const out = new Map<string, string[]>();
  nodes.forEach((n) => { out.set(n.uuid, []); });
  validEdges.forEach((e) => {
    out.get(e.source_uuid)!.push(e.target_uuid);
  });

  // Depth-from-source (roots at column 0) via iterative longest-path relaxation.
  // Bounded passes keep this finite even if residual back-edges survived the
  // server-side cycle-break, so layering always terminates.
  const fromSource = new Map<string, number>();
  nodes.forEach((n) => fromSource.set(n.uuid, 0));
  // Iterate enough times to propagate; bounded by node count to stay finite.
  const order = nodes.map((n) => n.uuid);
  for (let pass = 0; pass < Math.min(nodes.length, 64); pass++) {
    let changed = false;
    for (const u of order) {
      const du = fromSource.get(u)!;
      for (const v of out.get(u) || []) {
        if ((fromSource.get(v) || 0) < du + 1) {
          fromSource.set(v, du + 1);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  // group by depth column
  const maxDepth = Math.max(0, ...Array.from(fromSource.values()));
  const cols: string[][] = Array.from({ length: maxDepth + 1 }, () => []);
  nodes.forEach((n) => cols[fromSource.get(n.uuid) || 0].push(n.uuid));

  // colors per entity type
  const types = Array.from(new Set(nodes.map((n) => n.entity_type || "unknown"))).sort();
  const colorOf = new Map(types.map((t, i) => [t, NODE_PALETTE[i % NODE_PALETTE.length]]));

  const pos = new Map<string, { x: number; y: number }>();
  cols.forEach((col, ci) => {
    const colHeight = (col.length - 1) * ROW_GAP;
    col.forEach((uuid, ri) => {
      pos.set(uuid, { x: ci * COL_GAP, y: ri * ROW_GAP - colHeight / 2 });
    });
  });

  const layoutNodes: CausalLayoutNode[] = nodes.map((node) => {
    const p = pos.get(node.uuid)!;
    return {
      node,
      x: p.x,
      y: p.y,
      r: 9,
      depth: fromSource.get(node.uuid) || 0,
      color: colorOf.get(node.entity_type || "unknown") || NODE_PALETTE[0],
    };
  });

  const layoutEdges: CausalLayoutEdge[] = validEdges.map((e) => {
    const a = pos.get(e.source_uuid)!;
    const b = pos.get(e.target_uuid)!;
    return {
      source: e.source_uuid,
      target: e.target_uuid,
      x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      sign: e.sign,
      weight: e.weight,
    };
  });

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ln of layoutNodes) {
    minX = Math.min(minX, ln.x); maxX = Math.max(maxX, ln.x);
    minY = Math.min(minY, ln.y); maxY = Math.max(maxY, ln.y);
  }
  if (!isFinite(minX)) { minX = -100; minY = -100; maxX = 100; maxY = 100; }
  const padX = 120, padY = 80;

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    typeColors: types.map((t) => ({ type: t, color: colorOf.get(t)! })),
    bounds: { x: minX - padX, y: minY - padY, w: maxX - minX + padX * 2, h: maxY - minY + padY * 2 },
  };
}

// Interactive layered DAG SVG: pan via drag, zoom via wheel, directed signed
// arrows, click a node to intervene, effect-driven node highlighting.
function CausalCanvas({
  layout,
  selectedUuid,
  effectByUuid,
  onSelect,
}: {
  layout: CausalLayout;
  selectedUuid: string | null;
  effectByUuid: Map<string, number>; // uuid -> predicted_change (-1..1)
  onSelect: (node: CausalNode) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [viewBox, setViewBox] = useState(layout.bounds);
  const [hoveredUuid, setHoveredUuid] = useState<string | null>(null);
  const [focusedUuid, setFocusedUuid] = useState<string | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; vb: typeof layout.bounds; moved: boolean } | null>(null);

  useEffect(() => { setViewBox(layout.bounds); }, [layout]);

  const handlePointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, vb: viewBox, moved: false };
  }, [viewBox]);

  const handlePointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    const svg = svgRef.current;
    if (!drag || !svg) return;
    const rect = svg.getBoundingClientRect();
    const dxPx = e.clientX - drag.startX;
    const dyPx = e.clientY - drag.startY;
    if (Math.abs(dxPx) + Math.abs(dyPx) > 4) drag.moved = true;
    setViewBox({
      ...drag.vb,
      x: drag.vb.x - dxPx * (drag.vb.w / rect.width),
      y: drag.vb.y - dyPx * (drag.vb.h / rect.height),
    });
  }, []);

  const handlePointerUp = useCallback(() => {
    setTimeout(() => { dragRef.current = null; }, 0);
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = svg!.getBoundingClientRect();
      setViewBox((vb) => {
        const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
        const newW = Math.min(layout.bounds.w * 4, Math.max(layout.bounds.w / 20, vb.w * factor));
        const newH = newW * (vb.h / vb.w);
        const px = vb.x + ((e.clientX - rect.left) / rect.width) * vb.w;
        const py = vb.y + ((e.clientY - rect.top) / rect.height) * vb.h;
        return {
          x: px - ((px - vb.x) / vb.w) * newW,
          y: py - ((py - vb.y) / vb.h) * newH,
          w: newW,
          h: newH,
        };
      });
    }
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [layout.bounds.w]);

  const fontSize = Math.max(8, viewBox.w / 70);
  const hasEffects = effectByUuid.size > 0;

  // Effect color: green for positive change, red for negative; opacity by magnitude
  const effectStroke = (uuid: string): string | null => {
    const ch = effectByUuid.get(uuid);
    if (ch == null) return null;
    return ch >= 0 ? "#22c55e" : "#ef4444";
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
      className="w-full h-[440px] cursor-grab active:cursor-grabbing select-none touch-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <defs>
        <marker id="arrow-pos" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#22c55e" fillOpacity="0.7" />
        </marker>
        <marker id="arrow-neg" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#ef4444" fillOpacity="0.7" />
        </marker>
      </defs>

      {/* Directed signed edges */}
      <g>
        {layout.edges.map((e, i) => {
          // shorten the line so the arrowhead lands at the node edge
          const dx = e.x2 - e.x1;
          const dy = e.y2 - e.y1;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const ux = dx / len, uy = dy / len;
          const x2 = e.x2 - ux * 13;
          const y2 = e.y2 - uy * 13;
          const x1 = e.x1 + ux * 11;
          const y1 = e.y1 + uy * 11;
          const stroke = e.sign === "negative" ? "#ef4444" : "#22c55e";
          return (
            <line
              key={i}
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={stroke}
              strokeOpacity={0.32 + Math.min(0.4, Math.abs(e.weight) * 0.4)}
              strokeWidth={Math.max(0.6, viewBox.w / 1100) * (0.7 + Math.min(1.5, Math.abs(e.weight)))}
              markerEnd={e.sign === "negative" ? "url(#arrow-neg)" : "url(#arrow-pos)"}
            />
          );
        })}
      </g>

      {/* Nodes */}
      <g>
        {layout.nodes.map((ln) => {
          const isSelected = ln.node.uuid === selectedUuid;
          const isHovered = ln.node.uuid === hoveredUuid;
          const isFocused = ln.node.uuid === focusedUuid;
          const eStroke = effectStroke(ln.node.uuid);
          const ch = effectByUuid.get(ln.node.uuid);
          const effected = eStroke != null;
          const dim = hasEffects && !effected && !isSelected;
          const ringW = effected ? Math.max(1.5, viewBox.w / 400) * (0.5 + Math.abs(ch || 0)) : 0;
          return (
            <g key={ln.node.uuid} opacity={dim ? 0.3 : 1}>
              {/* keyboard focus ring — explicit (SVG default focus outlines are unreliable) */}
              {isFocused && (
                <circle
                  cx={ln.x} cy={ln.y}
                  r={ln.r + 4}
                  fill="none"
                  stroke="#a78bfa"
                  strokeWidth={Math.max(1.5, viewBox.w / 350)}
                  strokeOpacity={0.95}
                  className="pointer-events-none"
                />
              )}
              {/* effect halo ring */}
              {effected && (
                <circle
                  cx={ln.x} cy={ln.y}
                  r={ln.r + 5}
                  fill="none"
                  stroke={eStroke!}
                  strokeWidth={ringW}
                  strokeOpacity={0.55 + Math.min(0.45, Math.abs(ch || 0))}
                >
                  <animate
                    attributeName="r"
                    values={`${ln.r + 3};${ln.r + 8};${ln.r + 3}`}
                    dur="1.6s"
                    repeatCount="indefinite"
                  />
                </circle>
              )}
              <circle
                cx={ln.x}
                cy={ln.y}
                r={ln.r * (isSelected || isHovered || isFocused ? 1.3 : 1)}
                fill={ln.color}
                fillOpacity={isSelected || isHovered || isFocused ? 0.95 : 0.75}
                stroke={isSelected ? "#ffffff" : "rgba(255,255,255,0.2)"}
                strokeWidth={isSelected ? Math.max(1, viewBox.w / 500) : Math.max(0.5, viewBox.w / 1500)}
                className="cursor-pointer focus:outline-none"
                tabIndex={0}
                role="button"
                aria-label={`select node ${ln.node.name}`}
                aria-pressed={isSelected}
                onMouseEnter={() => setHoveredUuid(ln.node.uuid)}
                onMouseLeave={() => setHoveredUuid(null)}
                onFocus={() => setFocusedUuid(ln.node.uuid)}
                onBlur={() => setFocusedUuid(null)}
                onClick={(ev) => {
                  ev.stopPropagation();
                  if (dragRef.current?.moved) return;
                  onSelect(ln.node);
                }}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    ev.stopPropagation();
                    onSelect(ln.node);
                  }
                }}
              />
              <text
                x={ln.x}
                y={ln.y - ln.r - fontSize * 0.5}
                textAnchor="middle"
                fontSize={fontSize}
                fill={isSelected || isHovered || isFocused ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.5)"}
                className="pointer-events-none"
              >
                {ln.node.name}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

export function CausalGraphView({ graphId }: { graphId: string }) {
  const { toast } = useToast();
  const [graph, setGraph] = useState<CausalGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<CausalNode | null>(null);

  // intervention panel state
  const [direction, setDirection] = useState<"increase" | "decrease">("increase");
  const [magnitude, setMagnitude] = useState(0.5);
  const [intervening, setIntervening] = useState(false);
  const [intervention, setIntervention] = useState<InterventionResult | null>(null);

  const layout = useMemo(() => (graph ? computeCausalLayout(graph) : null), [graph]);

  // Map of uuid -> predicted_change for highlighting the DAG. Only set when the
  // intervention's source node still matches the currently-selected node.
  const effectByUuid = useMemo(() => {
    const m = new Map<string, number>();
    if (intervention) {
      intervention.effects.forEach((e) => m.set(e.uuid, e.predicted_change));
    }
    return m;
  }, [intervention]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await getCausalGraph(graphId);
        if (!cancelled) setGraph(data);
      } catch (err: any) {
        if (!cancelled) toast({ title: "couldn't load causal view", description: err.message || "this graph may have no causal relationships", variant: "error" });
      }
      if (!cancelled) setLoading(false);
    }
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphId]);

  function selectNode(node: CausalNode) {
    setSelectedNode(node);
    // clear stale effects when picking a different node
    setIntervention((prev) => (prev && prev.intervened_node.uuid === node.uuid ? prev : null));
  }

  async function handleIntervene() {
    if (!selectedNode || intervening) return;
    setIntervening(true);
    try {
      const data = await interveneCausal(graphId, {
        node_uuid: selectedNode.uuid,
        direction,
        magnitude,
      });
      setIntervention(data);
    } catch (err: any) {
      toast({ title: "intervention failed", description: err.message || "try a different node or magnitude", variant: "error" });
    } finally {
      setIntervening(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 border border-white/[0.06] bg-white/[0.01]">
        <Loader2 className="w-5 h-5 text-white/30 animate-spin" />
      </div>
    );
  }

  if (!graph || !layout || layout.nodes.length === 0) {
    return (
      <div className="border border-white/[0.06] bg-white/[0.01] py-16 px-6 text-center">
        <Workflow className="w-6 h-6 text-white/20 mx-auto mb-3" />
        <p className="text-sm text-white/40 mb-1">no causal structure found</p>
        <p className="text-xs text-white/25">
          this graph has no causal relationships (causes, amplifies, dampens, triggers, influences,
          regulates, precedes) to lay out as a dag.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Cycle warning */}
      {graph.has_cycles && (
        <div className="flex items-start gap-2 px-4 py-3 border border-yellow-500/20 bg-yellow-500/[0.06]">
          <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs text-yellow-400/90 font-medium">cycles detected in the causal graph</p>
            <p className="text-[10px] text-white/40 mt-0.5">
              {graph.cycle_note || "feedback loops were broken to lay the graph out left-to-right by causal depth. directionality near a loop is approximate."}
            </p>
          </div>
        </div>
      )}

      {/* DAG canvas */}
      <div className="border border-white/[0.06] bg-white/[0.01] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.06]">
          <span className="text-[10px] text-white/25 uppercase tracking-wider">causal dag · left → right by depth</span>
          <span className="text-[10px] text-white/20">drag to pan · scroll to zoom · click a node to intervene</span>
        </div>
        <CausalCanvas
          layout={layout}
          selectedUuid={selectedNode?.uuid || null}
          effectByUuid={effectByUuid}
          onSelect={selectNode}
        />
        {/* legend */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-4 py-2.5 border-t border-white/[0.06]">
          <div className="flex items-center gap-1.5">
            <span className="w-5 h-0.5 bg-green-500" /><span className="text-[10px] text-white/30">positive (reinforces)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-5 h-0.5 bg-red-500" /><span className="text-[10px] text-white/30">negative (dampens)</span>
          </div>
          {layout.typeColors.slice(0, 6).map(({ type, color }) => (
            <div key={type} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-[10px] text-white/30">{type}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Intervention panel */}
      {selectedNode ? (
        <div className="border border-white/[0.06] bg-white/[0.01] p-5 space-y-5">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-violet-400" />
            <span className="text-sm font-medium text-white">
              intervene on <span className="text-violet-300">{selectedNode.name}</span>
            </span>
            <span className="text-[9px] px-1.5 py-0.5 bg-white/[0.06] text-white/30">{selectedNode.entity_type}</span>
            <button onClick={() => { setSelectedNode(null); setIntervention(null); }} className="ml-auto text-white/25 hover:text-white/60">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* honest framing */}
          <div className="flex items-start gap-2 text-[10px] text-white/30 leading-relaxed">
            <Info className="w-3 h-3 shrink-0 mt-0.5" />
            this is a pearl-style do() on the causal dag — it propagates a signed, decaying effect
            downstream. results are directional inference, not point estimates.
          </div>

          {/* direction + magnitude */}
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-1 p-0.5 bg-white/[0.03] border border-white/[0.06]">
              {(["increase", "decrease"] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setDirection(d)}
                  disabled={intervening}
                  className={cn(
                    "px-3 py-1 text-xs transition-all inline-flex items-center gap-1",
                    direction === d ? "bg-white/10 text-white" : "text-white/30 hover:text-white/50"
                  )}
                >
                  {d === "increase" ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                  {d}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3 flex-1 min-w-[180px]">
              <span className="text-[10px] text-white/25 uppercase tracking-wider">magnitude</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={magnitude}
                disabled={intervening}
                onChange={(e) => setMagnitude(Number(e.target.value))}
                className="flex-1 accent-violet-500"
              />
              <span className="text-xs font-mono text-white/50 w-9 text-right">{magnitude.toFixed(2)}</span>
            </div>

            <Button variant="gradient" size="sm" onClick={handleIntervene} disabled={intervening}>
              {intervening ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              {intervening ? "propagating..." : "intervene"}
            </Button>
          </div>

          {intervening && (
            <p className="text-xs text-white/30 flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin" />
              clamping the node and propagating the signed effect along outgoing causal edges...
            </p>
          )}

          {/* Effects */}
          {intervention && !intervening && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-white/25 uppercase tracking-wider">downstream effects</span>
                <span className="text-[10px] text-white/20">{intervention.effects.length} nodes affected</span>
              </div>

              {intervention.effects.length === 0 && (
                <p className="text-xs text-white/30">no downstream nodes — this node is a sink in the causal dag.</p>
              )}

              {intervention.effects.map((e) => {
                const positive = e.predicted_change >= 0;
                const pct = Math.min(100, Math.abs(e.predicted_change) * 100);
                return (
                  <div key={e.uuid} className="flex items-center gap-3">
                    <span className="text-xs text-white/60 w-40 truncate" title={e.name}>{e.name}</span>
                    <span className="text-[9px] text-white/20 w-12">hop {e.path_length}</span>
                    {/* signed bar centered at 0 */}
                    <div className="flex-1 flex items-center h-4">
                      <div className="flex-1 flex justify-end">
                        {!positive && (
                          <div className="h-2.5 bg-red-500/70" style={{ width: `${pct}%` }} />
                        )}
                      </div>
                      <div className="w-px h-4 bg-white/15" />
                      <div className="flex-1">
                        {positive && (
                          <div className="h-2.5 bg-green-500/70" style={{ width: `${pct}%` }} />
                        )}
                      </div>
                    </div>
                    <span className={cn("text-xs font-mono w-14 text-right", positive ? "text-green-400" : "text-red-400")}>
                      {positive ? "+" : ""}{e.predicted_change.toFixed(2)}
                    </span>
                  </div>
                );
              })}

              {intervention.note && (
                <div className="flex items-start gap-2 px-3 py-2.5 border border-violet-500/20 bg-violet-500/[0.06] mt-2">
                  <Info className="w-3.5 h-3.5 text-violet-400 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-white/55 italic leading-relaxed">{intervention.note}</p>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="border border-white/[0.06] bg-white/[0.01] py-8 text-center">
          <p className="text-xs text-white/25">click a node in the dag to run a do() intervention on it</p>
        </div>
      )}
    </div>
  );
}
