"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

const plans = [
  {
    name: "Free",
    price: { monthly: 0, annual: 0 },
    description: "Perfect for exploring simulations",
    features: [
      "5 simulations / month",
      "100 runs per simulation",
      "6 agent templates",
      "Basic charts & dashboards",
      "3 variable inputs",
      "Community support",
    ],
    cta: "Get started free",
    href: "/signup",
    popular: false,
  },
  {
    name: "Pro",
    price: { monthly: 49, annual: 39 },
    description: "For serious decision makers",
    features: [
      "Unlimited simulations",
      "10,000 runs per simulation",
      "All agent types + custom",
      "Advanced visualizations",
      "Unlimited variables",
      "Save & compare strategies",
      "AI insight explanations",
      "CSV/PDF export",
      "Priority support",
    ],
    cta: "Start Pro trial",
    href: "/signup?plan=pro",
    popular: true,
  },
  {
    name: "Enterprise",
    price: { monthly: 299, annual: 249 },
    description: "For teams and organizations",
    features: [
      "Everything in Pro",
      "Unlimited team members",
      "Real-world data integration",
      "Custom agent behaviors",
      "API access",
      "Collaboration tools",
      "Audit logs",
      "SSO / SAML",
      "Dedicated support",
      "SLA guarantee",
    ],
    cta: "Contact sales",
    href: "/contact",
    popular: false,
  },
];

export function Pricing() {
  const [annual, setAnnual] = useState(false);

  return (
    <section id="pricing" className="py-24 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <Badge variant="purple" className="mb-4">
            <Sparkles className="w-3 h-3 mr-1" />
            Transparent pricing
          </Badge>
          <h2 className="text-4xl sm:text-5xl font-bold mb-4">
            <span className="text-white">Invest in better</span>{" "}
            <span className="gradient-text">decisions</span>
          </h2>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto mb-8">
            One good simulation can save you from a costly mistake. Start free, scale as you grow.
          </p>

          {/* Toggle */}
          <div className="inline-flex items-center gap-3 glass rounded-full px-2 py-1">
            <button
              onClick={() => setAnnual(false)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${!annual ? "bg-primary text-white" : "text-muted-foreground"}`}
            >
              Monthly
            </button>
            <button
              onClick={() => setAnnual(true)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${annual ? "bg-primary text-white" : "text-muted-foreground"}`}
            >
              Annual
              <span className="ml-2 text-xs text-green-400">save 20%</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`relative rounded-2xl p-8 border transition-all ${
                plan.popular
                  ? "bg-gradient-to-br from-violet-500/20 to-cyan-500/10 border-violet-500/50 neon-glow scale-105"
                  : "bg-white/5 border-white/10 hover:border-white/20"
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                  <Badge variant="purple" className="px-4 py-1">Most Popular</Badge>
                </div>
              )}

              <div className="mb-6">
                <h3 className="text-xl font-bold text-white mb-1">{plan.name}</h3>
                <p className="text-sm text-muted-foreground">{plan.description}</p>
              </div>

              <div className="mb-8">
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold text-white">
                    ${annual ? plan.price.annual : plan.price.monthly}
                  </span>
                  {plan.price.monthly > 0 && (
                    <span className="text-muted-foreground text-sm">/mo</span>
                  )}
                </div>
                {annual && plan.price.monthly > 0 && (
                  <p className="text-xs text-green-400 mt-1">
                    Billed ${plan.price.annual * 12}/year
                  </p>
                )}
              </div>

              <ul className="space-y-3 mb-8">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-3 text-sm">
                    <Check className="w-4 h-4 text-violet-400 flex-shrink-0" />
                    <span className="text-muted-foreground">{feature}</span>
                  </li>
                ))}
              </ul>

              <Button
                variant={plan.popular ? "gradient" : "glass"}
                size="lg"
                className="w-full"
                asChild
              >
                <Link href={plan.href}>{plan.cta}</Link>
              </Button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
