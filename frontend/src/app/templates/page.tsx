"use client";

export const dynamic = 'force-dynamic';

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Rocket, DollarSign, BarChart2, TrendingUp, FlaskConical, LineChart,
  Megaphone, ShoppingCart, Building2, ArrowRight, Search, Zap, Users2,
  Clock, Loader2,
} from "lucide-react";
import { listTemplates } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import type { ApiTemplate } from "@/types";

const categoryIcons: Record<string, typeof Rocket> = {
  startup: Rocket,
  pricing: DollarSign,
  finance: TrendingUp,
  biology: FlaskConical,
  trend: LineChart,
  marketing: Megaphone,
  product: ShoppingCart,
  policy: BarChart2,
  custom: Building2,
};

const difficultyTag: Record<string, string> = {
  beginner: "tag-green",
  intermediate: "tag-yellow",
  advanced: "tag-red",
};

export default function TemplatesPage() {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<ApiTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  useEffect(() => {
    async function load() {
      try {
        const data = await listTemplates();
        setTemplates(Array.isArray(data) ? data : []);
      } catch (err: any) {
        toast({
          title: "failed to load templates",
          description: err.message || "check your connection and try again",
          variant: "error",
        });
      } finally {
        setLoading(false);
      }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const categories = ["all", ...Array.from(new Set(templates.map((t) => t.category)))];

  const filtered = templates.filter((t) => {
    if (categoryFilter !== "all" && t.category !== categoryFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    }
    return true;
  });

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <p className="text-xs text-white/25 mb-1 tracking-wide">sylor / templates</p>
          <h1 className="text-2xl font-bold text-white tracking-tight">simulation templates</h1>
          <p className="text-xs text-white/30 mt-1">
            pre-built simulations to get you started fast
            {!loading && ` — ${templates.length} templates available`}
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

      {/* Templates grid */}
      {loading ? (
        <div className="flex items-center justify-center py-32">
          <Loader2 className="w-6 h-6 animate-spin text-white/20" />
        </div>
      ) : filtered.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-white/[0.05]">
          {filtered.map((template) => (
            <TemplateCard key={template.id} template={template} />
          ))}
        </div>
      ) : (
        <div className="text-center py-16">
          <div className="text-white/20 mb-1 text-sm">
            {templates.length === 0 ? "no templates available" : "no templates match your search"}
          </div>
          <div className="text-[10px] text-white/10">
            {templates.length === 0
              ? "check back later or start from scratch"
              : "try a different keyword or category"}
          </div>
        </div>
      )}
    </div>
  );
}

function TemplateCard({ template }: { template: ApiTemplate }) {
  const Icon = categoryIcons[template.category] || Building2;
  const variableCount = template.config?.variables?.length ?? 0;
  const agentCount = template.config?.agents?.length ?? 0;
  const numRuns = template.config?.num_runs ?? 1000;

  return (
    <Link
      href={`/simulations/new?template=${template.id}`}
      className="bg-[var(--page-bg)] p-5 hover:bg-white/[0.02] transition-colors group block"
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
            <span className="tag text-[9px]">{template.category}</span>
            <span className={`tag text-[9px] ${difficultyTag[template.difficulty] || ""}`}>{template.difficulty}</span>
          </div>
        </div>
        <ArrowRight className="w-3 h-3 text-white/15 group-hover:text-white/40 transition-colors shrink-0 mt-1" />
      </div>
      <p className="text-[10px] text-white/25 leading-relaxed mb-3 line-clamp-2">
        {template.description}
      </p>
      <div className="flex items-center gap-4 text-[10px] text-white/15">
        <span className="flex items-center gap-1">
          <Zap className="w-2.5 h-2.5" /> {variableCount} vars
        </span>
        <span className="flex items-center gap-1">
          <Users2 className="w-2.5 h-2.5" /> {agentCount} agents
        </span>
        <span className="flex items-center gap-1">
          <Clock className="w-2.5 h-2.5" /> {numRuns.toLocaleString()} runs
        </span>
      </div>
    </Link>
  );
}
