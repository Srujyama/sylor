"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, AlertTriangle, GitBranch, Network, Check, GitFork } from "lucide-react";
import { getScenarioTree } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { ScenarioNode, ScenarioTree } from "@/types";

const statusDot: Record<string, string> = {
  completed: "dot-green",
  running: "dot-blue",
  failed: "dot-red",
  draft: "dot-yellow",
};

const NODE_W = 200;
const NODE_H = 84;
const COL_GAP = 64; // horizontal gap between depth columns
const ROW_GAP = 20; // vertical gap between sibling rows

interface LaidOutNode {
  node: ScenarioNode;
  depth: number;
  row: number; // assigned row within the whole layout
}

// Lay the family out left-to-right by depth. Each node gets a row index via a
// DFS over the parent→children map so siblings stack and subtrees don't overlap.
function layout(nodes: ScenarioNode[], rootId: string) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map<string | null, ScenarioNode[]>();
  for (const n of nodes) {
    const key = n.parent_id && byId.has(n.parent_id) ? n.parent_id : null;
    if (!children.has(key)) children.set(key, []);
    children.get(key)!.push(n);
  }
  // Sort each sibling group oldest-first for a stable layout.
  Array.from(children.values()).forEach((group) => {
    group.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  });

  const laid: LaidOutNode[] = [];
  let rowCursor = 0;

  // Roots: the canonical root first, then any orphaned nodes whose parent
  // isn't in the set (defensive — keeps everything visible).
  const roots = (children.get(null) || []).slice();
  const orderedRoots = [
    ...roots.filter((r) => r.id === rootId),
    ...roots.filter((r) => r.id !== rootId),
  ];

  function visit(node: ScenarioNode, depth: number) {
    const kids = children.get(node.id) || [];
    if (kids.length === 0) {
      laid.push({ node, depth, row: rowCursor });
      rowCursor += 1;
      return;
    }
    const firstRow = rowCursor;
    for (const kid of kids) visit(kid, depth + 1);
    const lastRow = rowCursor - 1;
    // Center the parent against its children's row span.
    laid.push({ node, depth, row: (firstRow + lastRow) / 2 });
  }

  for (const root of orderedRoots) visit(root, 0);

  return laid;
}

export default function ScenarioTreePage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { toast } = useToast();
  const [tree, setTree] = useState<ScenarioTree | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    getScenarioTree(params.id)
      .then((data) => { if (!cancelled) setTree(data); })
      .catch((e: any) => {
        if (!cancelled) {
          setError(e.message || "failed to load scenario tree");
          toast({ title: "couldn't load scenario tree", description: e.message || "try again in a moment", variant: "error" });
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  const laid = useMemo(() => {
    if (!tree) return [];
    return layout(tree.nodes, tree.root_id);
  }, [tree]);

  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const item of laid) {
      map.set(item.node.id, {
        x: item.depth * (NODE_W + COL_GAP),
        y: item.row * (NODE_H + ROW_GAP),
      });
    }
    return map;
  }, [laid]);

  const canvas = useMemo(() => {
    let maxX = 0;
    let maxY = 0;
    Array.from(positions.values()).forEach((pos) => {
      maxX = Math.max(maxX, pos.x + NODE_W);
      maxY = Math.max(maxY, pos.y + NODE_H);
    });
    return { width: maxX, height: maxY };
  }, [positions]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 2) next.add(id);
      return next;
    });
  }

  function compareSelected() {
    if (selected.size !== 2) return;
    router.push(`/simulations/compare?ids=${Array.from(selected).join(",")}`);
  }

  const byId = useMemo(() => new Map((tree?.nodes || []).map((n) => [n.id, n])), [tree]);

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <p className="text-xs text-white/25 mb-1 tracking-wide">sylor / simulations / scenario tree</p>
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <Link
              href={`/simulations/${params.id}`}
              className="text-white/30 hover:text-white/60 transition-colors mt-1"
              aria-label="back to simulation"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
                <Network className="w-5 h-5 text-white/40" /> scenario tree
              </h1>
              <p className="text-xs text-white/30 mt-1">
                every branch in this scenario family — click a node to open it
              </p>
            </div>
          </div>
          <button
            onClick={compareSelected}
            disabled={selected.size !== 2}
            className={cn(
              "text-xs py-2 px-4 inline-flex items-center gap-1.5 transition-colors",
              selected.size === 2
                ? "btn-primary"
                : "border border-white/[0.06] text-white/15 cursor-not-allowed"
            )}
          >
            <GitBranch className="w-3 h-3" />
            compare branches ({selected.size}/2)
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-32">
          <Loader2 className="w-6 h-6 animate-spin text-white/20" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-32">
          <AlertTriangle className="w-5 h-5 text-red-400/50 mb-3" />
          <div className="text-xs text-red-400/70 mb-2">{error}</div>
          <Link
            href={`/simulations/${params.id}`}
            className="text-xs text-white/40 hover:text-white/70 border border-white/10 px-3 py-1.5 transition-colors"
          >
            back to simulation
          </Link>
        </div>
      ) : laid.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <GitFork className="w-5 h-5 text-white/20 mb-3" />
          <div className="text-sm text-white/30 mb-1">no branches yet</div>
          <div className="text-[10px] text-white/15 mb-6">
            create a branch from the what-if tab to grow this scenario tree
          </div>
          <Link
            href={`/simulations/${params.id}`}
            className="btn-primary text-xs py-2 px-4 inline-flex items-center gap-1.5"
          >
            back to simulation
          </Link>
        </div>
      ) : (
        <div className="surface p-6 overflow-auto">
          <div
            className="relative"
            style={{ width: Math.max(canvas.width, 1), height: Math.max(canvas.height, 1) }}
          >
            {/* Edges — simple SVG connectors from each node to its parent */}
            <svg
              className="absolute inset-0 pointer-events-none"
              width={Math.max(canvas.width, 1)}
              height={Math.max(canvas.height, 1)}
            >
              {laid.map(({ node }) => {
                if (!node.parent_id || !byId.has(node.parent_id)) return null;
                const child = positions.get(node.id);
                const parent = positions.get(node.parent_id);
                if (!child || !parent) return null;
                const x1 = parent.x + NODE_W;
                const y1 = parent.y + NODE_H / 2;
                const x2 = child.x;
                const y2 = child.y + NODE_H / 2;
                const midX = (x1 + x2) / 2;
                return (
                  <path
                    key={node.id}
                    d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                    fill="none"
                    stroke="rgba(255,255,255,0.12)"
                    strokeWidth={1.5}
                  />
                );
              })}
            </svg>

            {/* Node cards */}
            {laid.map(({ node }) => {
              const pos = positions.get(node.id)!;
              const isSelected = selected.has(node.id);
              const isCurrent = node.id === params.id;
              const title = node.branch_label || node.name;
              return (
                <div
                  key={node.id}
                  className={cn(
                    "absolute surface-raised p-3 transition-colors group",
                    isCurrent && "ring-1 ring-white/25"
                  )}
                  style={{ left: pos.x, top: pos.y, width: NODE_W, height: NODE_H }}
                >
                  <div className="flex items-start gap-2 h-full">
                    {/* Multi-select checkbox for compare */}
                    <button
                      onClick={() => toggleSelect(node.id)}
                      className={cn(
                        "w-4 h-4 border flex items-center justify-center shrink-0 mt-0.5 transition-colors",
                        isSelected ? "border-violet-400/60 bg-violet-400/20" : "border-white/10 hover:border-white/25"
                      )}
                      aria-label={isSelected ? "deselect for compare" : "select for compare"}
                    >
                      {isSelected && <Check className="w-2.5 h-2.5 text-violet-400" />}
                    </button>

                    <button
                      onClick={() => router.push(`/simulations/${node.id}`)}
                      className="flex-1 min-w-0 text-left h-full flex flex-col"
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className={cn("dot shrink-0", statusDot[node.status] || "dot-yellow")} />
                        <span className="text-xs font-medium text-white/80 truncate group-hover:text-white transition-colors">
                          {title}
                        </span>
                      </div>
                      {!node.parent_id && (
                        <span className="text-[9px] text-white/25 uppercase tracking-wider mb-1">root</span>
                      )}
                      <div className="mt-auto flex items-center justify-between">
                        <span className="text-[10px] text-white/25">{node.status}</span>
                        {node.success_probability != null && (
                          <span className="text-xs font-mono text-white/60">
                            {Math.round(node.success_probability)}%
                          </span>
                        )}
                      </div>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
