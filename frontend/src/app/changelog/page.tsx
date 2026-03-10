"use client";

export const dynamic = 'force-dynamic';

import Link from "next/link";
import { ArrowLeft, Rocket, Zap, Bug, Sparkles, BarChart3 } from "lucide-react";

const changelog = [
  {
    version: "0.5.0",
    date: "March 9, 2026",
    title: "AI-Powered Simulation Setup & Multi-Domain Support",
    type: "feature" as const,
    items: [
      "5-step AI-powered simulation creator — describe your scenario, let AI generate variables and agents",
      "Multi-domain support: startup, finance, biology, trend analysis, and more",
      "Context-aware forms for business, finance, molecular, and time-series simulations",
      "Real-time AI analysis using Claude to auto-configure simulation parameters",
      "Domain-specific risk factors, insights, and success/failure explanations",
      "Bootstrap confidence intervals replacing arbitrary estimates",
      "Dynamic quantile-based outcome distributions",
    ],
  },
  {
    version: "0.4.0",
    date: "March 8, 2026",
    title: "Dashboard Overhaul & Polish",
    type: "improvement" as const,
    items: [
      "Rewritten dashboard with real-time data from backend API",
      "Simulations list with search, filter, duplicate, and delete",
      "Toast notification system for simulation events",
      "Tooltip help icons on non-obvious form fields",
      "Styled Radix Select replacing all raw HTML selects",
      "SliderWithInput composite component with two-way sync",
      "Step progress indicators in the simulation wizard",
      "Loading skeletons and empty states throughout",
    ],
  },
  {
    version: "0.3.0",
    date: "March 7, 2026",
    title: "Brutalist Design System",
    type: "improvement" as const,
    items: [
      "Complete design system overhaul — monospace typography, 0-radius corners, monochrome palette",
      "New surface, tag, dot, and progress-bar utility classes",
      "Grid-lines and dot-grid backgrounds",
      "Redesigned sidebar navigation with minimal aesthetics",
      "Consistent brutalist styling across all pages",
    ],
  },
  {
    version: "0.2.0",
    date: "March 6, 2026",
    title: "Monte Carlo Engine & Results",
    type: "feature" as const,
    items: [
      "FastAPI backend with async Monte Carlo simulation engine",
      "Multi-agent architecture: customers, competitors, investors, traders, molecules",
      "Real-time simulation polling with auto-updating results",
      "Results page with timeline charts, outcome distributions, risk factors",
      "What-If analysis with variable overrides and instant rerun",
      "AI insights powered by Claude for post-simulation analysis",
      "Scenario comparison with radar charts",
    ],
  },
  {
    version: "0.1.0",
    date: "March 5, 2026",
    title: "Initial Release",
    type: "feature" as const,
    items: [
      "Next.js 14 frontend with App Router",
      "Firebase authentication (email/password + Google OAuth)",
      "Landing page with features, pricing, and domain showcase",
      "Basic simulation creator with variable configuration",
      "Dashboard with simulation list and quick start",
      "FastAPI backend deployed on Fly.io",
    ],
  },
];

const typeConfig = {
  feature: { icon: Rocket, label: "new feature", tagClass: "tag-green" },
  improvement: { icon: Sparkles, label: "improvement", tagClass: "tag-blue" },
  fix: { icon: Bug, label: "bug fix", tagClass: "tag-yellow" },
};

export default function ChangelogPage() {
  return (
    <div className="min-h-screen">
      {/* Simple header */}
      <div className="border-b border-white/[0.06] px-8 py-4">
        <div className="max-w-3xl mx-auto flex items-center gap-4">
          <Link
            href="/"
            className="flex items-center gap-2.5"
          >
            <div className="w-5 h-5 bg-white flex items-center justify-center shrink-0">
              <span className="text-[8px] font-black text-black tracking-widest">SY</span>
            </div>
            <span className="text-sm font-semibold text-white tracking-tight">sylor</span>
          </Link>
          <span className="text-white/15">·</span>
          <span className="text-xs text-white/30">changelog</span>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-8 py-12">
        <div className="mb-12">
          <h1 className="text-3xl font-bold text-white tracking-tight mb-2">changelog</h1>
          <p className="text-sm text-white/30">what&apos;s new in sylor — all product updates in one place</p>
        </div>

        <div className="space-y-0">
          {changelog.map((entry, i) => {
            const config = typeConfig[entry.type];
            return (
              <div key={entry.version} className="relative pl-8 pb-12 last:pb-0">
                {/* Timeline line */}
                {i < changelog.length - 1 && (
                  <div className="absolute left-[7px] top-3 bottom-0 w-px bg-white/[0.06]" />
                )}
                {/* Timeline dot */}
                <div className="absolute left-0 top-1.5 w-[15px] h-[15px] border border-white/15 bg-[#0a0a0a] flex items-center justify-center">
                  <div className={`w-[5px] h-[5px] ${i === 0 ? "bg-white" : "bg-white/30"}`} />
                </div>

                {/* Content */}
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-xs font-bold text-white tracking-tight">v{entry.version}</span>
                    <span className={`tag text-[9px] ${config.tagClass}`}>
                      <config.icon className="w-2.5 h-2.5" /> {config.label}
                    </span>
                    <span className="text-[10px] text-white/20">{entry.date}</span>
                  </div>

                  <h2 className="text-sm font-semibold text-white/80 mb-3">{entry.title}</h2>

                  <ul className="space-y-1.5">
                    {entry.items.map((item, j) => (
                      <li key={j} className="flex items-start gap-2 text-[11px] text-white/30 leading-relaxed">
                        <div className="w-1 h-1 bg-white/15 shrink-0 mt-1.5" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
