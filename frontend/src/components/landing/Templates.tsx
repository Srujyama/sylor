import Link from "next/link";
import { ArrowRight } from "lucide-react";

const templates = [
  {
    name: "startup launch",
    category: "startup",
    description: "Model go-to-market strategy. Simulate customer acquisition, burn rate, and market penetration across funding scenarios.",
    agents: ["500 customers", "3 competitors", "12 investors"],
    variables: 8,
    avgSuccess: "67%",
    difficulty: "beginner",
  },
  {
    name: "pricing strategy",
    category: "pricing",
    description: "Find optimal price points. Simulate elasticity, competitor reactions, and revenue impact across multiple price tiers.",
    agents: ["1000 customers", "5 competitors"],
    variables: 6,
    avgSuccess: "82%",
    difficulty: "beginner",
  },
  {
    name: "policy impact",
    category: "policy",
    description: "Test regulatory policies before implementation. Model societal behavior, compliance rates, and economic second-order effects.",
    agents: ["10K citizens", "50 companies", "3 regulators"],
    variables: 15,
    avgSuccess: "54%",
    difficulty: "advanced",
  },
  {
    name: "marketing campaign",
    category: "marketing",
    description: "Optimize campaign spend. Simulate channel effectiveness, word-of-mouth spread, and brand awareness curves.",
    agents: ["2000 customers", "8 competitors"],
    variables: 10,
    avgSuccess: "74%",
    difficulty: "intermediate",
  },
  {
    name: "product launch",
    category: "product",
    description: "Simulate how your product will be adopted. Model virality, churn, feature demand, and competitive response.",
    agents: ["5000 users", "4 competitors", "tech press"],
    variables: 12,
    avgSuccess: "61%",
    difficulty: "intermediate",
  },
  {
    name: "market entry",
    category: "strategy",
    description: "Assess new market opportunities. Simulate incumbents, regulatory barriers, and customer switching costs.",
    agents: ["3000 customers", "10 incumbents", "2 regulators"],
    variables: 14,
    avgSuccess: "43%",
    difficulty: "advanced",
  },
  {
    name: "stock market forecast",
    category: "finance",
    description: "Predict price movements and optimize entry points. Simulate trader behavior, order flow, and macro events across multiple assets.",
    agents: ["24 traders", "4 market makers", "6 data streams"],
    variables: 10,
    avgSuccess: "62%",
    difficulty: "intermediate",
  },
  {
    name: "molecular dynamics",
    category: "biology",
    description: "Model protein folding trends and molecular interactions. Simulate binding affinity, conformational changes, and enzymatic reactions.",
    agents: ["128 molecules", "8 enzymes", "4 substrates"],
    variables: 12,
    avgSuccess: "71%",
    difficulty: "advanced",
  },
  {
    name: "trend analyzer",
    category: "trend",
    description: "Upload any time-series data and detect hidden patterns. Forecast future trends with confidence intervals and seasonality detection.",
    agents: ["6 data streams", "3 pattern detectors"],
    variables: 8,
    avgSuccess: "78%",
    difficulty: "beginner",
  },
];

const difficultyColors: Record<string, string> = {
  beginner: "tag-green",
  intermediate: "tag-yellow",
  advanced: "tag-red",
};

export function Templates() {
  return (
    <section id="templates" className="py-24 border-t border-white/[0.05]">
      <div className="max-w-[1440px] mx-auto px-8">
        {/* Header */}
        <div className="flex items-end justify-between mb-12">
          <div>
            <span className="tag mb-4 inline-flex">ready to use</span>
            <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
              start with a template
            </h2>
          </div>
          <Link
            href="/signup"
            className="hidden md:inline-flex items-center gap-1.5 text-xs text-white/35 hover:text-white/70 transition-colors"
          >
            browse all <ArrowRight className="w-3 h-3" />
          </Link>
        </div>

        {/* Template grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-white/[0.05]">
          {templates.map((t) => (
            <Link
              key={t.name}
              href="/signup"
              className="bg-[#0a0a0a] p-5 hover:bg-white/[0.02] transition-colors group block"
            >
              <div className="flex items-start justify-between mb-3">
                <span className="tag">{t.category}</span>
                <span className={`tag ${difficultyColors[t.difficulty]}`}>{t.difficulty}</span>
              </div>

              <h3 className="text-sm font-semibold text-white mb-2 group-hover:text-white/90">{t.name}</h3>
              <p className="text-xs text-white/35 leading-relaxed mb-4">{t.description}</p>

              {/* Agents */}
              <div className="flex flex-wrap gap-1 mb-4">
                {t.agents.map((a) => (
                  <span key={a} className="tag text-[10px]">{a}</span>
                ))}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between text-xs border-t border-white/[0.06] pt-3 mt-auto">
                <span className="text-white/25">{t.variables} variables</span>
                <span className="text-emerald-400">{t.avgSuccess} avg success</span>
              </div>
            </Link>
          ))}
        </div>

        {/* Mobile CTA */}
        <div className="mt-6 md:hidden">
          <Link href="/signup" className="btn-ghost w-full justify-center">
            browse all templates
          </Link>
        </div>
      </div>
    </section>
  );
}
