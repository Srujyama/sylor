"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { useState } from "react";

const plans = [
  {
    name: "free",
    price: { monthly: 0, annual: 0 },
    description: "explore simulations",
    features: [
      "5 simulations / month",
      "100 runs per simulation",
      "6 agent templates",
      "3 domain types",
      "basic charts & dashboards",
      "3 variable inputs",
      "community support",
    ],
    cta: "get started free",
    href: "/signup",
    highlight: false,
  },
  {
    name: "pro",
    price: { monthly: 49, annual: 39 },
    description: "serious decision makers",
    features: [
      "unlimited simulations",
      "10,000 runs per simulation",
      "all agent types + custom",
      "all domains + data upload",
      "CSV/Excel data import",
      "advanced visualizations",
      "unlimited variables",
      "save & compare strategies",
      "AI insight explanations",
      "CSV/PDF export",
      "priority support",
    ],
    cta: "start pro trial",
    href: "/signup?plan=pro",
    highlight: true,
  },
  {
    name: "enterprise",
    price: { monthly: 299, annual: 249 },
    description: "teams and organizations",
    features: [
      "everything in pro",
      "unlimited team members",
      "custom domain models",
      "API data integration",
      "real-world data feeds",
      "custom agent behaviors",
      "API access",
      "collaboration tools",
      "audit logs",
      "SSO / SAML",
      "dedicated support",
      "SLA guarantee",
    ],
    cta: "contact sales",
    href: "/contact",
    highlight: false,
  },
];

export function Pricing() {
  const [annual, setAnnual] = useState(false);

  return (
    <section id="pricing" className="py-24 border-t border-white/[0.05]">
      <div className="max-w-[1440px] mx-auto px-8">
        {/* Header */}
        <div className="mb-12">
          <span className="tag mb-4 inline-flex">transparent pricing</span>
          <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight mb-4">
            invest in better decisions
          </h2>
          <p className="text-sm text-white/35 max-w-sm leading-relaxed mb-6">
            One good simulation can save you from a costly mistake. Start free, scale as you grow.
          </p>

          {/* Toggle */}
          <div className="inline-flex items-center surface">
            <button
              onClick={() => setAnnual(false)}
              className={`px-4 py-1.5 text-xs font-medium transition-colors ${
                !annual ? "bg-white text-black" : "text-white/40 hover:text-white/70"
              }`}
            >
              monthly
            </button>
            <button
              onClick={() => setAnnual(true)}
              className={`px-4 py-1.5 text-xs font-medium transition-colors flex items-center gap-2 ${
                annual ? "bg-white text-black" : "text-white/40 hover:text-white/70"
              }`}
            >
              annual
              <span className={`text-[10px] ${annual ? "text-emerald-700" : "text-emerald-400"}`}>−20%</span>
            </button>
          </div>
        </div>

        {/* Plans */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/[0.05]">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`p-6 flex flex-col ${
                plan.highlight
                  ? "bg-white/[0.04] border-t-2 border-t-white/40"
                  : "bg-[var(--page-bg)]"
              }`}
            >
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-semibold text-white">{plan.name}</span>
                  {plan.highlight && <span className="tag tag-green text-[10px]">popular</span>}
                </div>
                <p className="text-xs text-white/30">{plan.description}</p>
              </div>

              <div className="mb-6">
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-bold text-white tracking-tight">
                    ${annual ? plan.price.annual : plan.price.monthly}
                  </span>
                  {plan.price.monthly > 0 && (
                    <span className="text-xs text-white/30">/mo</span>
                  )}
                </div>
                {annual && plan.price.monthly > 0 && (
                  <p className="text-xs text-emerald-400 mt-0.5">
                    billed ${plan.price.annual * 12}/year
                  </p>
                )}
              </div>

              <ul className="space-y-2 mb-8 flex-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-xs">
                    <Check className="w-3 h-3 text-white/30 mt-0.5 shrink-0" />
                    <span className="text-white/45">{f}</span>
                  </li>
                ))}
              </ul>

              <Link
                href={plan.href}
                className={plan.highlight ? "btn-primary justify-center w-full" : "btn-ghost justify-center w-full"}
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
