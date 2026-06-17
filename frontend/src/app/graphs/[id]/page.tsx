"use client";

export const dynamic = 'force-dynamic';

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Network, Search, Loader2, Workflow } from "lucide-react";
import { getGraph, getGraphNodes, getGraphEdges, searchGraph } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { CausalGraphView } from "@/components/causal/CausalGraphView";
import { cn } from "@/lib/utils";
import type { EntityNode, EntityEdge, GraphStatistics } from "@/types";

// ─── Force-directed layout (hand-rolled, no deps) ─────────

const ENTITY_PALETTE = [
  "#8b5cf6", "#06b6d4", "#22c55e", "#eab308", "#f97316",
  "#ec4899", "#6366f1", "#14b8a6", "#f43f5e", "#a3e635",
];

const MAX_RENDER_NODES = 300;

interface LayoutNode {
  node: EntityNode;
  x: number;
  y: number;
  r: number;
  color: string;
  degree: number;
}

interface GraphLayout {
  nodes: LayoutNode[];
  edges: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  typeColors: Array<{ type: string; color: string }>;
  capped: boolean;
  bounds: { x: number; y: number; w: number; h: number };
}

/**
 * Fruchterman-Reingold-style force simulation, precomputed (~150 iterations):
 * pairwise repulsion + edge springs + center gravity with a cooling schedule.
 */
function computeGraphLayout(allNodes: EntityNode[], allEdges: EntityEdge[]): GraphLayout {
  const degree = new Map<string, number>();
  for (const e of allEdges) {
    degree.set(e.source_uuid, (degree.get(e.source_uuid) || 0) + 1);
    degree.set(e.target_uuid, (degree.get(e.target_uuid) || 0) + 1);
  }

  const ranked = [...allNodes].sort(
    (a, b) => (degree.get(b.uuid) || 0) - (degree.get(a.uuid) || 0)
  );
  const capped = ranked.length > MAX_RENDER_NODES;
  const kept = ranked.slice(0, MAX_RENDER_NODES);
  const keptIds = new Set(kept.map((n) => n.uuid));
  const idxOf = new Map(kept.map((n, i) => [n.uuid, i]));

  const edgePairs: Array<[number, number]> = [];
  for (const e of allEdges) {
    if (e.source_uuid === e.target_uuid) continue;
    if (!keptIds.has(e.source_uuid) || !keptIds.has(e.target_uuid)) continue;
    edgePairs.push([idxOf.get(e.source_uuid)!, idxOf.get(e.target_uuid)!]);
  }

  const n = kept.length;
  const size = Math.max(400, Math.sqrt(n) * 80);
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);

  // Deterministic golden-angle spiral init — stable across renders
  const GA = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const r = (size / 2) * Math.sqrt((i + 0.5) / Math.max(1, n));
    xs[i] = Math.cos(i * GA) * r;
    ys[i] = Math.sin(i * GA) * r;
  }

  if (n > 1) {
    const k = size / Math.sqrt(n); // ideal edge length
    const iterations = 150;
    let temp = size / 8;
    const dx = new Float64Array(n);
    const dy = new Float64Array(n);

    for (let iter = 0; iter < iterations; iter++) {
      dx.fill(0);
      dy.fill(0);

      // Repulsion between every pair
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          let ddx = xs[i] - xs[j];
          let ddy = ys[i] - ys[j];
          let d2 = ddx * ddx + ddy * ddy;
          if (d2 < 0.01) {
            // Coincident points — nudge apart deterministically
            ddx = ((((i * 31 + j * 7) % 13) - 6) || 1) * 0.05;
            ddy = ((((i * 17 + j * 3) % 11) - 5) || 1) * 0.05;
            d2 = ddx * ddx + ddy * ddy;
          }
          const f = (k * k) / d2;
          dx[i] += ddx * f;
          dy[i] += ddy * f;
          dx[j] -= ddx * f;
          dy[j] -= ddy * f;
        }
      }

      // Spring attraction along edges
      for (const [a, b] of edgePairs) {
        const ddx = xs[a] - xs[b];
        const ddy = ys[a] - ys[b];
        const d = Math.sqrt(ddx * ddx + ddy * ddy) || 0.01;
        const f = d / k; // displacement = delta * d / k
        dx[a] -= ddx * f;
        dy[a] -= ddy * f;
        dx[b] += ddx * f;
        dy[b] += ddy * f;
      }

      // Center gravity + apply displacement capped by temperature
      for (let i = 0; i < n; i++) {
        dx[i] -= xs[i] * 0.05;
        dy[i] -= ys[i] * 0.05;
        const d = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]) || 0.01;
        const lim = Math.min(d, temp);
        xs[i] += (dx[i] / d) * lim;
        ys[i] += (dy[i] / d) * lim;
      }
      temp *= 0.97;
    }
  }

  // Consistent palette: entity types sorted alphabetically
  const types = Array.from(new Set(kept.map((node) => node.entity_type || "unknown"))).sort();
  const colorOf = new Map(types.map((t, i) => [t, ENTITY_PALETTE[i % ENTITY_PALETTE.length]]));

  const layoutNodes: LayoutNode[] = kept.map((node, i) => {
    const deg = degree.get(node.uuid) || 0;
    return {
      node,
      x: xs[i],
      y: ys[i],
      r: Math.min(14, 4 + Math.sqrt(deg) * 1.6),
      color: colorOf.get(node.entity_type || "unknown") || ENTITY_PALETTE[0],
      degree: deg,
    };
  });

  const layoutEdges = edgePairs.map(([a, b]) => ({
    x1: xs[a], y1: ys[a], x2: xs[b], y2: ys[b],
  }));

  // Bounds with padding
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ln of layoutNodes) {
    minX = Math.min(minX, ln.x); maxX = Math.max(maxX, ln.x);
    minY = Math.min(minY, ln.y); maxY = Math.max(maxY, ln.y);
  }
  if (!isFinite(minX)) { minX = -100; minY = -100; maxX = 100; maxY = 100; }
  const pad = Math.max(40, (maxX - minX) * 0.08);

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    typeColors: types.map((t) => ({ type: t, color: colorOf.get(t)! })),
    capped,
    bounds: { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 },
  };
}

// ─── Interactive SVG canvas (pan via drag, zoom via wheel) ─

function GraphCanvas({
  layout,
  selectedUuid,
  onSelect,
}: {
  layout: GraphLayout;
  selectedUuid: string | null;
  onSelect: (node: EntityNode) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [viewBox, setViewBox] = useState(layout.bounds);
  const [hoveredUuid, setHoveredUuid] = useState<string | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; vb: typeof layout.bounds; moved: boolean } | null>(null);

  // Reset the camera whenever the layout changes (filter / reload)
  useEffect(() => {
    setViewBox(layout.bounds);
  }, [layout]);

  const zoomLevel = layout.bounds.w / Math.max(1, viewBox.w);
  const showAllLabels = zoomLevel >= 1.8 || layout.nodes.length <= 30;

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
    // Keep `moved` readable by the click handlers firing right after pointerup
    setTimeout(() => { dragRef.current = null; }, 0);
  }, []);

  // Wheel zoom — attached manually with passive:false so preventDefault works
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
        // Zoom around the cursor position
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

  const fontSize = Math.max(8, viewBox.w / 60);

  return (
    <svg
      ref={svgRef}
      viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
      className="w-full h-[420px] cursor-grab active:cursor-grabbing select-none touch-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      {/* Edges */}
      <g>
        {layout.edges.map((e, i) => (
          <line
            key={i}
            x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={Math.max(0.5, viewBox.w / 1200)}
          />
        ))}
      </g>
      {/* Nodes */}
      <g>
        {layout.nodes.map((ln) => {
          const isSelected = ln.node.uuid === selectedUuid;
          const isHovered = ln.node.uuid === hoveredUuid;
          return (
            <g key={ln.node.uuid}>
              <circle
                cx={ln.x}
                cy={ln.y}
                r={ln.r * (isSelected || isHovered ? 1.25 : 1)}
                fill={ln.color}
                fillOpacity={isSelected || isHovered ? 0.95 : 0.7}
                stroke={isSelected ? "#ffffff" : "rgba(255,255,255,0.15)"}
                strokeWidth={isSelected ? Math.max(1, viewBox.w / 500) : Math.max(0.5, viewBox.w / 1500)}
                className="cursor-pointer"
                onMouseEnter={() => setHoveredUuid(ln.node.uuid)}
                onMouseLeave={() => setHoveredUuid(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  if (dragRef.current?.moved) return; // it was a pan, not a click
                  onSelect(ln.node);
                }}
              />
              {(showAllLabels || isHovered || isSelected) && (
                <text
                  x={ln.x}
                  y={ln.y - ln.r - fontSize * 0.5}
                  textAnchor="middle"
                  fontSize={fontSize}
                  fill={isSelected || isHovered ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.45)"}
                  className="pointer-events-none"
                >
                  {ln.node.name}
                </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

export default function GraphDetailPage() {
  const params = useParams();
  const graphId = params.id as string;
  const { toast } = useToast();

  const [stats, setStats] = useState<GraphStatistics | null>(null);
  const [nodes, setNodes] = useState<EntityNode[]>([]);
  const [edges, setEdges] = useState<EntityEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedType, setSelectedType] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<EntityNode[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [selectedNode, setSelectedNode] = useState<EntityNode | null>(null);
  // Toggle between the entity (force-directed) view and the causal DAG + do() view
  const [viewMode, setViewMode] = useState<"entity" | "causal">("entity");

  // Precomputed force-directed layout — re-runs when the node/edge set changes
  const layout = useMemo(() => computeGraphLayout(nodes, edges), [nodes, edges]);

  useEffect(() => {
    async function load() {
      try {
        const [statsData, nodesData, edgesData] = await Promise.all([
          getGraph(graphId),
          getGraphNodes(graphId),
          getGraphEdges(graphId),
        ]);
        setStats(statsData);
        setNodes(nodesData.nodes);
        setEdges(edgesData.edges);
      } catch (err: any) {
        toast({ title: "failed to load graph", description: err.message || "check your connection and try again", variant: "error" });
      }
      setLoading(false);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphId]);

  async function handleSearch() {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const data = await searchGraph(graphId, searchQuery.trim());
      setSearchResults(data.results);
    } catch (err: any) {
      toast({ title: "graph search failed", description: err.message || "try a different query", variant: "error" });
    }
    setSearching(false);
  }

  async function handleFilterType(type: string) {
    setSelectedType(type);
    try {
      const data = await getGraphNodes(graphId, type || undefined);
      setNodes(data.nodes);
    } catch (err: any) {
      toast({ title: "failed to filter entities", description: err.message || "try again in a moment", variant: "error" });
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-5 h-5 text-white/30 animate-spin" />
      </div>
    );
  }

  const displayNodes = searchResults || nodes;

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <Link href="/graphs" className="flex items-center gap-2 text-xs text-white/30 hover:text-white/60 mb-6">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Graphs
      </Link>

      {/* Header with Stats */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white tracking-tight flex items-center gap-2">
            <Network className="w-5 h-5 text-white/30" />
            {stats?.name || "Knowledge Graph"}
          </h1>
          <div className="flex items-center gap-6 mt-2">
            <div>
              <span className="text-lg font-semibold text-white">{stats?.total_nodes || 0}</span>
              <span className="text-xs text-white/25 ml-1">entities</span>
            </div>
            <div>
              <span className="text-lg font-semibold text-white">{stats?.total_edges || 0}</span>
              <span className="text-xs text-white/25 ml-1">relationships</span>
            </div>
          </div>
        </div>

        {/* Entity ↔ causal view toggle */}
        <div className="flex items-center gap-1 p-0.5 bg-white/[0.03] border border-white/[0.08] rounded h-fit">
          <button
            onClick={() => setViewMode("entity")}
            className={cn(
              "px-3 py-1.5 text-xs transition-all inline-flex items-center gap-1.5 rounded",
              viewMode === "entity" ? "bg-white/10 text-white" : "text-white/30 hover:text-white/50"
            )}
          >
            <Network className="w-3.5 h-3.5" /> entity view
          </button>
          <button
            onClick={() => setViewMode("causal")}
            className={cn(
              "px-3 py-1.5 text-xs transition-all inline-flex items-center gap-1.5 rounded",
              viewMode === "causal" ? "bg-white/10 text-white" : "text-white/30 hover:text-white/50"
            )}
          >
            <Workflow className="w-3.5 h-3.5" /> causal view
          </button>
        </div>
      </div>

      {/* Causal DAG + do-operator view */}
      {viewMode === "causal" && <CausalGraphView graphId={graphId} />}

      {/* Entity (force-directed) view */}
      {viewMode === "entity" && (
      <>
      {/* Search & Filter */}
      <div className="flex gap-3 mb-6">
        <div className="flex-1 flex gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Search entities..."
            className="flex-1 px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-white/20"
          />
          <button onClick={handleSearch} className="btn-primary text-xs py-2 px-3">
            {searching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
          </button>
          {searchResults && (
            <button
              onClick={() => { setSearchResults(null); setSearchQuery(""); }}
              className="text-xs text-white/30 hover:text-white/60 px-2"
            >
              Clear
            </button>
          )}
        </div>
        <select
          value={selectedType}
          onChange={(e) => handleFilterType(e.target.value)}
          className="px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded text-xs text-white/60 focus:outline-none"
        >
          <option value="">All types</option>
          {stats && Object.keys(stats.entity_types).map((type) => (
            <option key={type} value={type}>{type} ({stats.entity_types[type]})</option>
          ))}
        </select>
      </div>

      {/* Interactive graph view */}
      {layout.nodes.length > 0 && (
        <div className="border border-white/[0.06] rounded-lg bg-white/[0.01] mb-6 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.06]">
            <span className="text-[10px] text-white/25 uppercase tracking-wider">graph view</span>
            <div className="flex items-center gap-3 text-[10px] text-white/20">
              {layout.capped && <span>showing top {MAX_RENDER_NODES} by degree</span>}
              <span>drag to pan · scroll to zoom · click a node for details</span>
            </div>
          </div>
          <GraphCanvas
            layout={layout}
            selectedUuid={selectedNode?.uuid || null}
            onSelect={(node) => setSelectedNode(node)}
          />
          {/* Entity type legend */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5 border-t border-white/[0.06]">
            {layout.typeColors.map(({ type, color }) => (
              <div key={type} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-[10px] text-white/30">{type}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="grid grid-cols-3 gap-6">
        {/* Entity List */}
        <div className="col-span-2 space-y-2">
          {displayNodes.map((node) => (
            <button
              key={node.uuid}
              onClick={() => setSelectedNode(node)}
              className={`w-full text-left border rounded-lg p-3 transition-all ${
                selectedNode?.uuid === node.uuid
                  ? "border-white/20 bg-white/[0.06]"
                  : "border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.02]"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-medium text-white">{node.name}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/[0.06] text-white/30">
                  {node.entity_type}
                </span>
              </div>
              {node.summary && (
                <p className="text-[10px] text-white/30 line-clamp-2">{node.summary}</p>
              )}
              {node.related_nodes && node.related_nodes.length > 0 && (
                <div className="flex items-center gap-1 mt-1.5">
                  <span className="text-[9px] text-white/15">{node.related_nodes.length} connections</span>
                </div>
              )}
            </button>
          ))}
          {displayNodes.length === 0 && (
            <p className="text-xs text-white/25 text-center py-8">No entities found</p>
          )}
        </div>

        {/* Entity Detail Panel */}
        <div className="border border-white/[0.06] rounded-lg p-4 bg-white/[0.01] h-fit sticky top-8">
          {selectedNode ? (
            <div>
              <h3 className="text-sm font-medium text-white mb-1">{selectedNode.name}</h3>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/[0.06] text-white/30">
                {selectedNode.entity_type}
              </span>

              {selectedNode.summary && (
                <p className="text-xs text-white/40 mt-3">{selectedNode.summary}</p>
              )}

              {Object.keys(selectedNode.attributes).length > 0 && (
                <div className="mt-3">
                  <h4 className="text-[10px] font-medium text-white/25 uppercase mb-1">Attributes</h4>
                  {Object.entries(selectedNode.attributes).map(([k, v]) => (
                    <div key={k} className="flex justify-between text-[10px] py-0.5">
                      <span className="text-white/25">{k}</span>
                      <span className="text-white/50">{String(v)}</span>
                    </div>
                  ))}
                </div>
              )}

              {selectedNode.related_nodes && selectedNode.related_nodes.length > 0 && (
                <div className="mt-3">
                  <h4 className="text-[10px] font-medium text-white/25 uppercase mb-1">Relationships</h4>
                  {selectedNode.related_nodes.map((rel, i) => (
                    <div key={i} className="text-[10px] py-0.5 text-white/30">
                      <span className="text-white/15">{rel.relation}</span> → <span className="text-white/50">{rel.name}</span>
                      <span className="text-white/15 ml-1">({rel.type})</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-white/20 text-center py-8">Select an entity to view details</p>
          )}
        </div>
      </div>
      </>
      )}
    </div>
  );
}
