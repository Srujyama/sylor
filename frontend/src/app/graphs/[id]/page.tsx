"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Network, Search, Loader2 } from "lucide-react";
import { getGraph, getGraphNodes, getGraphEdges, searchGraph } from "@/lib/api";
import type { EntityNode, EntityEdge, GraphStatistics } from "@/types";

export default function GraphDetailPage() {
  const params = useParams();
  const graphId = params.id as string;

  const [stats, setStats] = useState<GraphStatistics | null>(null);
  const [nodes, setNodes] = useState<EntityNode[]>([]);
  const [edges, setEdges] = useState<EntityEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedType, setSelectedType] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<EntityNode[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [selectedNode, setSelectedNode] = useState<EntityNode | null>(null);

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
      } catch {}
      setLoading(false);
    }
    load();
  }, [graphId]);

  async function handleSearch() {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const data = await searchGraph(graphId, searchQuery.trim());
      setSearchResults(data.results);
    } catch {}
    setSearching(false);
  }

  async function handleFilterType(type: string) {
    setSelectedType(type);
    try {
      const data = await getGraphNodes(graphId, type || undefined);
      setNodes(data.nodes);
    } catch {}
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
      <div className="mb-6">
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
    </div>
  );
}
