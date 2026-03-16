"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { FileText, Loader2, ChevronRight, Download, Trash2 } from "lucide-react";
import { listReports } from "@/lib/api";
import type { Report } from "@/types";

export default function ReportsPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const data = await listReports();
        setReports(data);
      } catch {}
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-white tracking-tight">Reports</h1>
        <p className="text-xs text-white/40 mt-1">
          AI-generated analysis reports using tool-augmented reasoning (ReACT pattern).
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-5 h-5 text-white/30 animate-spin" />
        </div>
      ) : reports.length === 0 ? (
        <div className="text-center py-20 border border-white/[0.06] rounded-lg bg-white/[0.02]">
          <FileText className="w-10 h-10 text-white/15 mx-auto mb-3" />
          <p className="text-sm text-white/40 mb-2">No reports yet</p>
          <p className="text-xs text-white/25">Run a simulation and generate a report from the results.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {reports.map((report) => (
            <Link
              key={report.report_id}
              href={`/reports/${report.report_id}`}
              className="block border border-white/[0.06] rounded-lg p-4 hover:border-white/[0.12] hover:bg-white/[0.02] transition-all group"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-medium text-white truncate">{report.title || "Untitled Report"}</h3>
                  {report.summary && (
                    <p className="text-[10px] text-white/30 mt-0.5 line-clamp-1">{report.summary}</p>
                  )}
                  <div className="flex items-center gap-3 mt-1 text-[10px] text-white/20">
                    <span>{report.sections.length} sections</span>
                    <span className={`px-1.5 py-0.5 rounded ${
                      report.status === "completed" ? "bg-emerald-500/10 text-emerald-400" : "bg-white/[0.04] text-white/30"
                    }`}>
                      {report.status}
                    </span>
                    <span>{new Date(report.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-white/15 group-hover:text-white/40 transition-colors" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
