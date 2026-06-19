"use client";

export const dynamic = 'force-dynamic';

import Link from "next/link";
import { Rocket, Bug, Sparkles } from "lucide-react";

const changelog = [
  {
    version: "3.0.0",
    date: "June 16, 2026",
    title: "Pareto Optimizer, Network Effects & LLM Hero Runs",
    type: "feature" as const,
    items: [
      "multi-objective Pareto optimizer — \"find me the best plan\": Latin-hypercube search over your variable ranges, a direction-aware Pareto frontier, and a knee-point \"best balanced\" recommendation",
      "agent network effects / contagion — an influence matrix spreads churn and competitive pressure between agents, producing cascades and tipping points (opt-in, byte-identical when off)",
      "LLM-in-the-loop hero runs — one seeded path where the most-influential agent makes an actual Claude decision at key ticks, with a hard call budget and graceful formula fallback",
      "optimize tab with an objective builder and a Pareto scatter; network-effects card on results when contagion is enabled; hero-run tab with a decision timeline",
    ],
  },
  {
    version: "2.4.0",
    date: "June 2, 2026",
    title: "Cross-Domain Composite Simulations",
    type: "feature" as const,
    items: [
      "composite simulations — chain sub-sims across domains into a DAG where one model's output drives another's inputs (biology binding-rate → business efficacy → finance runway)",
      "genuine per-path uncertainty propagation — upstream path i feeds downstream path i under a shared seed, not mean-passed",
      "new /composites section with a node-and-link builder plus a DAG detail and run page",
      "engine refactored into run_single_path / aggregate_paths with an iterative topo sort — non-breaking, reproduces existing runs exactly",
    ],
  },
  {
    version: "2.2.0",
    date: "May 19, 2026",
    title: "Bayesian Calibration & Causal Graphs",
    type: "feature" as const,
    items: [
      "Bayesian calibration from uploaded data — fit engine variables to your historical CSV via a conjugate-normal posterior; prior→posterior shift, uncertainty, and a 0-100 calibration score (honest framing: moment-matching, not full MCMC)",
      "causal graph + do-operator — promote the knowledge graph's typed edges to a directed DAG and propagate do(node, ±magnitude) effects downstream (directional inference, not point estimates)",
      "upload parser now returns raw numeric series so calibration fits real distributions, not single-point means",
      "calibrate tab with column mapping and a causal-view toggle with an intervention panel on the graph page",
    ],
  },
  {
    version: "2.0.0",
    date: "May 5, 2026",
    title: "Counterfactual Diff, Run Explainer & Lexical Search",
    type: "feature" as const,
    items: [
      "counterfactual diff engine — direct-override paired-seed reruns give per-metric and per-timeline deltas plus risk-factor appeared/disappeared sets with an AI explanation",
      "per-run explainer — find the path nearest a p10 / p50 / p90 percentile, replay it, and narrate why it went that way",
      "narrative dashboard digest — a \"since you were away\" strip with completed runs, stale-sim nudges, and one AI headline",
      "lexical graph search — TF-IDF cosine over all entities replaces the old \"score the first 50\" truncation, with optional LLM re-rank",
      "activation checklist — a dismissible getting-started card with a progress ring",
    ],
  },
  {
    version: "1.6.0",
    date: "April 21, 2026",
    title: "Live Theater, Transcripts, Copilot & Zero-Signup Demo",
    type: "feature" as const,
    items: [
      "live simulation theater — watch agents act tick by tick on a stage with play/pause/scrub, an event ticker, and a live-building outcome chart",
      "agent conversation transcripts — one batched LLM call narrates the replay log in the voice of each persona",
      "zero-signup demo — a public /demo runs a real capped simulation and can be claimed as your first sim after signup",
      "AI copilot — reads your results and run history to suggest typed next experiments with one-click run buttons",
      "PWA and mobile polish, plus a keyboard layer with a ? cheat-sheet modal",
    ],
  },
  {
    version: "1.3.0",
    date: "April 7, 2026",
    title: "Tornado, What-If, Scenario Trees & Decision Memos",
    type: "feature" as const,
    items: [
      "tornado-chart sensitivity analysis with a dedicated sensitivity tab",
      "natural-language what-if — \"what if I raise prices 20%?\" parses into overrides and a paired same-seed rerun with delta cards and an AI verdict",
      "scenario tree — every what-if/branch becomes a node in a git-style tree of futures, with a left-to-right SVG tree page and compare-branches",
      "decision memo generator — a one-click six-section executive memo from a sim's results",
      "shareable results — frozen public snapshots at /s/[shareId]; run history with vs-previous-run delta chips",
      "interactive knowledge-graph visualization, real per-user analytics, command palette v2, and a public stats endpoint",
    ],
  },
  {
    version: "1.0.0",
    date: "March 24, 2026",
    title: "The Pipeline Is Real — Persistence, Personas & Streaming",
    type: "feature" as const,
    items: [
      "the document → knowledge graph → personas → simulation → report pipeline runs end to end via POST /api/projects/:id/run-simulation",
      "agent personas now actually modulate the simulation math — sensitivity, risk tolerance, activity, influence, sentiment bias, and decision style genuinely diverge under a fixed seed",
      "deterministic seeding with reproducible runs and recorded base_seed",
      "confidence diagnostics — Monte Carlo standard error, a convergence check, and a forecast-confidence badge",
      "real SSE streaming — engine progress is streamed during the run with a polling fallback",
    ],
  },
  {
    version: "0.6.0",
    date: "March 17, 2026",
    title: "Security, Persistence & Honest Surfaces",
    type: "fix" as const,
    items: [
      "added authentication and per-user scoping to the projects, graphs, reports, context, and upload routers",
      "projects now persist to Firestore and survive restarts instead of living in memory",
      "rate limiter rekeyed on the verified uid (was spoofable via an unverified token prefix); expensive tier no longer double-counted",
      "removed mock data masquerading as UI — real compare flow, real templates, real CSV parsing in the wizard, and the fake settings API key",
      "FormData uploads no longer break on a bad Content-Type; silent catch blocks now surface toast errors",
      "added GitHub Actions CI running backend pytest on Python 3.12 and the frontend build",
    ],
  },
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
                <div className="absolute left-0 top-1.5 w-[15px] h-[15px] border border-white/15 bg-[var(--page-bg)] flex items-center justify-center">
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
