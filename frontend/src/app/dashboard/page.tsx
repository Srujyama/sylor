"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus, ArrowRight, TrendingUp, Activity, Zap, Loader2,
  BarChart2, RotateCcw, Search,
  Rocket, DollarSign, FlaskConical, Percent, X, Sparkles,
  CheckCircle2, Circle, GitBranch,
  Share2, Command, SlidersHorizontal,
} from "lucide-react";
import { onAuthChange } from "@/lib/firebase/auth";
import { listSimulations, mapSimulation, getDashboardDigest } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useDemoClaim } from "@/lib/use-demo-claim";
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
} from "recharts";
import { ChartDataTable } from "@/components/ui/chart-data-table";
import type { Simulation, DashboardDigest, DigestItem } from "@/types";

const LAST_SEEN_KEY = "sylor-last-seen";
const DIGEST_DISMISSED_KEY = "sylor-digest-dismissed";
const ACTIVATION_DISMISSED_KEY = "sylor-activation-dismissed";

const statusDot: Record<string, string> = {
  completed: "dot-green",
  running: "dot-blue",
  failed: "dot-red",
  draft: "dot-yellow",
};

const statusLabel: Record<string, string> = {
  completed: "completed",
  running: "running",
  failed: "failed",
  draft: "draft",
};

const statusTagClass: Record<string, string> = {
  completed: "tag-green",
  running: "tag-blue",
  failed: "tag-red",
  draft: "tag-yellow",
};

const categoryLabels: Record<string, string> = {
  startup: "startup",
  pricing: "pricing",
  policy: "policy",
  marketing: "marketing",
  product: "product",
  finance: "finance",
  biology: "biology",
  trend: "trend",
  custom: "custom",
};

// Empty-state question gallery — each card prefills the AI prompt on /simulations/new
const questionGallery = [
  { q: "will my saas hit $1m arr?", icon: Rocket, hint: "startup growth" },
  { q: "is $29 or $49 the better price?", icon: DollarSign, hint: "pricing strategy" },
  { q: "how risky is my portfolio?", icon: BarChart2, hint: "finance" },
  { q: "will this molecule bind?", icon: FlaskConical, hint: "molecular dynamics" },
  { q: "where is this trend heading?", icon: TrendingUp, hint: "trend forecasting" },
  { q: "should i raise prices?", icon: Percent, hint: "revenue impact" },
];

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return `${diffD}d ago`;
  return `${Math.floor(diffD / 30)}mo ago`;
}

export default function DashboardPage() {
  const router = useRouter();
  const [userName, setUserName] = useState("there");
  const [userId, setUserId] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [simulations, setSimulations] = useState<Simulation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [claimedSimId, setClaimedSimId] = useState<string | null>(null);

  // "Since you were away" digest strip
  const [digest, setDigest] = useState<DashboardDigest | null>(null);
  const [digestDismissed, setDigestDismissed] = useState(true);

  // Getting-started activation checklist
  const [activationDismissed, setActivationDismissed] = useState(true);
  const [paletteUsed, setPaletteUsed] = useState(false);
  const [comparedUsed, setComparedUsed] = useState(false);
  const [sharedUsed, setSharedUsed] = useState(false);

  useEffect(() => {
    // Wait for Firebase to resolve auth state before doing anything
    const unsubscribe = onAuthChange((user) => {
      if (user) {
        if (user.displayName) {
          setUserName(user.displayName.split(" ")[0]);
        } else if (user.email) {
          setUserName(user.email.split("@")[0]);
        }
        setUserId(user.uid);
      } else {
        // Not logged in — redirect to login
        router.replace("/login");
      }
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, [router]);

  const fetchSimulations = useCallback(async () => {
    if (!userId) return;
    try {
      setError(null);
      const data = await listSimulations(userId);
      const mapped: Simulation[] = data.map(mapSimulation);
      setSimulations(mapped.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // Claim a zero-signup demo (from /demo, stashed in localStorage) once the user
  // is signed in — moves it into their dashboard and refreshes the list.
  useDemoClaim((simulationId) => {
    setClaimedSimId(simulationId);
    fetchSimulations();
  });

  useEffect(() => {
    // Only start fetching once auth is resolved and we have a user
    if (!authReady || !userId) return;
    fetchSimulations();
    // Poll for running simulations
    const interval = setInterval(fetchSimulations, 8000);
    return () => clearInterval(interval);
  }, [authReady, userId, fetchSimulations]);

  // "Since you were away" digest — read the stored last-visit timestamp, fetch
  // the digest once on load, render the strip if there are items, then stamp the
  // current time so the next visit only surfaces what's newer.
  useEffect(() => {
    if (!authReady || !userId) return;
    let lastSeenAt: string | undefined;
    try {
      lastSeenAt = localStorage.getItem(LAST_SEEN_KEY) || undefined;
    } catch {
      // localStorage unavailable — treat as a fresh visit
    }
    let cancelled = false;
    let dismissedAt: string | null = null;
    try { dismissedAt = localStorage.getItem(DIGEST_DISMISSED_KEY); } catch {}
    getDashboardDigest(lastSeenAt)
      .then((d) => {
        if (cancelled) return;
        setDigest(d);
        const hasItems = (d.items?.length || 0) > 0;
        // Honor a prior dismissal: stay hidden if the user dismissed the strip
        // at or after the window we just queried (i.e. nothing newer has
        // happened since they closed it). Brand-new users (no items) also
        // never see the strip.
        const dismissedThisWindow =
          !!dismissedAt && !!lastSeenAt && dismissedAt >= lastSeenAt;
        setDigestDismissed(!hasItems || dismissedThisWindow);
        try { localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString()); } catch {}
      })
      .catch(() => {
        // non-critical — the strip just stays hidden
      });
    return () => { cancelled = true; };
  }, [authReady, userId]);

  // Activation checklist — read client-side completion flags from localStorage.
  useEffect(() => {
    try {
      if (localStorage.getItem(ACTIVATION_DISMISSED_KEY)) {
        setActivationDismissed(true);
        return;
      }
      setActivationDismissed(false);
      setPaletteUsed(!!localStorage.getItem("sylor-palette-used"));
      setComparedUsed(!!localStorage.getItem("sylor-compared"));
      setSharedUsed(!!localStorage.getItem("sylor-shared"));
    } catch {
      setActivationDismissed(true);
    }
  }, []);

  function dismissDigest() {
    setDigestDismissed(true);
    try { localStorage.setItem(DIGEST_DISMISSED_KEY, new Date().toISOString()); } catch {}
  }

  function dismissActivation() {
    setActivationDismissed(true);
    try { localStorage.setItem(ACTIVATION_DISMISSED_KEY, "1"); } catch {}
  }

  // Computed stats
  const completedSims = simulations.filter((s) => s.status === "completed");
  const avgSuccess = completedSims.length > 0
    ? Math.round(completedSims.reduce((acc, s) => acc + (s.results?.successProbability ?? 0), 0) / completedSims.length)
    : 0;
  const totalRuns = simulations.reduce((acc, s) => acc + (s.runCount || 0), 0);
  const runningSims = simulations.filter((s) => s.status === "running").length;

  // Activation checklist — 5 steps, completion inferred from the user's data
  // where possible (sims, sweeps) and from localStorage event flags otherwise.
  const hasCompletedSim = completedSims.length > 0;
  const hasSweep = simulations.some((s) => (s.runCount || 0) >= 2);
  const firstSimId = simulations[0]?.id;
  const firstCompletedId = completedSims[0]?.id;
  const activationItems = [
    {
      key: "sim",
      label: "run a simulation",
      done: hasCompletedSim,
      href: hasCompletedSim && firstCompletedId ? `/simulations/${firstCompletedId}` : "/simulations/new",
      icon: Zap,
    },
    {
      key: "sweep",
      label: "try a sweep",
      done: hasSweep,
      href: firstCompletedId ? `/simulations/${firstCompletedId}/sweep` : "/simulations/new",
      icon: SlidersHorizontal,
    },
    {
      key: "compare",
      label: "compare two sims",
      done: comparedUsed,
      href: "/simulations/compare",
      icon: GitBranch,
    },
    {
      key: "share",
      label: "share a result",
      done: sharedUsed,
      href: firstCompletedId ? `/simulations/${firstCompletedId}` : (firstSimId ? `/simulations/${firstSimId}` : "/simulations"),
      icon: Share2,
    },
    {
      key: "palette",
      label: "use the command palette (⌘K)",
      done: paletteUsed,
      href: undefined as string | undefined,
      icon: Command,
    },
  ];
  const activationDone = activationItems.filter((i) => i.done).length;
  const activationTotal = activationItems.length;
  const activationComplete = activationDone >= activationTotal;
  const showActivation = !activationDismissed && !loading && !activationComplete && simulations.length > 0;
  // Progress ring geometry
  const ringR = 16;
  const ringC = 2 * Math.PI * ringR;
  const ringPct = activationTotal > 0 ? activationDone / activationTotal : 0;

  // Category breakdown for chart
  const categoryData = Object.entries(
    simulations.reduce<Record<string, number>>((acc, s) => {
      acc[s.category] = (acc[s.category] || 0) + 1;
      return acc;
    }, {})
  ).map(([category, count]) => ({ category: categoryLabels[category] || category, count }))
   .sort((a, b) => b.count - a.count);

  // Filter + search
  const filtered = simulations.filter((s) => {
    if (filterStatus !== "all" && s.status !== filterStatus) return false;
    if (searchQuery && !s.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const stats = [
    { label: "total simulations", value: String(simulations.length), delta: `${completedSims.length} completed`, icon: Activity },
    { label: "avg success rate", value: completedSims.length > 0 ? `${avgSuccess}%` : "—", delta: completedSims.length > 0 ? `across ${completedSims.length} simulations` : "no completed sims yet", icon: TrendingUp },
    { label: "total runs", value: totalRuns > 1000 ? `${(totalRuns / 1000).toFixed(1)}k` : String(totalRuns), delta: runningSims > 0 ? `${runningSims} running now` : "all idle", icon: Zap },
    { label: "categories used", value: String(new Set(simulations.map((s) => s.category)).size), delta: `of 9 available`, icon: BarChart2 },
  ];

  // Greeting based on time
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "good morning" : hour < 18 ? "good afternoon" : "good evening";

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-10">
        <div>
          <p className="text-xs text-white/25 mb-1 tracking-wide">sylor / dashboard</p>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            {greeting}, {userName}
          </h1>
        </div>
        <Link href="/simulations/new" className="btn-primary text-xs py-2 px-4 inline-flex items-center gap-1.5">
          <Plus className="w-3 h-3" />
          new simulation
        </Link>
      </div>

      {/* Claimed demo banner — shown after a zero-signup demo is saved on signup */}
      {claimedSimId && (
        <Link
          href={`/simulations/${claimedSimId}`}
          className="flex items-center gap-3 px-5 py-3 mb-8 bg-gradient-to-r from-violet-500/10 to-cyan-500/5 border border-violet-500/20 hover:border-violet-500/40 transition-colors group"
        >
          <Zap className="w-4 h-4 text-violet-400 shrink-0" />
          <span className="text-xs text-white/70 flex-1">
            your demo simulation was saved to your dashboard
          </span>
          <span className="text-xs text-violet-300 inline-flex items-center gap-1 group-hover:gap-2 transition-all">
            open it <ArrowRight className="w-3 h-3" />
          </span>
        </Link>
      )}

      {/* "Since you were away" digest strip — hidden for brand-new users (no items) */}
      {!digestDismissed && digest && (digest.items?.length || 0) > 0 && (
        <div className="surface mb-8 overflow-hidden">
          <div className="flex items-start gap-3 px-5 py-3.5 border-b border-white/[0.06]">
            <Sparkles className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" />
            <p className="text-sm text-white/70 flex-1 leading-relaxed">{digest.headline}</p>
            <button
              onClick={dismissDigest}
              aria-label="dismiss"
              className="text-white/20 hover:text-white/50 transition-colors shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div>
            {digest.items.map((item: DigestItem, i: number) => {
              const Wrapper: React.ElementType = item.sim_id ? Link : "div";
              const wrapperProps = item.sim_id ? { href: `/simulations/${item.sim_id}` } : {};
              const tone =
                item.type === "completed" ? "dot-green"
                : item.type === "delta" ? "dot-blue"
                : "dot-yellow";
              return (
                <Wrapper
                  key={item.sim_id ?? `${item.type}-${i}`}
                  {...wrapperProps}
                  className={cn(
                    "flex items-center gap-3 px-5 py-2.5 text-xs transition-colors group",
                    item.sim_id && "hover:bg-white/[0.025]",
                    i < digest.items.length - 1 && "border-b border-white/[0.04]"
                  )}
                >
                  <span className={cn("dot shrink-0", tone)} />
                  <span className="text-white/60 flex-1 group-hover:text-white/80 transition-colors">{item.text}</span>
                  {item.sim_id && (
                    <ArrowRight className="w-3 h-3 text-white/20 group-hover:text-white/50 transition-colors shrink-0" />
                  )}
                </Wrapper>
              );
            })}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-[var(--surface-border)] mb-8">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-[var(--page-bg)] p-5">
            {loading ? (
              <>
                <div className="h-7 w-16 bg-white/[0.04] animate-pulse mb-1" />
                <div className="h-3 w-24 bg-white/[0.04] animate-pulse mb-0.5" />
                <div className="h-3 w-20 bg-white/[0.04] animate-pulse" />
              </>
            ) : (
              <>
                <div className="text-2xl font-bold text-white tracking-tight mb-1">{stat.value}</div>
                <div className="text-xs text-white/30 mb-0.5">{stat.label}</div>
                <div className="text-xs text-emerald-400/70">{stat.delta}</div>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-px bg-[var(--surface-border)] mb-8">
        {/* Category breakdown chart */}
        <div className="bg-[var(--page-bg)] p-5 lg:col-span-2">
          <div className="text-xs text-white/25 mb-4 tracking-widest uppercase">simulations by category</div>
          {categoryData.length > 0 ? (
            <div role="img" aria-label="Bar chart: number of simulations by category">
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={categoryData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="category" tick={{ fontSize: 10, fill: "var(--chart-text)", fontFamily: "inherit" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "var(--chart-text)", fontFamily: "inherit" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: "var(--chart-tooltip-bg)",
                    border: "1px solid var(--chart-tooltip-border)",
                    borderRadius: "0",
                    fontSize: 11,
                    fontFamily: "inherit",
                    color: "var(--page-text)",
                  }}
                  labelStyle={{ color: "var(--chart-text-strong)" }}
                  itemStyle={{ color: "var(--chart-text-strong)" }}
                />
                <Bar dataKey="count" name="simulations" fill="var(--chart-grid)" stroke="var(--chart-text)" strokeWidth={1}>
                  {categoryData.map((_, i) => (
                    <Cell key={i} fill={i === 0 ? "rgba(74,222,128,0.2)" : "var(--chart-grid)"} stroke={i === 0 ? "rgba(74,222,128,0.5)" : "var(--chart-text)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <ChartDataTable
              caption="Simulations by category"
              data={categoryData}
              columns={[
                { key: "category", value: (row) => row.category },
                { key: "simulations", value: (row) => row.count },
              ]}
            />
            </div>
          ) : (
            <div className="flex items-center justify-center h-[180px] text-xs text-white/20">
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin text-white/20" />
              ) : (
                "no simulations yet — create your first one"
              )}
            </div>
          )}
        </div>

        {/* Quick start + getting-started activation checklist */}
        <div className="bg-[var(--page-bg)] p-5">
          <div className="text-xs text-white/25 mb-4 tracking-widest uppercase">quick start</div>
          <div className="space-y-0.5">
            {[
              { label: "startup launch", href: "/simulations/new?template=startup" },
              { label: "pricing strategy", href: "/simulations/new?template=pricing" },
              { label: "stock market forecast", href: "/simulations/new?template=finance" },
              { label: "molecular dynamics", href: "/simulations/new?template=biology" },
              { label: "trend analyzer", href: "/simulations/new?template=trend" },
              { label: "custom simulation", href: "/simulations/new" },
            ].map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="flex items-center justify-between px-3 py-2.5 text-xs text-white/40 hover:text-white/80 hover:bg-white/[0.03] transition-colors group"
              >
                <span>{item.label}</span>
                <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
              </Link>
            ))}
          </div>

          {/* Activation checklist — hidden once all 5 are done or dismissed */}
          {showActivation && (
            <div className="mt-6 pt-5 border-t border-white/[0.06]">
              <div className="flex items-center gap-3 mb-4">
                {/* Progress ring */}
                <div className="relative w-10 h-10 shrink-0">
                  <svg className="w-10 h-10 -rotate-90" viewBox="0 0 40 40">
                    <circle cx="20" cy="20" r={ringR} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
                    <circle
                      cx="20" cy="20" r={ringR} fill="none" stroke="#8b5cf6" strokeWidth="3"
                      strokeLinecap="round"
                      strokeDasharray={ringC}
                      strokeDashoffset={ringC * (1 - ringPct)}
                      className="transition-[stroke-dashoffset] duration-500"
                    />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-[10px] font-mono text-white/60">
                    {activationDone}/{activationTotal}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-white/60 font-medium">getting started</div>
                  <div className="text-[10px] text-white/25">finish setting up your workspace</div>
                </div>
                <button
                  onClick={dismissActivation}
                  aria-label="dismiss"
                  className="text-white/20 hover:text-white/50 transition-colors shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="space-y-0.5">
                {activationItems.map((item) => {
                  const Inner = (
                    <>
                      {item.done ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" />
                      ) : (
                        <Circle className="w-3.5 h-3.5 text-white/20 shrink-0" />
                      )}
                      <span className={cn("flex-1", item.done ? "text-white/30 line-through" : "text-white/50 group-hover:text-white/80")}>
                        {item.label}
                      </span>
                      {!item.done && item.href && (
                        <ArrowRight className="w-3 h-3 text-white/15 group-hover:text-white/50 transition-colors shrink-0" />
                      )}
                    </>
                  );
                  // Done items, or the palette step (no link), render as static rows.
                  if (item.done || !item.href) {
                    return (
                      <div key={item.key} className="flex items-center gap-2.5 px-1 py-2 text-xs">
                        {Inner}
                      </div>
                    );
                  }
                  return (
                    <Link
                      key={item.key}
                      href={item.href}
                      className="flex items-center gap-2.5 px-1 py-2 text-xs transition-colors group"
                    >
                      {Inner}
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Simulations list */}
      <div className="surface">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 sm:px-5 py-3 border-b border-white/[0.06]">
          <span className="text-xs text-white/25 tracking-widest uppercase">
            {filterStatus === "all" ? "all simulations" : `${filterStatus} simulations`}
            {!loading && <span className="ml-2 text-white/15">({filtered.length})</span>}
          </span>
          <div className="flex items-center gap-3 flex-wrap">
            {/* Search */}
            <div className="relative">
              <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-white/20" />
              <input
                type="text"
                placeholder="search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-transparent border border-white/[0.06] text-xs text-white/60 pl-7 pr-3 py-1.5 w-40 focus:outline-none focus:border-white/15 placeholder:text-white/15"
              />
            </div>
            {/* Status filter */}
            <div className="flex items-center gap-1">
              {["all", "completed", "running", "failed", "draft"].map((s) => (
                <button
                  key={s}
                  onClick={() => setFilterStatus(s)}
                  className={`text-[10px] px-2 py-1 border transition-colors ${
                    filterStatus === s
                      ? "border-white/20 text-white/60 bg-white/[0.05]"
                      : "border-transparent text-white/20 hover:text-white/40"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          {loading ? (
            // Loading skeletons
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={`flex items-center gap-4 px-5 py-3.5 ${i < 3 ? "border-b border-white/[0.04]" : ""}`}>
                <div className="w-2 h-2 bg-white/[0.06] animate-pulse shrink-0" />
                <div className="flex-1">
                  <div className="h-3 w-48 bg-white/[0.04] animate-pulse mb-1.5" />
                  <div className="h-2.5 w-24 bg-white/[0.04] animate-pulse" />
                </div>
                <div className="h-4 w-16 bg-white/[0.04] animate-pulse" />
                <div className="h-4 w-16 bg-white/[0.04] animate-pulse" />
              </div>
            ))
          ) : error ? (
            <div className="px-5 py-12 text-center">
              <div className="text-xs text-red-400/70 mb-2">failed to load simulations</div>
              <div className="text-[10px] text-white/20 mb-4">{error}</div>
              <button onClick={fetchSimulations} className="text-xs text-white/40 hover:text-white/70 border border-white/10 px-3 py-1.5 transition-colors">
                <RotateCcw className="w-3 h-3 inline mr-1.5" /> retry
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-5 py-16 text-center">
              {simulations.length === 0 ? (
                <>
                  <div className="text-white/30 mb-1 text-sm">no simulations yet — ask a question</div>
                  <div className="text-[10px] text-white/10 mb-6">pick one to prefill your first simulation, or write your own</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-white/[0.05] max-w-3xl mx-auto text-left">
                    {questionGallery.map((item) => (
                      <Link
                        key={item.q}
                        href={`/simulations/new?question=${encodeURIComponent(item.q)}`}
                        className="bg-[var(--page-bg)] p-4 hover:bg-white/[0.03] transition-colors group"
                      >
                        <item.icon className="w-4 h-4 text-white/25 group-hover:text-white/60 transition-colors mb-3" />
                        <div className="text-xs font-medium text-white/60 group-hover:text-white transition-colors mb-1">
                          {item.q}
                        </div>
                        <div className="text-[10px] text-white/20 flex items-center gap-1">
                          {item.hint}
                          <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </Link>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-white/20 mb-1 text-sm">no matches</div>
                  <div className="text-[10px] text-white/10">try a different search or filter</div>
                </>
              )}
            </div>
          ) : (
            filtered.map((sim, i) => (
              <Link
                key={sim.id}
                href={`/simulations/${sim.id}`}
                className={`flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-3.5 hover:bg-white/[0.025] transition-colors group ${
                  i < filtered.length - 1 ? "border-b border-white/[0.04]" : ""
                }`}
              >
                <span className={`dot ${statusDot[sim.status] || "dot-yellow"} shrink-0`} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-white/80 truncate group-hover:text-white transition-colors">
                    {sim.name}
                  </div>
                  <div className="text-xs text-white/25 mt-0.5">{timeAgo(sim.updatedAt)}</div>
                </div>
                <span className={`tag ${statusTagClass[sim.status] || "tag-yellow"} shrink-0`}>
                  {statusLabel[sim.status] || sim.status}
                  {sim.status === "running" && <Loader2 className="w-2.5 h-2.5 animate-spin inline ml-1" />}
                </span>
                {/* Category — hidden on the narrowest screens to avoid crowding */}
                <span className="tag shrink-0 hidden sm:inline-flex">{categoryLabels[sim.category] || sim.category}</span>
                {sim.results?.successProbability != null && (
                  <div className="flex items-center gap-2 w-14 sm:w-24 shrink-0">
                    <div className="progress-bar flex-1 hidden sm:block">
                      <div
                        className="progress-fill"
                        style={{ width: `${Math.round(sim.results.successProbability)}%` }}
                      />
                    </div>
                    <span className="text-xs text-white/35 w-full sm:w-7 text-right">
                      {Math.round(sim.results.successProbability)}%
                    </span>
                  </div>
                )}
                {sim.runCount > 0 && (
                  <span className="text-[10px] text-white/15 w-12 text-right shrink-0 hidden sm:inline">
                    {sim.runCount} run{sim.runCount !== 1 ? "s" : ""}
                  </span>
                )}
                <ArrowRight className="w-3 h-3 text-white/20 group-hover:text-white/50 transition-colors shrink-0" />
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
