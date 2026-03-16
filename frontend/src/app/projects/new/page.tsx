"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Upload, Loader2, FolderKanban } from "lucide-react";
import Link from "next/link";
import { createProject, uploadDocuments } from "@/lib/api";

const CATEGORIES = [
  { value: "startup", label: "Startup", desc: "Go-to-market, growth, funding scenarios" },
  { value: "finance", label: "Finance", desc: "Portfolio, trading, risk analysis" },
  { value: "biology", label: "Biology", desc: "Molecular dynamics, binding, pathways" },
  { value: "trend", label: "Trend", desc: "Forecasting, pattern detection" },
  { value: "pricing", label: "Pricing", desc: "Price optimization, elasticity" },
  { value: "policy", label: "Policy", desc: "Regulatory impact analysis" },
  { value: "custom", label: "Custom", desc: "Any simulation domain" },
];

export default function NewProjectPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("startup");
  const [files, setFiles] = useState<File[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  async function handleCreate() {
    if (!name.trim()) {
      setError("Enter a project name");
      return;
    }
    setCreating(true);
    setError("");

    try {
      // Create project
      const project = await createProject(name.trim(), category);

      // Upload files if any
      if (files.length > 0) {
        await uploadDocuments(project.project_id, files);
      }

      router.push(`/projects/${project.project_id}`);
    } catch (err: any) {
      setError(err.message || "Failed to create project");
      setCreating(false);
    }
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <Link href="/projects" className="flex items-center gap-2 text-xs text-white/30 hover:text-white/60 mb-6">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Projects
      </Link>

      <div className="mb-8">
        <h1 className="text-xl font-semibold text-white tracking-tight">New Project</h1>
        <p className="text-xs text-white/40 mt-1">
          Create a project to build knowledge graphs, generate agent profiles, and run AI-powered simulations.
        </p>
      </div>

      <div className="space-y-6">
        {/* Name */}
        <div>
          <label className="block text-xs font-medium text-white/50 mb-2">Project Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Startup Simulation"
            className="w-full px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/20"
          />
        </div>

        {/* Category */}
        <div>
          <label className="block text-xs font-medium text-white/50 mb-2">Simulation Domain</label>
          <div className="grid grid-cols-2 gap-2">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                onClick={() => setCategory(cat.value)}
                className={`text-left px-3 py-2 border rounded text-xs transition-all ${
                  category === cat.value
                    ? "border-white/20 bg-white/[0.06] text-white"
                    : "border-white/[0.06] text-white/40 hover:border-white/[0.12] hover:text-white/60"
                }`}
              >
                <span className="font-medium">{cat.label}</span>
                <span className="block text-[10px] text-white/25 mt-0.5">{cat.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Document Upload */}
        <div>
          <label className="block text-xs font-medium text-white/50 mb-2">
            Upload Documents <span className="text-white/25">(optional — for knowledge graph)</span>
          </label>
          <div
            className="border border-dashed border-white/[0.08] rounded-lg p-6 text-center cursor-pointer hover:border-white/[0.15] transition-colors"
            onClick={() => document.getElementById("file-input")?.click()}
          >
            <Upload className="w-6 h-6 text-white/15 mx-auto mb-2" />
            <p className="text-xs text-white/30">
              Drop PDF, TXT, CSV, XLSX, or Markdown files here
            </p>
            <p className="text-[10px] text-white/15 mt-1">
              Max 20MB per file
            </p>
            <input
              id="file-input"
              type="file"
              multiple
              accept=".pdf,.txt,.csv,.xlsx,.xls,.md,.markdown"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) setFiles(Array.from(e.target.files));
              }}
            />
          </div>
          {files.length > 0 && (
            <div className="mt-2 space-y-1">
              {files.map((f, i) => (
                <div key={i} className="flex items-center justify-between text-xs text-white/40 px-2 py-1 bg-white/[0.02] rounded">
                  <span>{f.name}</span>
                  <span>{(f.size / 1024).toFixed(0)} KB</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <p className="text-xs text-red-400">{error}</p>
        )}

        {/* Submit */}
        <button
          onClick={handleCreate}
          disabled={creating}
          className="btn-primary w-full justify-center text-sm py-2.5 disabled:opacity-40"
        >
          {creating ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Creating...
            </>
          ) : (
            <>
              <FolderKanban className="w-4 h-4" />
              Create Project
            </>
          )}
        </button>
      </div>
    </div>
  );
}
