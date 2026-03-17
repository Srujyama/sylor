const features = [
  {
    index: "01",
    title: "multi-agent AI system",
    description:
      "Each agent represents a real market participant — customers, competitors, regulators, investors — all reacting dynamically to your decisions.",
  },
  {
    index: "02",
    title: "thousands of scenarios",
    description:
      "Run 100 to 10,000 simulation variants automatically. Get statistically reliable success probabilities with confidence intervals.",
  },
  {
    index: "03",
    title: "decision trees & what-ifs",
    description:
      "Explore every decision path visually. Tweak any variable and rerun instantly to see how small changes compound into big differences.",
  },
  {
    index: "04",
    title: "no-code simulation builder",
    description:
      "Design full market simulations through simple forms. Define agents, rules, and variables without writing a single line of code.",
  },
  {
    index: "05",
    title: "interactive dashboards",
    description:
      "Visualize outcomes with dynamic charts, probability distributions, market growth curves, and competitive dynamics over time.",
  },
  {
    index: "06",
    title: "AI-generated insights",
    description:
      "Claude AI explains why scenarios succeed or fail in plain language, highlighting key risk factors and hidden opportunities.",
  },
  {
    index: "07",
    title: "live rerun engine",
    description:
      "Adjust any input — pricing, budget, timing, market size — and watch results update in real time without waiting.",
  },
  {
    index: "08",
    title: "real-world data calibration",
    description:
      "Ground your simulations in reality with industry benchmarks, market data, and historical patterns for more accurate predictions.",
  },
  {
    index: "09",
    title: "save & compare strategies",
    description:
      "Save multiple simulation configurations and run head-to-head comparisons to find your optimal strategy scientifically.",
  },
];

export function Features() {
  return (
    <section id="features" className="py-24 border-t border-white/[0.05]">
      <div className="max-w-[1440px] mx-auto px-8">
        {/* Section header */}
        <div className="flex items-start justify-between mb-16">
          <div className="max-w-lg">
            <span className="tag mb-4 inline-flex">everything you need</span>
            <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight leading-tight">
              simulation at<br />enterprise scale
            </h2>
          </div>
          <p className="hidden md:block text-sm text-white/35 max-w-xs leading-relaxed pt-10">
            From quick what-ifs to full market simulations, Sylor adapts to every decision you need to validate.
          </p>
        </div>

        {/* Features grid — list style */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/[0.05]">
          {features.map((f) => (
            <div
              key={f.index}
              className="bg-[var(--page-bg)] p-6 hover:bg-white/[0.02] transition-colors group"
            >
              <div className="text-xs text-white/20 mb-4 tracking-widest">{f.index}</div>
              <h3 className="text-sm font-semibold text-white mb-2 group-hover:text-white/90">{f.title}</h3>
              <p className="text-xs text-white/35 leading-relaxed">{f.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
