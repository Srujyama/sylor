"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

const stats = [
  { label: "simulations run", value: "2.4M+" },
  { label: "avg success rate", value: "73%" },
  { label: "active users", value: "12K+" },
];

export function Hero() {
  return (
    <section className="relative min-h-screen flex flex-col justify-center overflow-hidden pt-14">
      {/* Grid background */}
      <div className="absolute inset-0 grid-lines pointer-events-none" />

      {/* Subtle horizontal rule at top */}
      <div className="absolute top-14 left-0 right-0 h-px bg-white/[0.04]" />

      <div className="relative z-10 max-w-6xl mx-auto px-6 py-24">
        {/* Eyebrow */}
        <div className="mb-8">
          <span className="tag">multi-agent AI simulation</span>
        </div>

        {/* Headline */}
        <h1 className="text-[clamp(2.5rem,7vw,5.5rem)] font-bold text-white leading-[1.05] tracking-[-0.04em] mb-8 max-w-4xl">
          simulate decisions<br />
          before you make them
        </h1>

        {/* Sub */}
        <p className="text-sm text-white/45 max-w-xl mb-10 leading-relaxed">
          Run thousands of AI simulations to predict outcomes before committing to business decisions.
          Model markets, competitors, customers, and economic forces — no code required.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row gap-3 mb-20">
          <Link href="/signup" className="btn-primary inline-flex items-center gap-2">
            start simulating free
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
          <Link href="#features" className="btn-ghost inline-flex items-center gap-2">
            see how it works
          </Link>
        </div>

        {/* Stats row */}
        <div className="flex flex-wrap gap-x-10 gap-y-4 mb-16 border-t border-white/[0.06] pt-8">
          {stats.map((s) => (
            <div key={s.label}>
              <div className="text-2xl font-bold text-white tracking-tight">{s.value}</div>
              <div className="text-xs text-white/30 mt-0.5 tracking-wide">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Terminal mockup */}
        <div className="surface max-w-4xl overflow-hidden">
          {/* Header bar */}
          <div className="flex items-center gap-3 px-5 py-3 border-b border-white/[0.06] bg-white/[0.02]">
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-white/10" />
              <div className="w-2.5 h-2.5 rounded-full bg-white/10" />
              <div className="w-2.5 h-2.5 rounded-full bg-white/10" />
            </div>
            <span className="text-xs text-white/20 font-mono">sylor.ai / simulations / startup-launch</span>
          </div>

          {/* Content */}
          <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Metric card */}
            <div className="surface-raised p-4">
              <div className="text-xs text-white/30 mb-2 tracking-wide uppercase">success probability</div>
              <div className="text-4xl font-bold text-white mb-3 tracking-tight">73%</div>
              <div className="h-px bg-white/[0.06] w-full mb-2" />
              <div className="h-1 bg-white/[0.06] w-full">
                <div className="h-full bg-white/60" style={{ width: "73%" }} />
              </div>
            </div>

            {/* Chart */}
            <div className="surface-raised p-4 md:col-span-2">
              <div className="text-xs text-white/30 mb-3 tracking-wide uppercase">revenue projection — 12 months</div>
              <div className="flex items-end gap-1 h-16">
                {[20, 35, 28, 45, 52, 48, 65, 72, 68, 85, 90, 100].map((h, i) => (
                  <div key={i} className="flex-1 flex flex-col justify-end">
                    <div
                      className="bg-white/25 hover:bg-white/40 transition-colors"
                      style={{ height: `${h}%` }}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Agents row */}
            <div className="surface-raised p-4 md:col-span-3">
              <div className="text-xs text-white/30 mb-3 tracking-wide uppercase">agent activity — 1,000 runs</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "customers", count: 500, dotClass: "dot-blue" },
                  { label: "competitors", count: 3, dotClass: "dot-red" },
                  { label: "investors", count: 12, dotClass: "dot-yellow" },
                  { label: "regulators", count: 2, dotClass: "dot-green" },
                ].map((a) => (
                  <div key={a.label} className="flex items-center gap-2">
                    <span className={`dot ${a.dotClass}`} />
                    <span className="text-xs text-white/50">{a.label}</span>
                    <span className="text-xs text-white/25 ml-auto">{a.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
