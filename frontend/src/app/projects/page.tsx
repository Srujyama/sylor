"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Plus, FolderKanban, Loader2, Trash2, Network, FileText, Play } from "lucide-react";
import { listProjects, deleteProject } from "@/lib/api";
import type { Project } from "@/types";

const STATUS_COLORS: Record<string, string> = {
  created: "bg-gray-500/20 text-gray-400",
  documents_uploaded: "bg-blue-500/20 text-blue-400",
  graph_building: "bg-yellow-500/20 text-yellow-400",
  graph_ready: "bg-green-500/20 text-green-400",
  profiles_generated: "bg-purple-500/20 text-purple-400",
  simulation_ready: "bg-cyan-500/20 text-cyan-400",
  running: "bg-orange-500/20 text-orange-400",
  completed: "bg-emerald-500/20 text-emerald-400",
  failed: "bg-red-500/20 text-red-400",
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProjects();
  }, []);

  async function loadProjects() {
    try {
      const data = await listProjects();
      setProjects(data);
    } catch {
      // API may not be running yet
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(projectId: string) {
    if (!confirm("Delete this project and all associated data?")) return;
    try {
      await deleteProject(projectId);
      setProjects((prev) => prev.filter((p) => p.project_id !== projectId));
    } catch {}
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold text-white tracking-tight">Projects</h1>
          <p className="text-xs text-white/40 mt-1">
            Full pipeline: upload documents, build knowledge graphs, generate agent profiles, run simulations, and create AI reports.
          </p>
        </div>
        <Link
          href="/projects/new"
          className="btn-primary text-xs py-2 px-4 flex items-center gap-2"
        >
          <Plus className="w-3.5 h-3.5" />
          New Project
        </Link>
      </div>

      {/* Projects List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-5 h-5 text-white/30 animate-spin" />
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-20 border border-white/[0.06] rounded-lg bg-white/[0.02]">
          <FolderKanban className="w-10 h-10 text-white/15 mx-auto mb-3" />
          <p className="text-sm text-white/40 mb-4">No projects yet</p>
          <Link href="/projects/new" className="btn-primary text-xs py-2 px-4 inline-flex items-center gap-2">
            <Plus className="w-3.5 h-3.5" />
            Create your first project
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {projects.map((project) => (
            <Link
              key={project.project_id}
              href={`/projects/${project.project_id}`}
              className="block border border-white/[0.06] rounded-lg p-4 hover:border-white/[0.12] hover:bg-white/[0.02] transition-all group"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="text-sm font-medium text-white truncate">{project.name}</h3>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[project.status] || "bg-gray-500/20 text-gray-400"}`}>
                      {project.status.replace(/_/g, " ")}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-[10px] text-white/30">
                    <span>{project.simulation_category}</span>
                    <span>{project.documents.length} documents</span>
                    {project.graph_id && (
                      <span className="flex items-center gap-1">
                        <Network className="w-3 h-3" /> Graph ready
                      </span>
                    )}
                    {project.agent_profiles_count > 0 && (
                      <span>{project.agent_profiles_count} profiles</span>
                    )}
                    {project.report_id && (
                      <span className="flex items-center gap-1">
                        <FileText className="w-3 h-3" /> Report
                      </span>
                    )}
                    <span>{new Date(project.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      handleDelete(project.project_id);
                    }}
                    className="p-1.5 text-white/20 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
