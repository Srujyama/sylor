"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getPublicStats } from "@/lib/api";
import { formatNumber } from "@/lib/utils";
import type { PublicStats } from "@/types";

// Respect prefers-reduced-motion (no count-up animation if set).
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

// Animated count-up to a target value. Renders an em dash placeholder until a
// target is supplied; jumps straight to the value when motion is reduced.
function CountUp({ target, reduced }: { target: number | null; reduced: boolean }) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (target == null) return;
    if (reduced) {
      setDisplay(target);
      return;
    }
    const duration = 1200;
    const start = performance.now();
    const from = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (target - from) * eased));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target, reduced]);

  if (target == null) return <span className="text-white/30">—</span>;
  return <span>{formatNumber(display)}</span>;
}

const categoryLabel: Record<string, string> = {
  startup: "a startup sim",
  pricing: "a pricing sim",
  policy: "a policy sim",
  marketing: "a marketing sim",
  product: "a product sim",
  finance: "a finance sim",
  biology: "a biology sim",
  trend: "a trend sim",
  custom: "a custom sim",
};

function tickerLine(r: PublicStats["recent"][number]): string {
  const label = categoryLabel[r.category] || `a ${r.category} sim`;
  const ago = r.minutes_ago < 1 ? "just now" : `${Math.round(r.minutes_ago)}m ago`;
  return `${label} finished — ${Math.round(r.success_probability)}% success · ${ago}`;
}

export function Hero() {
  const reduced = usePrefersReducedMotion();
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [failed, setFailed] = useState(false);
  const [tickerIdx, setTickerIdx] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getPublicStats()
      .then((data) => {
        if (!cancelled) setStats(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Cycle the live ticker every ~4s through the recent runs.
  const recent = stats?.recent ?? [];
  useEffect(() => {
    if (recent.length === 0) return;
    const id = setInterval(() => {
      setTickerIdx((i) => (i + 1) % recent.length);
    }, 4000);
    return () => clearInterval(id);
  }, [recent.length]);

  // While loading or on failure, targets stay null → tasteful em-dash placeholders.
  const ready = stats != null && !failed;
  const liveStats: Array<{ label: string; target: number | null }> = [
    { label: "simulations run", target: ready ? stats!.total_simulations : null },
    { label: "total runs", target: ready ? stats!.total_runs : null },
    { label: "sims this week", target: ready ? stats!.sims_this_week : null },
  ];

  return (
    <section className="relative min-h-screen flex flex-col justify-center overflow-hidden pt-14">
      {/* Grid background */}
      <div className="absolute inset-0 grid-lines pointer-events-none" />

      {/* Subtle horizontal rule at top */}
      <div className="absolute top-14 left-0 right-0 h-px bg-white/[0.04]" />

      <div className="relative z-10 max-w-[1440px] mx-auto px-8 py-24">
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
          Run thousands of AI simulations across business, finance, and molecular biology.
          Upload your data, model markets, proteins, or portfolios — and predict outcomes before committing.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row gap-3 mb-20">
          <Link href="/signup" className="btn-primary inline-flex items-center gap-2">
            start simulating free
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
          <Link href="/demo" className="btn-ghost inline-flex items-center gap-2">
            try it now
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
          <Link href="#features" className="btn-ghost inline-flex items-center gap-2">
            see how it works
          </Link>
        </div>

        {/* Stats row — real data from getPublicStats(), count-up animated */}
        <div className="flex flex-wrap gap-x-10 gap-y-4 mb-16 border-t border-white/[0.06] pt-8">
          {liveStats.map((s) => (
            <div key={s.label}>
              <div className="text-2xl font-bold text-white tracking-tight">
                <CountUp target={s.target} reduced={reduced} />
              </div>
              <div className="text-xs text-white/30 mt-0.5 tracking-wide">{s.label}</div>
            </div>
          ))}
          {/* static, truthful value */}
          <div>
            <div className="text-2xl font-bold text-white tracking-tight">6</div>
            <div className="text-xs text-white/30 mt-0.5 tracking-wide">domains supported</div>
          </div>
        </div>

        {/* Terminal mockup */}
        <div className="surface max-w-5xl overflow-hidden">
          {/* Header bar */}
          <div className="flex items-center gap-3 px-5 py-3 border-b border-white/[0.06] bg-white/[0.02]">
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-white/10" />
              <div className="w-2.5 h-2.5 rounded-full bg-white/10" />
              <div className="w-2.5 h-2.5 rounded-full bg-white/10" />
            </div>
            <span className="text-xs text-white/20 font-mono">sylor.ai / simulations / multi-domain</span>
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
                  { label: "traders", count: 24, dotClass: "dot-yellow" },
                  { label: "molecules", count: 128, dotClass: "dot-green" },
                  { label: "data streams", count: 6, dotClass: "dot-red" },
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

        {/* Live ticker — cycles recent runs; hidden when there are none */}
        {recent.length > 0 && (
          <div className="max-w-5xl mt-3 flex items-center gap-2.5 px-1">
            <span className="dot dot-green shrink-0 animate-pulse" />
            <span
              key={tickerIdx}
              className={`text-xs text-white/35 font-mono ${reduced ? "" : "count-up"}`}
            >
              {tickerLine(recent[tickerIdx])}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
