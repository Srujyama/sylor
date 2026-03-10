"use client";

export const dynamic = 'force-dynamic';

import { useState } from "react";
import Link from "next/link";
import {
  BookOpen, Rocket, Code2, BarChart3, FlaskConical, TrendingUp, Zap,
  ChevronRight, ExternalLink, Search, Layers, Upload, Users2, Settings, Key,
} from "lucide-react";

type DocSection = "getting-started" | "simulations" | "domains" | "api" | "data" | "agents";

const sections: { id: DocSection; label: string; icon: typeof BookOpen }[] = [
  { id: "getting-started", label: "getting started", icon: Rocket },
  { id: "simulations", label: "simulations", icon: Layers },
  { id: "domains", label: "domains & categories", icon: BarChart3 },
  { id: "agents", label: "agents & models", icon: Users2 },
  { id: "data", label: "data upload", icon: Upload },
  { id: "api", label: "API reference", icon: Code2 },
];

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState<DocSection>("getting-started");
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <div className="p-8 max-w-5xl">
      {/* Header */}
      <div className="mb-8">
        <p className="text-xs text-white/25 mb-1 tracking-wide">sylor / docs</p>
        <h1 className="text-2xl font-bold text-white tracking-tight">documentation</h1>
        <p className="text-xs text-white/30 mt-1">learn how to build and run powerful simulations</p>
      </div>

      {/* Search */}
      <div className="relative mb-8 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/20" />
        <input
          type="text"
          placeholder="search docs..."
          className="w-full bg-transparent border border-white/[0.06] text-xs text-white/60 pl-9 pr-3 py-2.5 focus:outline-none focus:border-white/15 placeholder:text-white/15"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="flex gap-8">
        {/* Sidebar nav */}
        <div className="w-48 shrink-0">
          <nav className="space-y-0.5 sticky top-8">
            {sections.map((section) => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium transition-colors text-left ${
                  activeSection === section.id
                    ? "bg-white/[0.06] text-white"
                    : "text-white/35 hover:text-white/70 hover:bg-white/[0.03]"
                }`}
              >
                <section.icon className={`w-3.5 h-3.5 shrink-0 ${activeSection === section.id ? "text-white" : "text-white/30"}`} />
                {section.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Getting Started */}
          {activeSection === "getting-started" && (
            <div className="animate-fade-in space-y-8">
              <div>
                <h2 className="text-lg font-semibold text-white mb-2">getting started</h2>
                <p className="text-xs text-white/40 leading-relaxed">
                  Sylor lets you simulate complex decisions using AI-powered Monte Carlo analysis.
                  Whether you are launching a startup, managing a portfolio, or studying molecular dynamics,
                  Sylor can model thousands of scenarios in seconds.
                </p>
              </div>

              <div className="surface p-5">
                <h3 className="text-xs font-semibold text-white/60 tracking-widest uppercase mb-4">quick start guide</h3>
                <div className="space-y-4">
                  {[
                    { step: "01", title: "Choose a domain", desc: "Pick from startup, finance, biology, trend analysis, or create a custom simulation." },
                    { step: "02", title: "Describe your scenario", desc: "Fill in your company details, investment parameters, or research context. The more detail, the better." },
                    { step: "03", title: "AI analyzes your input", desc: "Our AI engine reads your context and auto-generates variables, agents, and assumptions tailored to your scenario." },
                    { step: "04", title: "Review and customize", desc: "Adjust any variables, add or remove agents, tweak sensitivity values, and set run count." },
                    { step: "05", title: "Launch simulation", desc: "Run thousands of Monte Carlo iterations. Results appear in real-time with confidence intervals." },
                  ].map((item) => (
                    <div key={item.step} className="flex items-start gap-4 py-3 border-b border-white/[0.04] last:border-0">
                      <div className="text-xs font-bold text-white/15 w-6 shrink-0 pt-0.5">{item.step}</div>
                      <div>
                        <div className="text-xs font-medium text-white/80 mb-0.5">{item.title}</div>
                        <div className="text-[11px] text-white/30 leading-relaxed">{item.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="surface p-5">
                <h3 className="text-xs font-semibold text-white/60 tracking-widest uppercase mb-3">key concepts</h3>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { title: "Monte Carlo Simulation", desc: "A technique that runs thousands of randomized scenarios to estimate probability distributions of outcomes." },
                    { title: "Agents", desc: "Autonomous entities (customers, competitors, molecules) that interact in the simulation following behavior rules." },
                    { title: "Variables", desc: "Adjustable parameters that control the simulation — prices, budgets, binding affinities, market conditions." },
                    { title: "Confidence Interval", desc: "A range showing where the true value likely falls, calculated using bootstrap resampling from simulation runs." },
                  ].map((item) => (
                    <div key={item.title} className="p-3 bg-white/[0.02] border border-white/[0.04]">
                      <div className="text-xs font-medium text-white/70 mb-1">{item.title}</div>
                      <div className="text-[10px] text-white/25 leading-relaxed">{item.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Simulations */}
          {activeSection === "simulations" && (
            <div className="animate-fade-in space-y-8">
              <div>
                <h2 className="text-lg font-semibold text-white mb-2">simulations</h2>
                <p className="text-xs text-white/40 leading-relaxed">
                  A simulation models your scenario through thousands of randomized iterations.
                  Each run uses your variables and agents to produce a different outcome.
                </p>
              </div>

              <DocBlock title="simulation lifecycle">
                <div className="flex items-center gap-2 text-xs">
                  {["draft", "running", "completed", "failed"].map((status, i) => (
                    <span key={status} className="flex items-center gap-2">
                      {i > 0 && <ChevronRight className="w-3 h-3 text-white/15" />}
                      <span className={`tag ${
                        status === "completed" ? "tag-green" : status === "running" ? "tag-blue" : status === "failed" ? "tag-red" : "tag-yellow"
                      }`}>{status}</span>
                    </span>
                  ))}
                </div>
                <div className="mt-4 space-y-2 text-[11px] text-white/30 leading-relaxed">
                  <p><strong className="text-white/50">Draft</strong> — Simulation created but not yet run.</p>
                  <p><strong className="text-white/50">Running</strong> — Monte Carlo iterations are executing. Progress is polled every 2 seconds.</p>
                  <p><strong className="text-white/50">Completed</strong> — All iterations finished. Results include success probability, risk factors, and AI insights.</p>
                  <p><strong className="text-white/50">Failed</strong> — An error occurred during execution. Check the error message and retry.</p>
                </div>
              </DocBlock>

              <DocBlock title="what-if analysis">
                <p className="text-[11px] text-white/30 leading-relaxed">
                  After a simulation completes, use the What-If tab to adjust any variable and re-run with overrides.
                  This lets you test scenarios like &quot;what if we increase the price by 20%?&quot; or &quot;what if we double the marketing budget?&quot;
                  without creating a new simulation from scratch.
                </p>
              </DocBlock>

              <DocBlock title="interpreting results">
                <div className="space-y-3 text-[11px] text-white/30 leading-relaxed">
                  <p><strong className="text-white/50">Success Probability</strong> — Percentage of runs that met the success criteria (e.g., profit &gt; 0, binding affinity &lt; threshold).</p>
                  <p><strong className="text-white/50">Confidence Interval</strong> — 95% bootstrap CI around the success probability. Tighter intervals = more reliable estimates.</p>
                  <p><strong className="text-white/50">Outcome Distribution</strong> — Histogram showing how final outcomes are distributed across all runs.</p>
                  <p><strong className="text-white/50">Risk Factors</strong> — AI-identified risks from low/medium/high/critical with mitigation suggestions.</p>
                  <p><strong className="text-white/50">Timeline</strong> — Aggregated trajectory showing p10/p50/p90 bands over time.</p>
                </div>
              </DocBlock>
            </div>
          )}

          {/* Domains */}
          {activeSection === "domains" && (
            <div className="animate-fade-in space-y-8">
              <div>
                <h2 className="text-lg font-semibold text-white mb-2">domains & categories</h2>
                <p className="text-xs text-white/40 leading-relaxed">
                  Sylor supports multiple simulation domains, each with specialized variables, agents, and metrics.
                </p>
              </div>

              <div className="space-y-3">
                {[
                  { icon: Rocket, name: "Startup Launch", desc: "Model startup growth, runway, market capture, and competitive dynamics. Variables include MRR, burn rate, customer acquisition cost.", domains: "startup, pricing, marketing, product, policy" },
                  { icon: TrendingUp, name: "Financial Markets", desc: "Simulate portfolio returns, risk profiles, and market scenarios. Supports stocks, crypto, forex, and mixed portfolios.", domains: "finance" },
                  { icon: FlaskConical, name: "Molecular / Bio", desc: "Model binding affinities, protein folding dynamics, enzyme kinetics. Variables include temperature, pH, concentration.", domains: "biology" },
                  { icon: BarChart3, name: "Trend Analysis", desc: "Forecast time-series data using statistical models. Upload your own data or use built-in generators.", domains: "trend" },
                ].map((domain) => (
                  <div key={domain.name} className="surface p-5">
                    <div className="flex items-start gap-3">
                      <domain.icon className="w-4 h-4 text-white/30 mt-0.5 shrink-0" />
                      <div>
                        <div className="text-xs font-semibold text-white mb-1">{domain.name}</div>
                        <div className="text-[11px] text-white/30 leading-relaxed mb-2">{domain.desc}</div>
                        <div className="flex items-center gap-1.5">
                          {domain.domains.split(", ").map((d) => (
                            <span key={d} className="tag text-[9px]">{d}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Agents */}
          {activeSection === "agents" && (
            <div className="animate-fade-in space-y-8">
              <div>
                <h2 className="text-lg font-semibold text-white mb-2">agents & models</h2>
                <p className="text-xs text-white/40 leading-relaxed">
                  Agents are autonomous entities that interact within your simulation. Each agent type has different
                  behavior rules and sensitivity parameters.
                </p>
              </div>

              <DocBlock title="agent types">
                <div className="space-y-3">
                  {[
                    { type: "customer", desc: "Models user acquisition, churn, and behavior. Sensitivity controls how reactive they are to price changes." },
                    { type: "competitor", desc: "Models competitive responses — price matching, feature parity, market entry." },
                    { type: "investor", desc: "Models funding decisions based on traction metrics and market conditions." },
                    { type: "market", desc: "Models overall market dynamics — growth rates, demand shifts, macro trends." },
                    { type: "trader", desc: "Models buy/sell decisions in financial simulations. Uses risk/reward heuristics." },
                    { type: "molecule", desc: "Models molecular interactions in biology simulations. Binding affinity, conformational changes." },
                    { type: "data_stream", desc: "Models incoming data points in trend analysis. Pattern detection and anomaly injection." },
                  ].map((agent) => (
                    <div key={agent.type} className="flex items-start gap-3 py-2 border-b border-white/[0.04] last:border-0">
                      <span className="tag text-[9px] w-24 justify-center shrink-0">{agent.type}</span>
                      <div className="text-[11px] text-white/30 leading-relaxed">{agent.desc}</div>
                    </div>
                  ))}
                </div>
              </DocBlock>

              <DocBlock title="sensitivity parameter">
                <p className="text-[11px] text-white/30 leading-relaxed">
                  Each agent has a sensitivity value from 0.0 to 1.0. Higher sensitivity means the agent reacts
                  more strongly to changes in its environment. For example, a highly sensitive customer agent will
                  churn more easily when prices increase, while a low-sensitivity one will be more loyal.
                </p>
              </DocBlock>
            </div>
          )}

          {/* Data Upload */}
          {activeSection === "data" && (
            <div className="animate-fade-in space-y-8">
              <div>
                <h2 className="text-lg font-semibold text-white mb-2">data upload</h2>
                <p className="text-xs text-white/40 leading-relaxed">
                  Upload your own datasets to power simulations with real-world data.
                </p>
              </div>

              <DocBlock title="supported formats">
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { format: "CSV", ext: ".csv", desc: "Comma-separated values" },
                    { format: "Excel", ext: ".xlsx", desc: "Microsoft Excel workbook" },
                    { format: "Excel (legacy)", ext: ".xls", desc: "Excel 97-2003 format" },
                  ].map((f) => (
                    <div key={f.format} className="p-3 bg-white/[0.02] border border-white/[0.04]">
                      <div className="text-xs font-medium text-white/70 mb-0.5">{f.format}</div>
                      <div className="text-[10px] text-white/25">{f.ext}</div>
                    </div>
                  ))}
                </div>
              </DocBlock>

              <DocBlock title="data requirements">
                <div className="space-y-2 text-[11px] text-white/30 leading-relaxed">
                  <p>• First row should contain column headers</p>
                  <p>• At least one numeric column is required for simulation</p>
                  <p>• Date columns are auto-detected for time-series analysis</p>
                  <p>• Maximum file size: 10 MB (free), 100 MB (pro)</p>
                  <p>• Missing values are handled automatically using interpolation</p>
                </div>
              </DocBlock>
            </div>
          )}

          {/* API Reference */}
          {activeSection === "api" && (
            <div className="animate-fade-in space-y-8">
              <div>
                <h2 className="text-lg font-semibold text-white mb-2">API reference</h2>
                <p className="text-xs text-white/40 leading-relaxed">
                  Access Sylor programmatically. All endpoints require an API key in the Authorization header.
                </p>
              </div>

              <div className="surface p-4 text-xs font-mono text-white/40 bg-white/[0.01]">
                <span className="text-white/20">Authorization:</span> Bearer sk-sylor-your-api-key
              </div>

              {[
                { method: "POST", path: "/api/simulations", desc: "Create a new simulation" },
                { method: "GET", path: "/api/simulations", desc: "List all simulations (requires user_id query param)" },
                { method: "GET", path: "/api/simulations/:id", desc: "Get simulation details" },
                { method: "POST", path: "/api/simulations/:id/run", desc: "Run/rerun a simulation" },
                { method: "GET", path: "/api/simulations/:id/results", desc: "Get simulation results" },
                { method: "POST", path: "/api/simulations/:id/duplicate", desc: "Duplicate a simulation" },
                { method: "DELETE", path: "/api/simulations/:id", desc: "Delete a simulation" },
                { method: "POST", path: "/api/context/analyze", desc: "AI-analyze context to generate variables and agents" },
              ].map((endpoint) => (
                <div key={endpoint.path + endpoint.method} className="surface p-4 flex items-center gap-3">
                  <span className={`tag text-[9px] w-14 justify-center shrink-0 ${
                    endpoint.method === "GET" ? "tag-green" : endpoint.method === "POST" ? "tag-blue" : "tag-red"
                  }`}>{endpoint.method}</span>
                  <code className="text-xs font-mono text-white/50 flex-1">{endpoint.path}</code>
                  <span className="text-[10px] text-white/25">{endpoint.desc}</span>
                </div>
              ))}

              <DocBlock title="example: create and run a simulation">
                <pre className="text-[10px] font-mono text-white/35 leading-relaxed overflow-x-auto">
{`curl -X POST https://api.sylor.io/api/simulations \\
  -H "Authorization: Bearer sk-sylor-..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "user_id": "your-uid",
    "config": {
      "name": "Q2 Launch Test",
      "category": "startup",
      "variables": [...],
      "agents": [...],
      "num_runs": 1000,
      "time_horizon": 12
    }
  }'`}
                </pre>
              </DocBlock>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Reusable doc block
function DocBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="surface p-5">
      <h3 className="text-xs font-semibold text-white/60 tracking-widest uppercase mb-4">{title}</h3>
      {children}
    </div>
  );
}
