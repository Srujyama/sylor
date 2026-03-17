import { TrendingUp, FlaskConical, BarChart3, Briefcase, LineChart, Dna } from "lucide-react";

const domains = [
  {
    title: "business & strategy",
    description:
      "Model startup launches, pricing experiments, market entries, and policy impacts. Simulate customers, competitors, and regulators reacting to your decisions in real time.",
    features: ["go-to-market modeling", "pricing optimization", "competitive dynamics", "policy impact analysis"],
    icon: Briefcase,
    agents: "customers · competitors · investors · regulators",
  },
  {
    title: "financial markets",
    description:
      "Forecast stock trends, optimize portfolios, and model risk scenarios. AI traders and market makers simulate realistic order flow, volatility regimes, and macro shocks.",
    features: ["stock price forecasting", "portfolio optimization", "risk modeling", "volatility analysis"],
    icon: TrendingUp,
    agents: "traders · market makers · data streams",
  },
  {
    title: "molecular & biology",
    description:
      "Simulate molecular interactions, protein folding trends, and drug binding dynamics. Model enzymes, substrates, and conformational changes at scale — inspired by AlphaFold.",
    features: ["binding affinity prediction", "molecular dynamics", "drug interaction modeling", "conformational analysis"],
    icon: FlaskConical,
    agents: "molecules · enzymes · substrates",
  },
];

export function Domains() {
  return (
    <section id="domains" className="py-24 border-t border-white/[0.05]">
      <div className="max-w-[1440px] mx-auto px-8">
        {/* Header */}
        <div className="mb-12">
          <span className="tag mb-4 inline-flex">multi-domain simulation</span>
          <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight mb-4">
            one platform, every domain
          </h2>
          <p className="text-sm text-white/35 max-w-lg leading-relaxed">
            From boardroom strategy to molecular labs to trading floors — simulate any system
            with domain-specific AI agents and variables.
          </p>
        </div>

        {/* Domain cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/[0.05]">
          {domains.map((d) => (
            <div
              key={d.title}
              className="bg-[var(--page-bg)] p-6 hover:bg-white/[0.02] transition-colors group"
            >
              <div className="flex items-center gap-3 mb-5">
                <div className="w-8 h-8 surface-raised flex items-center justify-center shrink-0">
                  <d.icon className="w-4 h-4 text-white/50" />
                </div>
                <h3 className="text-sm font-semibold text-white group-hover:text-white/90">
                  {d.title}
                </h3>
              </div>

              <p className="text-xs text-white/35 leading-relaxed mb-5">
                {d.description}
              </p>

              {/* Features list */}
              <div className="space-y-1.5 mb-5">
                {d.features.map((f) => (
                  <div key={f} className="flex items-center gap-2 text-xs text-white/45">
                    <div className="w-1 h-1 bg-white/20 shrink-0" />
                    <span>{f}</span>
                  </div>
                ))}
              </div>

              {/* Agent types */}
              <div className="border-t border-white/[0.06] pt-3">
                <div className="text-[10px] text-white/20 tracking-widest uppercase mb-1">agents</div>
                <div className="text-xs text-white/40">{d.agents}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Bottom stat bar */}
        <div className="grid grid-cols-3 gap-px bg-white/[0.05] mt-px">
          {[
            { label: "simulation categories", value: "9" },
            { label: "agent types", value: "10+" },
            { label: "configurable variables", value: "50+" },
          ].map((s) => (
            <div key={s.label} className="bg-[var(--page-bg)] p-4 text-center">
              <div className="text-lg font-bold text-white tracking-tight">{s.value}</div>
              <div className="text-[10px] text-white/25 tracking-wide">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
