"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import {
  Rocket, DollarSign, BarChart2, Megaphone, ShoppingCart, Building2, ArrowRight,
} from "lucide-react";

const templates = [
  {
    icon: Rocket,
    name: "Startup Launch",
    category: "Startup",
    description:
      "Model your go-to-market strategy. Simulate customer acquisition, burn rate, and market penetration across funding scenarios.",
    difficulty: "Beginner",
    agents: ["500 customers", "3 competitors", "12 investors"],
    variables: 8,
    avgSuccess: "67%",
    color: "violet",
  },
  {
    icon: DollarSign,
    name: "Pricing Strategy",
    category: "Pricing",
    description:
      "Find optimal price points. Simulate elasticity, competitor reactions, and revenue impact across multiple price tiers.",
    difficulty: "Beginner",
    agents: ["1000 customers", "5 competitors"],
    variables: 6,
    avgSuccess: "82%",
    color: "green",
  },
  {
    icon: BarChart2,
    name: "Policy Impact",
    category: "Policy",
    description:
      "Test regulatory policies before implementation. Model societal behavior, compliance rates, and economic second-order effects.",
    difficulty: "Advanced",
    agents: ["10K citizens", "50 companies", "3 regulators"],
    variables: 15,
    avgSuccess: "54%",
    color: "cyan",
  },
  {
    icon: Megaphone,
    name: "Marketing Campaign",
    category: "Marketing",
    description:
      "Optimize campaign spend. Simulate channel effectiveness, word-of-mouth spread, and brand awareness curves.",
    difficulty: "Intermediate",
    agents: ["2000 customers", "8 competitors"],
    variables: 10,
    avgSuccess: "74%",
    color: "yellow",
  },
  {
    icon: ShoppingCart,
    name: "Product Launch",
    category: "Product",
    description:
      "Simulate how your product will be adopted. Model virality, churn, feature demand, and competitive response.",
    difficulty: "Intermediate",
    agents: ["5000 users", "4 competitors", "tech press"],
    variables: 12,
    avgSuccess: "61%",
    color: "pink",
  },
  {
    icon: Building2,
    name: "Market Entry",
    category: "Strategy",
    description:
      "Assess new market opportunities. Simulate incumbents, regulatory barriers, and customer switching costs.",
    difficulty: "Advanced",
    agents: ["3000 customers", "10 incumbents", "2 regulators"],
    variables: 14,
    avgSuccess: "43%",
    color: "orange",
  },
];

const difficultyColor: Record<string, string> = {
  Beginner: "success",
  Intermediate: "warning",
  Advanced: "destructive",
};

const iconColor: Record<string, string> = {
  violet: "text-violet-400 bg-violet-500/20",
  green: "text-green-400 bg-green-500/20",
  cyan: "text-cyan-400 bg-cyan-500/20",
  yellow: "text-yellow-400 bg-yellow-500/20",
  pink: "text-pink-400 bg-pink-500/20",
  orange: "text-orange-400 bg-orange-500/20",
};

export function Templates() {
  return (
    <section id="templates" className="py-24 relative">
      <div className="absolute inset-0 grid-pattern opacity-10" />
      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <Badge variant="purple" className="mb-4">Ready to use</Badge>
          <h2 className="text-4xl sm:text-5xl font-bold mb-4">
            <span className="text-white">Start with a</span>{" "}
            <span className="gradient-text">template</span>
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Preconfigured scenarios built by experts. Customize to your needs and run in seconds.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
          {templates.map((template) => (
            <Card
              key={template.name}
              className="group hover:border-violet-500/30 transition-all duration-300 hover:scale-[1.02] cursor-pointer"
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between mb-3">
                  <div className={`w-11 h-11 rounded-xl ${iconColor[template.color]} flex items-center justify-center group-hover:scale-110 transition-transform`}>
                    <template.icon className={`w-5 h-5 ${iconColor[template.color].split(" ")[0]}`} />
                  </div>
                  <Badge variant={difficultyColor[template.difficulty] as any} className="text-xs">
                    {template.difficulty}
                  </Badge>
                </div>
                <CardTitle className="text-base">{template.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
                  {template.description}
                </p>

                {/* Agents */}
                <div className="flex flex-wrap gap-1 mb-4">
                  {template.agents.map((agent) => (
                    <span key={agent} className="text-xs px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-muted-foreground">
                      {agent}
                    </span>
                  ))}
                </div>

                {/* Stats row */}
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{template.variables} variables</span>
                  <span className="text-green-400 font-medium">~{template.avgSuccess} avg success</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="text-center">
          <Button variant="gradient" size="lg" asChild className="group">
            <Link href="/signup">
              Browse all templates
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
