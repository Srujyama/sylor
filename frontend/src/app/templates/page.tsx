"use client";

export const dynamic = 'force-dynamic';

import { useState } from "react";
import Link from "next/link";
import {
  Rocket, DollarSign, BarChart2, TrendingUp, FlaskConical, LineChart,
  Megaphone, ShoppingCart, Building2, ArrowRight, Search, Zap, Users2,
  Clock, Star,
} from "lucide-react";

const templates = [
  {
    id: "saas-launch",
    name: "SaaS Startup Launch",
    category: "startup",
    icon: Rocket,
    difficulty: "beginner",
    description: "Model a SaaS startup's first 12 months — customer acquisition, revenue growth, runway analysis, and competitive dynamics.",
    variables: 8,
    agents: 4,
    defaultRuns: 1000,
    tags: ["startup", "saas", "revenue", "growth"],
    popular: true,
  },
  {
    id: "pricing-experiment",
    name: "Pricing Strategy A/B Test",
    category: "pricing",
    icon: DollarSign,
    difficulty: "intermediate",
    description: "Compare pricing strategies with simulated customer behavior, churn rates, and revenue impact across different price points.",
    variables: 6,
    agents: 3,
    defaultRuns: 2000,
    tags: ["pricing", "ab-test", "revenue"],
    popular: true,
  },
  {
    id: "stock-portfolio",
    name: "Stock Portfolio Simulation",
    category: "finance",
    icon: TrendingUp,
    difficulty: "intermediate",
    description: "Simulate portfolio returns under different market conditions — bull, bear, sideways. Model risk, drawdown, and Sharpe ratio.",
    variables: 10,
    agents: 5,
    defaultRuns: 5000,
    tags: ["finance", "portfolio", "risk"],
    popular: true,
  },
  {
    id: "crypto-portfolio",
    name: "Crypto Portfolio Risk Analysis",
    category: "finance",
    icon: TrendingUp,
    difficulty: "advanced",
    description: "Model crypto portfolio volatility with correlation analysis, drawdown risk, and scenario testing for major market events.",
    variables: 12,
    agents: 4,
    defaultRuns: 3000,
    tags: ["crypto", "risk", "volatility"],
    popular: false,
  },
  {
    id: "drug-binding",
    name: "Drug Binding Simulation",
    category: "biology",
    icon: FlaskConical,
    difficulty: "advanced",
    description: "Simulate drug-protein binding dynamics — binding affinity, temperature sensitivity, pH effects, and off-target interactions.",
    variables: 9,
    agents: 3,
    defaultRuns: 2000,
    tags: ["biology", "pharma", "binding"],
    popular: false,
  },
  {
    id: "enzyme-kinetics",
    name: "Enzyme Kinetics Model",
    category: "biology",
    icon: FlaskConical,
    difficulty: "intermediate",
    description: "Model enzyme reaction rates, substrate concentration effects, and inhibitor dynamics using Michaelis-Menten kinetics.",
    variables: 7,
    agents: 2,
    defaultRuns: 1500,
    tags: ["biology", "enzyme", "kinetics"],
    popular: false,
  },
  {
    id: "sales-forecast",
    name: "Sales Revenue Forecast",
    category: "trend",
    icon: LineChart,
    difficulty: "beginner",
    description: "Forecast sales revenue using historical patterns, seasonal trends, and growth rate projections with confidence bands.",
    variables: 5,
    agents: 2,
    defaultRuns: 1000,
    tags: ["forecast", "sales", "trend"],
    popular: true,
  },
  {
    id: "traffic-forecast",
    name: "Web Traffic Predictor",
    category: "trend",
    icon: LineChart,
    difficulty: "beginner",
    description: "Predict website traffic patterns considering seasonality, marketing campaigns, and organic growth trajectories.",
    variables: 6,
    agents: 2,
    defaultRuns: 1000,
    tags: ["traffic", "web", "seo"],
    popular: false,
  },
  {
    id: "marketing-mix",
    name: "Marketing Channel Mix",
    category: "marketing",
    icon: Megaphone,
    difficulty: "intermediate",
    description: "Optimize marketing budget allocation across channels — paid ads, organic, referral, content. Model CAC and LTV per channel.",
    variables: 8,
    agents: 4,
    defaultRuns: 2000,
    tags: ["marketing", "cac", "channels"],
    popular: false,
  },
  {
    id: "product-launch",
    name: "Product Feature Rollout",
    category: "product",
    icon: ShoppingCart,
    difficulty: "intermediate",
    description: "Model the impact of a new product feature on adoption, retention, and upsell rates across user segments.",
    variables: 7,
    agents: 3,
    defaultRuns: 1500,
    tags: ["product", "feature", "adoption"],
    popular: false,
  },
  {
    id: "market-entry",
    name: "New Market Entry",
    category: "startup",
    icon: Building2,
    difficulty: "advanced",
    description: "Simulate entry into a new geographic or vertical market — regulatory costs, competition intensity, customer acquisition in unfamiliar territory.",
    variables: 11,
    agents: 5,
    defaultRuns: 3000,
    tags: ["market-entry", "expansion", "competition"],
    popular: false,
  },
  {
    id: "policy-impact",
    name: "Policy Impact Assessment",
    category: "policy",
    icon: BarChart2,
    difficulty: "advanced",
    description: "Model the downstream effects of policy changes — carbon tax impact, regulatory compliance costs, industry-wide behavioral shifts.",
    variables: 9,
    agents: 6,
    defaultRuns: 5000,
    tags: ["policy", "regulation", "impact"],
    popular: false,
  },
];

const categoryLabels: Record<string, string> = {
  startup: "startup", pricing: "pricing", finance: "finance", biology: "biology",
  trend: "trend", marketing: "marketing", product: "product", policy: "policy",
};

const difficultyTag: Record<string, string> = {
  beginner: "tag-green",
  intermediate: "tag-yellow",
  advanced: "tag-red",
};

export default function TemplatesPage() {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const categories = ["all", ...Array.from(new Set(templates.map((t) => t.category)))];

  const filtered = templates.filter((t) => {
    if (categoryFilter !== "all" && t.category !== categoryFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.includes(q))
      );
    }
    return true;
  });

  const popular = filtered.filter((t) => t.popular);
  const rest = filtered.filter((t) => !t.popular);

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <p className="text-xs text-white/25 mb-1 tracking-wide">sylor / templates</p>
          <h1 className="text-2xl font-bold text-white tracking-tight">simulation templates</h1>
          <p className="text-xs text-white/30 mt-1">
            pre-built simulations to get you started fast — {templates.length} templates available
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-8">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-white/20" />
          <input
            type="text"
            placeholder="search templates..."
            className="w-full bg-transparent border border-white/[0.06] text-xs text-white/60 pl-7 pr-3 py-2 focus:outline-none focus:border-white/15 placeholder:text-white/15"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategoryFilter(c)}
              className={`text-[10px] px-2.5 py-1.5 border transition-colors ${
                categoryFilter === c
                  ? "border-white/20 text-white/60 bg-white/[0.05]"
                  : "border-transparent text-white/20 hover:text-white/40"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Popular templates */}
      {popular.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <Star className="w-3 h-3 text-white/20" />
            <span className="text-xs text-white/25 tracking-widest uppercase">popular templates</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-white/[0.05]">
            {popular.map((template) => (
              <TemplateCard key={template.id} template={template} featured />
            ))}
          </div>
        </div>
      )}

      {/* All templates */}
      {rest.length > 0 && (
        <div>
          <div className="text-xs text-white/25 tracking-widest uppercase mb-4">
            {popular.length > 0 ? "all templates" : `${filtered.length} templates`}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-white/[0.05]">
            {rest.map((template) => (
              <TemplateCard key={template.id} template={template} />
            ))}
          </div>
        </div>
      )}

      {filtered.length === 0 && (
        <div className="text-center py-16">
          <div className="text-white/20 mb-1 text-sm">no templates match your search</div>
          <div className="text-[10px] text-white/10">try a different keyword or category</div>
        </div>
      )}
    </div>
  );
}

function TemplateCard({
  template,
  featured,
}: {
  template: typeof templates[0];
  featured?: boolean;
}) {
  const Icon = template.icon;

  return (
    <Link
      href={`/simulations/new?template=${template.category}`}
      className="bg-[#0a0a0a] p-5 hover:bg-white/[0.02] transition-colors group block"
    >
      <div className="flex items-start gap-3 mb-3">
        <Icon className="w-4 h-4 text-white/25 mt-0.5 shrink-0 group-hover:text-white/50 transition-colors" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-xs font-semibold text-white/80 group-hover:text-white transition-colors truncate">
              {template.name}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="tag text-[9px]">{categoryLabels[template.category]}</span>
            <span className={`tag text-[9px] ${difficultyTag[template.difficulty]}`}>{template.difficulty}</span>
          </div>
        </div>
        <ArrowRight className="w-3 h-3 text-white/15 group-hover:text-white/40 transition-colors shrink-0 mt-1" />
      </div>
      <p className="text-[10px] text-white/25 leading-relaxed mb-3 line-clamp-2">
        {template.description}
      </p>
      <div className="flex items-center gap-4 text-[10px] text-white/15">
        <span className="flex items-center gap-1">
          <Zap className="w-2.5 h-2.5" /> {template.variables} vars
        </span>
        <span className="flex items-center gap-1">
          <Users2 className="w-2.5 h-2.5" /> {template.agents} agents
        </span>
        <span className="flex items-center gap-1">
          <Clock className="w-2.5 h-2.5" /> {template.defaultRuns.toLocaleString()} runs
        </span>
      </div>
    </Link>
  );
}
