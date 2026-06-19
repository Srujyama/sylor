"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Plus, Loader2, ArrowRight, RotateCcw, Trash2, Boxes, Workflow,
} from "lucide-react";
import { listComposites, deleteComposite } from "@/lib/api";
import { onAuthChange } from "@/lib/firebase/auth";
import { useToast } from "@/components/ui/toast";
import type { CompositeListItem } from "@/types";

const statusDot: Record<string, string> = {
  completed: "dot-green",
  running: "dot-blue",
  failed: "dot-red",
  created: "dot-yellow",
  draft: "dot-yellow",
};

const statusTagClass: Record<string, string> = {
  completed: "tag-green",
  running: "tag-blue",
  failed: "tag-red",
  created: "tag-yellow",
  draft: "tag-yellow",
};

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (!then || isNaN(then)) return "";
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return `${diffD}d ago`;
  return `${Math.floor(diffD / 30)}mo ago`;
}

export default function CompositesPage() {
  const { toast } = useToast();
  const [authReady, setAuthReady] = useState(false);
  const [userReady, setUserReady] = useState(false);
  const [composites, setComposites] = useState<CompositeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthChange((user) => {
      if (user?.uid) setUserReady(true);
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  const fetchComposites = useCallback(async () => {
    try {
      setError(null);
      const data = await listComposites();
      const items = (data?.composites || []).slice().sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      setComposites(items);
    } catch (err: any) {
      setError(err.message || "failed to load composites");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authReady || !userReady) return;
    fetchComposites();
    const interval = setInterval(fetchComposites, 8000);
    return () => clearInterval(interval);
  }, [authReady, userReady, fetchComposites]);

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await deleteComposite(id);
      setComposites((prev) => prev.filter((c) => c.composite_id !== id));
      toast({ title: "composite deleted" });
    } catch {
      toast({ title: "failed to delete", variant: "error" });
    }
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <p className="text-xs text-white/25 mb-1 tracking-wide">sylor / composites</p>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            <Boxes className="w-5 h-5 text-white/40" /> composites
          </h1>
          <p className="text-xs text-white/30 mt-1">
            chain simulations across domains — let one model&apos;s output drive another&apos;s inputs
          </p>
        </div>
        <Link href="/composites/new" className="btn-primary text-xs py-2 px-4 inline-flex items-center gap-1.5">
          <Plus className="w-3 h-3" />
          new composite
        </Link>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="surface-raised p-5">
              <div className="h-4 w-40 bg-white/[0.04] animate-pulse mb-3" />
              <div className="h-3 w-28 bg-white/[0.04] animate-pulse mb-2" />
              <div className="h-3 w-20 bg-white/[0.04] animate-pulse" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="surface px-5 py-16 text-center">
          <div className="text-xs text-red-400/70 mb-2">failed to load composites</div>
          <div className="text-[10px] text-white/20 mb-4">{error}</div>
          <button onClick={fetchComposites} className="text-xs text-white/40 hover:text-white/70 border border-white/10 px-3 py-1.5 transition-colors">
            <RotateCcw className="w-3 h-3 inline mr-1.5" /> retry
          </button>
        </div>
      ) : composites.length === 0 ? (
        <div className="surface px-5 py-20 text-center">
          <Workflow className="w-7 h-7 text-white/15 mx-auto mb-4" />
          <div className="text-sm text-white/40 mb-2">no composites yet</div>
          <div className="text-xs text-white/20 max-w-md mx-auto mb-6 leading-relaxed">
            a composite chains simulations across domains — let one model&apos;s output drive
            another&apos;s inputs. e.g. feed a biology model&apos;s binding affinity into a
            startup model&apos;s pricing, then into a finance model&apos;s portfolio return.
            uncertainty propagates path-by-path across the chain.
          </div>
          <Link href="/composites/new" className="btn-primary text-xs py-2 px-4 inline-flex items-center gap-1.5">
            <Plus className="w-3 h-3" /> new composite
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {composites.map((c) => (
            <Link
              key={c.composite_id}
              href={`/composites/${c.composite_id}`}
              className="surface-raised p-5 group hover:border-white/15 transition-colors relative"
            >
              <div className="flex items-start gap-2 mb-3">
                <span className={`dot ${statusDot[c.status] || "dot-yellow"} shrink-0 mt-1.5`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white/80 truncate group-hover:text-white transition-colors">
                    {c.name}
                  </div>
                  <div className="text-[10px] text-white/25 mt-0.5">{timeAgo(c.created_at)}</div>
                </div>
                <button
                  onClick={(e) => handleDelete(e, c.composite_id)}
                  className="p-1.5 text-white/15 hover:text-red-400/60 hover:bg-red-400/[0.05] transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                  title="delete"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className={`tag ${statusTagClass[c.status] || "tag-yellow"}`}>
                  {c.status}
                  {c.status === "running" && <Loader2 className="w-2.5 h-2.5 animate-spin inline ml-1" />}
                </span>
                <span className="tag">
                  {c.node_count} node{c.node_count !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="flex items-center justify-end mt-3 text-white/15 group-hover:text-white/40 transition-colors">
                <ArrowRight className="w-3.5 h-3.5" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
