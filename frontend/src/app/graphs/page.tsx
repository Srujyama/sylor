"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Network, Loader2, ChevronRight } from "lucide-react";
import { listGraphs } from "@/lib/api";
import type { GraphStatistics } from "@/types";

export default function GraphsPage() {
  const [graphs, setGraphs] = useState<GraphStatistics[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const data = await listGraphs();
        setGraphs(data);
      } catch {}
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-white tracking-tight">Knowledge Graphs</h1>
        <p className="text-xs text-white/40 mt-1">
          Explore entity relationships extracted from your documents. Powered by AI-driven GraphRAG.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-5 h-5 text-white/30 animate-spin" />
        </div>
      ) : graphs.length === 0 ? (
        <div className="text-center py-20 border border-white/[0.06] rounded-lg bg-white/[0.02]">
          <Network className="w-10 h-10 text-white/15 mx-auto mb-3" />
          <p className="text-sm text-white/40 mb-2">No knowledge graphs yet</p>
          <p className="text-xs text-white/25">Create a project and upload documents to build one.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {graphs.map((graph) => (
            <Link
              key={graph.graph_id}
              href={`/graphs/${graph.graph_id}`}
              className="border border-white/[0.06] rounded-lg p-5 hover:border-white/[0.12] hover:bg-white/[0.02] transition-all group"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Network className="w-4 h-4 text-white/30" />
                  <h3 className="text-sm font-medium text-white">{graph.name}</h3>
                </div>
                <ChevronRight className="w-4 h-4 text-white/15 group-hover:text-white/40 transition-colors" />
              </div>
              <div className="grid grid-cols-3 gap-3 mb-3">
                <div>
                  <p className="text-lg font-semibold text-white">{graph.total_nodes}</p>
                  <p className="text-[10px] text-white/25">entities</p>
                </div>
                <div>
                  <p className="text-lg font-semibold text-white">{graph.total_edges}</p>
                  <p className="text-[10px] text-white/25">relationships</p>
                </div>
                <div>
                  <p className="text-lg font-semibold text-white">{Object.keys(graph.entity_types).length}</p>
                  <p className="text-[10px] text-white/25">types</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {Object.entries(graph.entity_types).map(([type, count]) => (
                  <span key={type} className="text-[9px] px-1.5 py-0.5 rounded bg-white/[0.04] text-white/30">
                    {type} ({count})
                  </span>
                ))}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
