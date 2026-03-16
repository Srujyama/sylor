"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Upload, Network, Users, Play, FileText, MessageSquare,
  Loader2, CheckCircle, XCircle, Clock, ChevronRight,
} from "lucide-react";
import {
  getProject, uploadDocuments, buildKnowledgeGraph, generateProfiles,
  getTaskStatus, generateReport, chatWithReport,
} from "@/lib/api";
import type { Project, TaskStatus as TaskStatusType } from "@/types";

const PHASE_ICONS = {
  documents: Upload,
  graph: Network,
  profiles: Users,
  simulation: Play,
  report: FileText,
  chat: MessageSquare,
};

export default function ProjectDetailPage() {
  const params = useParams();
  const projectId = params.id as string;

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTask, setActiveTask] = useState<TaskStatusType | null>(null);
  const [chatMessages, setChatMessages] = useState<Array<{ role: string; content: string }>>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  const loadProject = useCallback(async () => {
    try {
      const data = await getProject(projectId);
      setProject(data);
    } catch {}
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    loadProject();
  }, [loadProject]);

  // Poll task status
  useEffect(() => {
    if (!activeTask || activeTask.status === "completed" || activeTask.status === "failed") return;

    const interval = setInterval(async () => {
      try {
        const task = await getTaskStatus(activeTask.task_id);
        setActiveTask(task);
        if (task.status === "completed" || task.status === "failed") {
          await loadProject();
        }
      } catch {}
    }, 2000);

    return () => clearInterval(interval);
  }, [activeTask, loadProject]);

  async function handleUpload(files: FileList) {
    try {
      await uploadDocuments(projectId, Array.from(files));
      await loadProject();
    } catch {}
  }

  async function handleBuildGraph() {
    try {
      const result = await buildKnowledgeGraph(projectId);
      setActiveTask({ task_id: result.task_id, task_type: "graph_build", status: "processing", progress: 0, message: "Starting...", result: null, error: null, created_at: "" });
    } catch {}
  }

  async function handleGenerateProfiles() {
    try {
      const result = await generateProfiles(projectId);
      setActiveTask({ task_id: result.task_id, task_type: "profile_generation", status: "processing", progress: 0, message: "Starting...", result: null, error: null, created_at: "" });
    } catch {}
  }

  async function handleGenerateReport() {
    try {
      const result = await generateReport(projectId);
      setActiveTask({ task_id: result.task_id, task_type: "report_generation", status: "processing", progress: 0, message: "Starting...", result: null, error: null, created_at: "" });
    } catch {}
  }

  async function handleChat() {
    if (!chatInput.trim()) return;
    const msg = chatInput.trim();
    setChatMessages((prev) => [...prev, { role: "user", content: msg }]);
    setChatInput("");
    setChatLoading(true);

    try {
      const result = await chatWithReport(projectId, msg);
      setChatMessages((prev) => [...prev, { role: "assistant", content: result.response }]);
    } catch {
      setChatMessages((prev) => [...prev, { role: "assistant", content: "Sorry, could not get a response." }]);
    } finally {
      setChatLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-5 h-5 text-white/30 animate-spin" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-8">
        <p className="text-sm text-white/40">Project not found</p>
      </div>
    );
  }

  const phases = [
    {
      key: "documents",
      label: "Upload Documents",
      description: "Upload PDFs, text files, or CSVs for knowledge extraction",
      completed: project.documents.length > 0,
      active: project.status === "created",
    },
    {
      key: "graph",
      label: "Build Knowledge Graph",
      description: `Extract entities and relationships from ${project.documents.length} documents`,
      completed: project.graph_id !== null,
      active: project.status === "documents_uploaded",
    },
    {
      key: "profiles",
      label: "Generate Agent Profiles",
      description: "Create AI-powered agent personas from graph entities",
      completed: project.agent_profiles_count > 0,
      active: project.status === "graph_ready",
    },
    {
      key: "simulation",
      label: "Run Simulation",
      description: "Execute Monte Carlo simulation with generated agents",
      completed: project.simulation_results_available,
      active: project.status === "profiles_generated" || project.status === "simulation_ready",
    },
    {
      key: "report",
      label: "Generate Report",
      description: "AI-powered analysis report with tool-augmented reasoning",
      completed: project.report_id !== null,
      active: project.status === "completed",
    },
    {
      key: "chat",
      label: "Chat with Report",
      description: "Ask questions about the simulation results and report",
      completed: false,
      active: project.report_id !== null,
    },
  ];

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <Link href="/projects" className="flex items-center gap-2 text-xs text-white/30 hover:text-white/60 mb-6">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Projects
      </Link>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-white tracking-tight">{project.name}</h1>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-xs text-white/30">{project.simulation_category}</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.06] text-white/40">
            {project.status.replace(/_/g, " ")}
          </span>
        </div>
      </div>

      {/* Active Task Progress */}
      {activeTask && activeTask.status === "processing" && (
        <div className="mb-6 p-4 border border-white/[0.08] rounded-lg bg-white/[0.02]">
          <div className="flex items-center gap-3 mb-2">
            <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
            <span className="text-sm text-white/70">{activeTask.message || "Processing..."}</span>
          </div>
          <div className="w-full bg-white/[0.06] rounded-full h-1.5">
            <div
              className="bg-blue-500 h-1.5 rounded-full transition-all duration-500"
              style={{ width: `${activeTask.progress}%` }}
            />
          </div>
          <p className="text-[10px] text-white/25 mt-1">{activeTask.progress.toFixed(0)}% complete</p>
        </div>
      )}

      {/* Pipeline Phases */}
      <div className="space-y-3">
        {phases.map((phase, i) => {
          const Icon = PHASE_ICONS[phase.key as keyof typeof PHASE_ICONS];
          return (
            <div
              key={phase.key}
              className={`border rounded-lg p-4 transition-all ${
                phase.completed
                  ? "border-emerald-500/20 bg-emerald-500/[0.02]"
                  : phase.active
                  ? "border-white/[0.12] bg-white/[0.03]"
                  : "border-white/[0.04] bg-white/[0.01] opacity-50"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {phase.completed ? (
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Icon className={`w-4 h-4 ${phase.active ? "text-white/50" : "text-white/20"}`} />
                  )}
                  <div>
                    <h3 className={`text-sm font-medium ${phase.completed ? "text-emerald-400" : phase.active ? "text-white" : "text-white/30"}`}>
                      {phase.label}
                    </h3>
                    <p className="text-[10px] text-white/25 mt-0.5">{phase.description}</p>
                  </div>
                </div>

                {/* Phase Actions */}
                {phase.key === "documents" && phase.active && (
                  <label className="btn-primary text-[10px] py-1.5 px-3 cursor-pointer">
                    <Upload className="w-3 h-3" /> Upload
                    <input
                      type="file"
                      multiple
                      accept=".pdf,.txt,.csv,.xlsx,.xls,.md"
                      className="hidden"
                      onChange={(e) => e.target.files && handleUpload(e.target.files)}
                    />
                  </label>
                )}
                {phase.key === "graph" && phase.active && (
                  <button onClick={handleBuildGraph} className="btn-primary text-[10px] py-1.5 px-3">
                    <Network className="w-3 h-3" /> Build Graph
                  </button>
                )}
                {phase.key === "profiles" && phase.active && (
                  <button onClick={handleGenerateProfiles} className="btn-primary text-[10px] py-1.5 px-3">
                    <Users className="w-3 h-3" /> Generate
                  </button>
                )}
                {phase.key === "simulation" && phase.active && (
                  <Link href="/simulations/new" className="btn-primary text-[10px] py-1.5 px-3">
                    <Play className="w-3 h-3" /> Configure & Run
                  </Link>
                )}
                {phase.key === "report" && phase.active && !phase.completed && (
                  <button onClick={handleGenerateReport} className="btn-primary text-[10px] py-1.5 px-3">
                    <FileText className="w-3 h-3" /> Generate Report
                  </button>
                )}
                {phase.key === "report" && phase.completed && project.report_id && (
                  <Link href={`/reports/${project.report_id}`} className="text-xs text-white/40 hover:text-white/70 flex items-center gap-1">
                    View <ChevronRight className="w-3 h-3" />
                  </Link>
                )}
                {phase.key === "graph" && phase.completed && project.graph_id && (
                  <Link href={`/graphs/${project.graph_id}`} className="text-xs text-white/40 hover:text-white/70 flex items-center gap-1">
                    View <ChevronRight className="w-3 h-3" />
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Chat Section */}
      {project.report_id && (
        <div className="mt-8 border border-white/[0.08] rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.06] bg-white/[0.02]">
            <h3 className="text-xs font-medium text-white/50 flex items-center gap-2">
              <MessageSquare className="w-3.5 h-3.5" /> Chat with Report Agent
            </h3>
          </div>
          <div className="p-4 max-h-80 overflow-y-auto space-y-3">
            {chatMessages.length === 0 && (
              <p className="text-xs text-white/20 text-center py-4">
                Ask questions about the simulation results and analysis report.
              </p>
            )}
            {chatMessages.map((msg, i) => (
              <div key={i} className={`text-xs ${msg.role === "user" ? "text-white/70 text-right" : "text-white/50"}`}>
                <span className={`inline-block px-3 py-2 rounded-lg max-w-[80%] ${
                  msg.role === "user" ? "bg-white/[0.08]" : "bg-white/[0.03] border border-white/[0.06]"
                }`}>
                  {msg.content}
                </span>
              </div>
            ))}
            {chatLoading && (
              <div className="flex items-center gap-2 text-xs text-white/30">
                <Loader2 className="w-3 h-3 animate-spin" /> Thinking...
              </div>
            )}
          </div>
          <div className="px-4 py-3 border-t border-white/[0.06] flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleChat()}
              placeholder="Ask about the simulation results..."
              className="flex-1 px-3 py-1.5 bg-white/[0.04] border border-white/[0.08] rounded text-xs text-white placeholder:text-white/15 focus:outline-none focus:border-white/20"
            />
            <button onClick={handleChat} disabled={chatLoading} className="btn-primary text-[10px] py-1.5 px-3">
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
