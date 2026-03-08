"use client";

import { Badge } from "@/components/ui/badge";
import {
  Brain, ChartBar, Users2, Zap, GitBranch, BarChart3,
  Lightbulb, Lock, RefreshCw, Globe2, Target, TrendingUp,
} from "lucide-react";

const features = [
  {
    icon: Brain,
    title: "Multi-Agent AI System",
    description:
      "Each agent represents a real market participant — customers, competitors, regulators, investors — all reacting dynamically to your decisions.",
    color: "violet",
    gradient: "from-violet-500/20 to-purple-500/5",
    border: "border-violet-500/20",
  },
  {
    icon: ChartBar,
    title: "Thousands of Scenarios",
    description:
      "Run 100 to 10,000 simulation variants automatically. Get statistically reliable success probabilities with confidence intervals.",
    color: "cyan",
    gradient: "from-cyan-500/20 to-blue-500/5",
    border: "border-cyan-500/20",
  },
  {
    icon: GitBranch,
    title: "Decision Trees & What-Ifs",
    description:
      "Explore every decision path visually. Tweak any variable and rerun instantly to see how small changes compound into big differences.",
    color: "green",
    gradient: "from-green-500/20 to-emerald-500/5",
    border: "border-green-500/20",
  },
  {
    icon: Users2,
    title: "No-Code Simulation Builder",
    description:
      "Design full market simulations through simple forms. Define agents, rules, and variables without writing a single line of code.",
    color: "yellow",
    gradient: "from-yellow-500/20 to-orange-500/5",
    border: "border-yellow-500/20",
  },
  {
    icon: BarChart3,
    title: "Interactive Dashboards",
    description:
      "Visualize outcomes with dynamic charts, probability distributions, market growth curves, and competitive dynamics over time.",
    color: "pink",
    gradient: "from-pink-500/20 to-rose-500/5",
    border: "border-pink-500/20",
  },
  {
    icon: Lightbulb,
    title: "AI-Generated Insights",
    description:
      "Claude AI explains why scenarios succeed or fail in plain language, highlighting key risk factors and hidden opportunities.",
    color: "orange",
    gradient: "from-orange-500/20 to-amber-500/5",
    border: "border-orange-500/20",
  },
  {
    icon: RefreshCw,
    title: "Live Rerun Engine",
    description:
      "Adjust any input — pricing, budget, timing, market size — and watch results update in real time without waiting.",
    color: "violet",
    gradient: "from-violet-500/20 to-indigo-500/5",
    border: "border-violet-500/20",
  },
  {
    icon: Globe2,
    title: "Real-World Data Calibration",
    description:
      "Ground your simulations in reality with industry benchmarks, market data, and historical patterns for more accurate predictions.",
    color: "cyan",
    gradient: "from-cyan-500/20 to-teal-500/5",
    border: "border-cyan-500/20",
  },
  {
    icon: Lock,
    title: "Save & Compare Strategies",
    description:
      "Save multiple simulation configurations and run head-to-head comparisons to find your optimal strategy scientifically.",
    color: "green",
    gradient: "from-green-500/20 to-lime-500/5",
    border: "border-green-500/20",
  },
];

export function Features() {
  return (
    <section id="features" className="py-24 relative">
      <div className="absolute inset-0 grid-pattern opacity-20" />
      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <Badge variant="purple" className="mb-4">
            <Target className="w-3 h-3 mr-1" />
            Everything you need
          </Badge>
          <h2 className="text-4xl sm:text-5xl font-bold mb-4">
            <span className="text-white">Simulation at</span>{" "}
            <span className="gradient-text">enterprise scale</span>
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            From quick what-ifs to full market simulations, SimWorld adapts to every decision
            you need to validate.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, i) => (
            <div
              key={feature.title}
              className={`group relative rounded-2xl p-6 bg-gradient-to-br ${feature.gradient} border ${feature.border} hover:scale-[1.02] transition-all duration-300 cursor-default`}
              style={{ animationDelay: `${i * 100}ms` }}
            >
              {/* Icon */}
              <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <feature.icon className="w-6 h-6 text-white" />
              </div>

              <h3 className="text-lg font-semibold text-white mb-2">{feature.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{feature.description}</p>

              {/* Hover glow effect */}
              <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
