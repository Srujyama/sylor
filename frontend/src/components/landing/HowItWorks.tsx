const steps = [
  {
    number: "01",
    title: "define your scenario",
    description:
      "Choose a template or start from scratch. Set your market variables — budget, pricing, team size, competition level, and more.",
  },
  {
    number: "02",
    title: "configure AI agents",
    description:
      "Set up your market participants: how many customers, what competitors exist, are regulators involved? Each agent has configurable behavior.",
  },
  {
    number: "03",
    title: "run thousands of simulations",
    description:
      "Hit Run and our AI engine executes hundreds to thousands of scenarios in seconds, exploring the full range of possible futures.",
  },
  {
    number: "04",
    title: "get actionable insights",
    description:
      "Review your success probability, risk factors, and optimal strategy. AI explains results in plain language so you can act with confidence.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="py-24 border-t border-white/[0.05]">
      <div className="max-w-[1440px] mx-auto px-8">
        {/* Header */}
        <div className="mb-16">
          <span className="tag mb-4 inline-flex">simple process</span>
          <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
            from idea to insight<br />in minutes
          </h2>
        </div>

        {/* Steps — horizontal on desktop, vertical on mobile */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-px bg-white/[0.05]">
          {steps.map((step) => (
            <div
              key={step.number}
              className="bg-[#0a0a0a] p-6 hover:bg-white/[0.02] transition-colors"
            >
              <div className="text-xs text-white/20 mb-5 tracking-widest">{step.number}</div>
              <h3 className="text-sm font-semibold text-white mb-3">{step.title}</h3>
              <p className="text-xs text-white/35 leading-relaxed">{step.description}</p>
            </div>
          ))}
        </div>

        {/* Bottom note */}
        <div className="mt-8 flex items-center gap-3">
          <div className="h-px flex-1 bg-white/[0.05]" />
          <span className="text-xs text-white/20">no data science degree required</span>
          <div className="h-px flex-1 bg-white/[0.05]" />
        </div>
      </div>
    </section>
  );
}
