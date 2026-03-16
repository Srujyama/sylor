"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FileText, Download, MessageSquare, Loader2, Copy, Check } from "lucide-react";
import { getReport, chatWithReportDirect } from "@/lib/api";
import type { Report } from "@/types";

export default function ReportDetailPage() {
  const params = useParams();
  const reportId = params.id as string;

  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState(0);
  const [copied, setCopied] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ role: string; content: string }>>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [showChat, setShowChat] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const data = await getReport(reportId);
        setReport(data);
      } catch {}
      setLoading(false);
    }
    load();
  }, [reportId]);

  async function handleCopy() {
    if (report?.full_markdown) {
      await navigator.clipboard.writeText(report.full_markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function handleDownload() {
    if (!report?.full_markdown) return;
    const blob = new Blob([report.full_markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${report.title || "report"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleChat() {
    if (!chatInput.trim()) return;
    const msg = chatInput.trim();
    setChatMessages((prev) => [...prev, { role: "user", content: msg }]);
    setChatInput("");
    setChatLoading(true);

    try {
      const result = await chatWithReportDirect(reportId, msg);
      setChatMessages((prev) => [...prev, { role: "assistant", content: result.response }]);
    } catch {
      setChatMessages((prev) => [...prev, { role: "assistant", content: "Sorry, couldn't generate a response." }]);
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

  if (!report) {
    return (
      <div className="p-8">
        <p className="text-sm text-white/40">Report not found</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <Link href="/reports" className="flex items-center gap-2 text-xs text-white/30 hover:text-white/60">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Reports
        </Link>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowChat(!showChat)} className="text-xs text-white/30 hover:text-white/60 flex items-center gap-1.5 px-3 py-1.5 border border-white/[0.08] rounded hover:border-white/[0.15] transition-colors">
            <MessageSquare className="w-3.5 h-3.5" /> {showChat ? "Hide Chat" : "Chat"}
          </button>
          <button onClick={handleCopy} className="text-xs text-white/30 hover:text-white/60 flex items-center gap-1.5 px-3 py-1.5 border border-white/[0.08] rounded hover:border-white/[0.15] transition-colors">
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button onClick={handleDownload} className="text-xs text-white/30 hover:text-white/60 flex items-center gap-1.5 px-3 py-1.5 border border-white/[0.08] rounded hover:border-white/[0.15] transition-colors">
            <Download className="w-3.5 h-3.5" /> Download
          </button>
        </div>
      </div>

      <div className="flex gap-6">
        {/* Main Content */}
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-white tracking-tight mb-2">{report.title}</h1>
          {report.summary && (
            <p className="text-xs text-white/40 mb-6 italic">{report.summary}</p>
          )}

          {/* Section tabs */}
          <div className="flex gap-1 mb-6 overflow-x-auto pb-2">
            {report.sections.map((section, i) => (
              <button
                key={i}
                onClick={() => setActiveSection(i)}
                className={`text-xs px-3 py-1.5 rounded whitespace-nowrap transition-colors ${
                  activeSection === i
                    ? "bg-white/[0.08] text-white"
                    : "text-white/30 hover:text-white/50 hover:bg-white/[0.03]"
                }`}
              >
                {section.title}
              </button>
            ))}
          </div>

          {/* Active Section Content */}
          {report.sections[activeSection] && (
            <div className="prose prose-invert prose-sm max-w-none">
              <h2 className="text-base font-semibold text-white mb-4">
                {report.sections[activeSection].title}
              </h2>
              <div
                className="text-xs text-white/60 leading-relaxed whitespace-pre-wrap"
                style={{ lineHeight: "1.8" }}
              >
                {report.sections[activeSection].content}
              </div>
            </div>
          )}
        </div>

        {/* Chat Panel */}
        {showChat && (
          <div className="w-80 border border-white/[0.08] rounded-lg overflow-hidden flex flex-col h-[calc(100vh-12rem)] sticky top-8">
            <div className="px-3 py-2.5 border-b border-white/[0.06] bg-white/[0.02]">
              <h3 className="text-[10px] font-medium text-white/40 flex items-center gap-1.5">
                <MessageSquare className="w-3 h-3" /> Ask about this report
              </h3>
            </div>
            <div className="flex-1 p-3 overflow-y-auto space-y-2.5">
              {chatMessages.length === 0 && (
                <p className="text-[10px] text-white/15 text-center py-6">
                  Ask questions about the analysis.
                </p>
              )}
              {chatMessages.map((msg, i) => (
                <div key={i} className={`text-[10px] ${msg.role === "user" ? "text-right" : ""}`}>
                  <span className={`inline-block px-2.5 py-1.5 rounded max-w-[90%] ${
                    msg.role === "user"
                      ? "bg-white/[0.08] text-white/60"
                      : "bg-white/[0.02] border border-white/[0.06] text-white/50"
                  }`}>
                    {msg.content}
                  </span>
                </div>
              ))}
              {chatLoading && (
                <div className="flex items-center gap-1.5 text-[10px] text-white/25">
                  <Loader2 className="w-2.5 h-2.5 animate-spin" /> Thinking...
                </div>
              )}
            </div>
            <div className="px-3 py-2.5 border-t border-white/[0.06] flex gap-1.5">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleChat()}
                placeholder="Ask a question..."
                className="flex-1 px-2 py-1 bg-white/[0.04] border border-white/[0.08] rounded text-[10px] text-white placeholder:text-white/15 focus:outline-none"
              />
              <button onClick={handleChat} disabled={chatLoading} className="btn-primary text-[9px] py-1 px-2">
                Send
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
