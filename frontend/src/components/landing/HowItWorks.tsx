"use client";

import { Badge } from "@/components/ui/badge";
import { ClipboardList, Cpu, ChartLine, Lightbulb } from "lucide-react";

const steps = [
  {
    number: "01",
    icon: ClipboardList,
    title: "Define Your Scenario",
    description:
      "Choose a template or start from scratch. Set your market variables — budget, pricing, team size, competition level, and more through intuitive sliders and forms.",
    color: "violet",
  },
  {
    number: "02",
    icon: Cpu,
    title: "Configure AI Agents",
    description:
      "Set up your market participants: how many customers, what competitors exist, are regulators involved? Each agent has configurable behavior and sensitivity.",
    color: "cyan",
  },
  {
    number: "03",
    icon: ChartLine,
    title: "Run Thousands of Simulations",
    description:
      "Hit Run and our AI engine executes hundreds to thousands of scenarios in seconds, exploring the full range of possible futures for your decision.",
    color: "green",
  },
  {
    number: "04",
    icon: Lightbulb,
    title: "Get Actionable Insights",
    description:
      "Review your success probability, risk factors, and optimal strategy. AI explains results in plain English so you can act with confidence.",
    color: "yellow",
  },
];

const colorMap: Record<string, string> = {
  violet: "text-violet-400 bg-violet-500/20 border-violet-500/30",
  cyan: "text-cyan-400 bg-cyan-500/20 border-cyan-500/30",
  green: "text-green-400 bg-green-500/20 border-green-500/30",
  yellow: "text-yellow-400 bg-yellow-500/20 border-yellow-500/30",
};

export function HowItWorks() {
  return (
    <section id="how-it-works" className="py-24 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <Badge variant="info" className="mb-4">Simple process</Badge>
          <h2 className="text-4xl sm:text-5xl font-bold mb-4">
            <span className="text-white">From idea to</span>{" "}
            <span className="gradient-text">insight in minutes</span>
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            No data science degree required. SimWorld makes complex market simulation
            accessible to anyone with a decision to make.
          </p>
        </div>

        <div className="relative">
          {/* Connecting line */}
          <div className="hidden lg:block absolute top-16 left-[12.5%] right-[12.5%] h-px bg-gradient-to-r from-transparent via-violet-500/40 to-transparent" />

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {steps.map((step, i) => (
              <div key={step.number} className="relative text-center group">
                {/* Step number + icon */}
                <div className="flex justify-center mb-6">
                  <div
                    className={`relative w-20 h-20 rounded-2xl border ${colorMap[step.color]} flex flex-col items-center justify-center gap-1 group-hover:scale-110 transition-transform`}
                  >
                    <step.icon className={`w-6 h-6 ${colorMap[step.color].split(" ")[0]}`} />
                    <span className={`text-xs font-bold ${colorMap[step.color].split(" ")[0]}`}>
                      {step.number}
                    </span>
                  </div>
                </div>

                <h3 className="text-lg font-semibold text-white mb-3">{step.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
