"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Plus, Trash2, Loader2, Boxes, GitBranch, AlertTriangle,
  Link2, Copy, Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createComposite, listSimulations, getSimulation } from "@/lib/api";
import { onAuthChange } from "@/lib/firebase/auth";
import { useToast } from "@/components/ui/toast";
import {
  COMPOSITE_CATEGORIES, CATEGORY_COLOR, FROM_METRICS, TRANSFORMS,
  defaultConfigForCategory, variableNamesOf,
} from "@/lib/composite-templates";
import type {
  SimulationCategory, CompositeLink, CompositeFromMetric, CompositeTransform,
} from "@/types";

interface BuilderNode {
  node_id: string;
  label: string;
  category: SimulationCategory;
  config: Record<string, any>;
  source: "template" | "reused";
  sourceSimId?: string;
}

interface BuilderLink {
  id: string;
  from_node: string;
  from_metric: CompositeFromMetric;
  to_node: string;
  to_variable: string;
  transform: CompositeTransform;
  factor: number;
}

interface SimEntry {
  id: string;
  name: string;
  category: string;
}

const NUM_RUNS_OPTIONS = [100, 500, 1000, 2000, 5000];

// slugify a label into a stable node_id, de-duped against existing ids
function makeNodeId(label: string, existing: Set<string>): string {
  const base =
    label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") ||
    "node";
  let id = base;
  let i = 2;
  while (existing.has(id)) {
    id = `${base}_${i}`;
    i++;
  }
  return id;
}

// Would adding from -> to introduce a cycle? True if `to` already reaches `from`.
function wouldCycle(links: BuilderLink[], from: string, to: string): boolean {
  if (from === to) return true;
  const adj = new Map<string, string[]>();
  for (const l of links) {
    if (!adj.has(l.from_node)) adj.set(l.from_node, []);
    adj.get(l.from_node)!.push(l.to_node);
  }
  // Does `to` reach `from` through existing edges?
  const seen = new Set<string>();
  const stack = [to];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === from) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const nxt of adj.get(cur) || []) stack.push(nxt);
  }
  return false;
}

export default function NewCompositePage() {
  const router = useRouter();
  const { toast } = useToast();

  const [authReady, setAuthReady] = useState(false);
  const [name, setName] = useState("");
  const [numRuns, setNumRuns] = useState(1000);
  const [nodes, setNodes] = useState<BuilderNode[]>([]);
  const [links, setLinks] = useState<BuilderLink[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // existing sims to optionally reuse a config from
  const [sims, setSims] = useState<SimEntry[]>([]);

  useEffect(() => {
    const unsub = onAuthChange((user) => {
      setAuthReady(true);
      if (user?.uid) {
        listSimulations(user.uid)
          .then((data: any[]) => {
            setSims(
              (data || []).map((s: any) => ({
                id: s.id,
                name: s.name,
                category: s.category,
              }))
            );
          })
          .catch(() => setSims([]));
      }
    });
    return () => unsub();
  }, []);

  // seed with two starter nodes once auth is ready (if none yet)
  useEffect(() => {
    if (!authReady) return;
    setNodes((prev) => {
      if (prev.length > 0) return prev;
      const ids = new Set<string>();
      const mk = (cat: SimulationCategory, label: string): BuilderNode => {
        const node_id = makeNodeId(label, ids);
        ids.add(node_id);
        return {
          node_id,
          label,
          category: cat,
          config: defaultConfigForCategory(cat, label),
          source: "template",
        };
      };
      return [mk("biology", "biology"), mk("startup", "business")];
    });
  }, [authReady]);

  function addNode() {
    if (nodes.length >= 4) return;
    setNodes((prev) => {
      const existing = new Set(prev.map((n) => n.node_id));
      const label = `node ${prev.length + 1}`;
      const node_id = makeNodeId(label, existing);
      return [
        ...prev,
        {
          node_id,
          label,
          category: "finance" as SimulationCategory,
          config: defaultConfigForCategory("finance", label),
          source: "template",
        },
      ];
    });
  }

  function removeNode(node_id: string) {
    setNodes((prev) => prev.filter((n) => n.node_id !== node_id));
    setLinks((prev) =>
      prev.filter((l) => l.from_node !== node_id && l.to_node !== node_id)
    );
  }

  // change a node's category re-seeds its config from the matching template
  function setNodeCategory(node_id: string, category: SimulationCategory) {
    setNodes((prev) =>
      prev.map((n) =>
        n.node_id === node_id
          ? {
              ...n,
              category,
              source: "template",
              sourceSimId: undefined,
              config: defaultConfigForCategory(category, n.label),
            }
          : n
      )
    );
    // drop links whose to_variable no longer exists on this node
    pruneLinksForNode(node_id, defaultConfigForCategory(category, ""));
  }

  function setNodeLabel(node_id: string, label: string) {
    setNodes((prev) =>
      prev.map((n) =>
        n.node_id === node_id
          ? { ...n, label, config: { ...n.config, name: label } }
          : n
      )
    );
  }

  async function reuseSimConfig(node_id: string, simId: string) {
    if (!simId) return;
    try {
      const sim = await getSimulation(simId);
      const cfg = sim?.config || {};
      const label = nodes.find((n) => n.node_id === node_id)?.label || sim?.name || "node";
      const category: SimulationCategory = (cfg.category || sim?.category || "custom") as SimulationCategory;
      setNodes((prev) =>
        prev.map((n) =>
          n.node_id === node_id
            ? {
                ...n,
                category,
                source: "reused",
                sourceSimId: simId,
                config: { ...cfg, name: label, category },
              }
            : n
        )
      );
      pruneLinksForNode(node_id, cfg);
      toast({ title: "config loaded", description: `reusing "${sim?.name}" (${variableNamesOf(cfg).length} variables)`, variant: "success" });
    } catch (e: any) {
      toast({ title: "failed to load config", description: e.message || "try another simulation", variant: "error" });
    }
  }

  // remove any links targeting a variable that no longer exists on a node
  const pruneLinksForNode = useCallback((node_id: string, cfg: Record<string, any>) => {
    const valid = new Set(variableNamesOf(cfg));
    setLinks((prev) =>
      prev.filter((l) => l.to_node !== node_id || valid.has(l.to_variable))
    );
  }, []);

  function addLink() {
    if (nodes.length < 2) return;
    // pick a default non-cyclic from/to pair
    const from = nodes[0];
    const candidates = nodes.filter(
      (n) => n.node_id !== from.node_id && !wouldCycle(links, from.node_id, n.node_id)
    );
    const to = candidates[0];
    if (!to) {
      toast({ title: "can't add link", description: "no valid downstream node without forming a cycle", variant: "error" });
      return;
    }
    const toVars = variableNamesOf(to.config);
    setLinks((prev) => [
      ...prev,
      {
        id: `link-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        from_node: from.node_id,
        from_metric: "final_revenue",
        to_node: to.node_id,
        to_variable: toVars[0] || "",
        transform: "linear",
        factor: 1.0,
      },
    ]);
  }

  function removeLink(id: string) {
    setLinks((prev) => prev.filter((l) => l.id !== id));
  }

  function updateLink(id: string, patch: Partial<BuilderLink>) {
    setLinks((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        const next = { ...l, ...patch };
        // if from/to changed, validate against cycles using the OTHER links
        if (patch.from_node || patch.to_node) {
          const others = prev.filter((x) => x.id !== id);
          if (next.from_node === next.to_node || wouldCycle(others, next.from_node, next.to_node)) {
            toast({ title: "would form a cycle", description: "a composite must be a DAG — pick a different edge", variant: "error" });
            return l;
          }
        }
        // if to_node changed, reset to_variable to the first valid one
        if (patch.to_node) {
          const toNode = nodes.find((n) => n.node_id === patch.to_node);
          const toVars = variableNamesOf(toNode?.config);
          next.to_variable = toVars[0] || "";
        }
        return next;
      })
    );
  }

  const canSubmit = name.trim().length > 0 && nodes.length >= 2 && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const payload = {
        name: name.trim(),
        num_runs: numRuns,
        nodes: nodes.map((n) => ({
          node_id: n.node_id,
          label: n.label,
          config: n.config,
        })),
        links: links.map((l): CompositeLink => ({
          from_node: l.from_node,
          from_metric: l.from_metric,
          to_node: l.to_node,
          to_variable: l.to_variable,
          transform: l.transform,
          factor: l.factor,
        })),
      };
      const res = await createComposite(payload);
      toast({ title: "composite created", description: `${nodes.length} nodes, ${links.length} links`, variant: "success" });
      router.push(`/composites/${res.composite_id}`);
    } catch (err: any) {
      toast({ title: "failed to create composite", description: err.message || "check the links and try again", variant: "error" });
      setSubmitting(false);
    }
  }

  if (!authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-5 h-5 text-white/30 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Link
          href="/composites"
          className="text-white/30 hover:text-white/60 transition-colors"
          aria-label="back to composites"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex-1">
          <p className="text-xs text-white/25 mb-1 tracking-wide">sylor / composites / new</p>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            <Boxes className="w-5 h-5 text-white/40" /> new composite
          </h1>
          <p className="text-xs text-white/30 mt-1">
            assemble 2-4 sub-simulations, then link one model&apos;s metric into another&apos;s variable
          </p>
        </div>
      </div>

      {/* Name + runs */}
      <div className="surface-raised p-5 mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-2">
            <label className="text-xs text-white/50 mb-1.5 block">composite name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. drug → product → portfolio"
              className="w-full bg-transparent border border-white/10 text-sm text-white px-3 py-2 focus:outline-none focus:border-white/20 placeholder:text-white/20"
            />
          </div>
          <div>
            <label className="text-xs text-white/50 mb-1.5 block">runs per node</label>
            <select
              value={numRuns}
              onChange={(e) => setNumRuns(Number(e.target.value))}
              className="w-full bg-[var(--page-bg)] border border-white/10 text-sm text-white/70 px-3 py-2 focus:outline-none focus:border-white/20"
            >
              {NUM_RUNS_OPTIONS.map((n) => (
                <option key={n} value={n}>{n.toLocaleString()}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Nodes */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-white/80 flex items-center gap-1.5">
          <Boxes className="w-3.5 h-3.5 text-white/40" /> sub-simulations ({nodes.length}/4)
        </h2>
        <button
          onClick={addNode}
          disabled={nodes.length >= 4}
          className={cn(
            "text-xs py-1.5 px-3 inline-flex items-center gap-1.5 border transition-colors",
            nodes.length >= 4
              ? "border-white/[0.06] text-white/15 cursor-not-allowed"
              : "border-white/10 text-white/50 hover:text-white/80 hover:border-white/20"
          )}
        >
          <Plus className="w-3 h-3" /> add node
        </button>
      </div>

      <div className="space-y-3 mb-8">
        {nodes.map((n) => {
          const vars = variableNamesOf(n.config);
          return (
            <div key={n.node_id} className="surface-raised p-4">
              <div className="flex items-start gap-3">
                <span
                  className="w-2.5 h-2.5 rounded-full mt-2 shrink-0"
                  style={{ background: CATEGORY_COLOR[n.category] || CATEGORY_COLOR.custom }}
                />
                <div className="flex-1 min-w-0 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-white/30 uppercase tracking-wider mb-1 block">label</label>
                      <input
                        value={n.label}
                        onChange={(e) => setNodeLabel(n.node_id, e.target.value)}
                        className="w-full bg-transparent border border-white/10 text-sm text-white px-2.5 py-1.5 focus:outline-none focus:border-white/20"
                      />
                      <div className="text-[10px] text-white/20 mt-1 font-mono">id: {n.node_id}</div>
                    </div>
                    <div>
                      <label className="text-[10px] text-white/30 uppercase tracking-wider mb-1 block">category</label>
                      <select
                        value={n.category}
                        onChange={(e) => setNodeCategory(n.node_id, e.target.value as SimulationCategory)}
                        className="w-full bg-[var(--page-bg)] border border-white/10 text-sm text-white/70 px-2.5 py-1.5 focus:outline-none focus:border-white/20"
                      >
                        {COMPOSITE_CATEGORIES.map((c) => (
                          <option key={c.value} value={c.value}>{c.label} — {c.blurb}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Reuse an existing sim's config */}
                  {sims.length > 0 && (
                    <div>
                      <label className="text-[10px] text-white/30 uppercase tracking-wider mb-1 block inline-flex items-center gap-1">
                        <Copy className="w-2.5 h-2.5" /> reuse an existing simulation (optional)
                      </label>
                      <select
                        value={n.sourceSimId || ""}
                        onChange={(e) => {
                          if (e.target.value) reuseSimConfig(n.node_id, e.target.value);
                          else setNodeCategory(n.node_id, n.category);
                        }}
                        className="w-full bg-[var(--page-bg)] border border-white/10 text-xs text-white/60 px-2.5 py-1.5 focus:outline-none focus:border-white/20"
                      >
                        <option value="">— start from template —</option>
                        {sims.map((s) => (
                          <option key={s.id} value={s.id}>{s.name} ({s.category})</option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-1.5">
                    {vars.length === 0 ? (
                      <span className="text-[10px] text-amber-400/60">no variables — links can&apos;t target this node</span>
                    ) : (
                      vars.map((v) => (
                        <span key={v} className="text-[10px] text-white/35 bg-white/[0.04] px-1.5 py-0.5 font-mono">{v}</span>
                      ))
                    )}
                  </div>
                </div>
                <button
                  onClick={() => removeNode(n.node_id)}
                  disabled={nodes.length <= 2}
                  className={cn(
                    "p-1.5 transition-colors shrink-0",
                    nodes.length <= 2
                      ? "text-white/10 cursor-not-allowed"
                      : "text-white/20 hover:text-red-400/60 hover:bg-red-400/[0.05]"
                  )}
                  title={nodes.length <= 2 ? "a composite needs at least 2 nodes" : "remove node"}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Links */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-white/80 flex items-center gap-1.5">
          <Link2 className="w-3.5 h-3.5 text-white/40" /> links ({links.length})
        </h2>
        <button
          onClick={addLink}
          disabled={nodes.length < 2}
          className={cn(
            "text-xs py-1.5 px-3 inline-flex items-center gap-1.5 border transition-colors",
            nodes.length < 2
              ? "border-white/[0.06] text-white/15 cursor-not-allowed"
              : "border-white/10 text-white/50 hover:text-white/80 hover:border-white/20"
          )}
        >
          <Plus className="w-3 h-3" /> add link
        </button>
      </div>

      <div className="space-y-3 mb-8">
        {links.length === 0 ? (
          <div className="surface px-5 py-8 text-center">
            <GitBranch className="w-5 h-5 text-white/15 mx-auto mb-2" />
            <div className="text-xs text-white/30">no links yet</div>
            <div className="text-[10px] text-white/15 mt-1">
              a composite with no links just runs each node in isolation — add a link to chain them
            </div>
          </div>
        ) : (
          links.map((l) => {
            const toNode = nodes.find((n) => n.node_id === l.to_node);
            const toVars = variableNamesOf(toNode?.config);
            const needsFactor = l.transform === "linear" || l.transform === "scale";
            return (
              <div key={l.id} className="surface-raised p-4">
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_auto] gap-3 items-end">
                  {/* From */}
                  <div className="space-y-2">
                    <div className="text-[10px] text-white/30 uppercase tracking-wider">from</div>
                    <select
                      value={l.from_node}
                      onChange={(e) => updateLink(l.id, { from_node: e.target.value })}
                      className="w-full bg-[var(--page-bg)] border border-white/10 text-xs text-white/70 px-2.5 py-1.5 focus:outline-none focus:border-white/20"
                    >
                      {nodes.map((n) => (
                        <option key={n.node_id} value={n.node_id}>{n.label}</option>
                      ))}
                    </select>
                    <select
                      value={l.from_metric}
                      onChange={(e) => updateLink(l.id, { from_metric: e.target.value as CompositeFromMetric })}
                      className="w-full bg-[var(--page-bg)] border border-white/10 text-xs text-white/70 px-2.5 py-1.5 focus:outline-none focus:border-white/20"
                    >
                      {FROM_METRICS.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* To */}
                  <div className="space-y-2">
                    <div className="text-[10px] text-white/30 uppercase tracking-wider">into</div>
                    <select
                      value={l.to_node}
                      onChange={(e) => updateLink(l.id, { to_node: e.target.value })}
                      className="w-full bg-[var(--page-bg)] border border-white/10 text-xs text-white/70 px-2.5 py-1.5 focus:outline-none focus:border-white/20"
                    >
                      {nodes.map((n) => (
                        <option key={n.node_id} value={n.node_id}>{n.label}</option>
                      ))}
                    </select>
                    <select
                      value={l.to_variable}
                      onChange={(e) => updateLink(l.id, { to_variable: e.target.value })}
                      className="w-full bg-[var(--page-bg)] border border-white/10 text-xs text-white/70 px-2.5 py-1.5 focus:outline-none focus:border-white/20"
                    >
                      {toVars.length === 0 ? (
                        <option value="">no variables</option>
                      ) : (
                        toVars.map((v) => (
                          <option key={v} value={v}>{v}</option>
                        ))
                      )}
                    </select>
                  </div>

                  <button
                    onClick={() => removeLink(l.id)}
                    className="p-1.5 text-white/20 hover:text-red-400/60 hover:bg-red-400/[0.05] transition-colors shrink-0"
                    title="remove link"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Transform + factor */}
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 mt-3 items-end">
                  <div>
                    <div className="text-[10px] text-white/30 uppercase tracking-wider mb-1">transform</div>
                    <select
                      value={l.transform}
                      onChange={(e) => updateLink(l.id, { transform: e.target.value as CompositeTransform })}
                      className="w-full bg-[var(--page-bg)] border border-white/10 text-xs text-white/70 px-2.5 py-1.5 focus:outline-none focus:border-white/20"
                    >
                      {TRANSFORMS.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                  {needsFactor && (
                    <div>
                      <div className="text-[10px] text-white/30 uppercase tracking-wider mb-1">factor</div>
                      <input
                        type="number"
                        step="0.1"
                        value={l.factor}
                        onChange={(e) => updateLink(l.id, { factor: Number(e.target.value) })}
                        className="w-28 bg-transparent border border-white/10 text-xs text-white px-2.5 py-1.5 focus:outline-none focus:border-white/20"
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Submit */}
      <div className="flex items-center justify-between border-t border-white/[0.06] pt-5">
        <div className="text-[10px] text-white/20 flex items-center gap-1.5">
          {nodes.length < 2 ? (
            <>
              <AlertTriangle className="w-3 h-3 text-amber-400/50" />
              add at least 2 sub-simulations
            </>
          ) : (
            <>
              <Workflow className="w-3 h-3 text-white/25" />
              the backend validates the DAG — cycles and unknown references are rejected
            </>
          )}
        </div>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={cn(
            "text-xs py-2 px-5 inline-flex items-center gap-1.5 transition-colors",
            canSubmit ? "btn-primary" : "border border-white/[0.06] text-white/15 cursor-not-allowed"
          )}
        >
          {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Boxes className="w-3 h-3" />}
          create composite
        </button>
      </div>
    </div>
  );
}
