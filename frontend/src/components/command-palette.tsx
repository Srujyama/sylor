"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Search, LayoutDashboard, Layers, BarChart3, LayoutTemplate,
  BookOpen, Settings, Plus, ArrowRight, Command, GitBranch, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { listSimulations } from "@/lib/api";
import { getCurrentUser } from "@/lib/firebase/auth";

const RECENTS_KEY = "sylor-recents";

interface SimEntry {
  id: string;
  name: string;
  status: string;
  success: number | null;
  updatedAt: string;
}

interface PaletteEntry {
  id: string;
  section: string;
  label: string;
  description?: string;
  icon?: React.ElementType;
  sim?: SimEntry;
  action: () => void;
}

const statusDotClass: Record<string, string> = {
  completed: "dot-green",
  running: "dot-blue",
  failed: "dot-red",
  draft: "dot-yellow",
};

// Simple subsequence fuzzy score — higher is better, -1 means no match.
// Rewards consecutive matches and matches near the start of the string.
function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  let qi = 0;
  let score = 0;
  let streak = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++;
      streak++;
      score += 1 + streak; // consecutive chars compound
      if (ti === qi - 1) score += 2; // prefix match bonus
    } else {
      streak = 0;
    }
  }
  return qi === q.length ? score : -1;
}

function readRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function pushRecent(simId: string) {
  try {
    const next = [simId, ...readRecents().filter((id) => id !== simId)].slice(0, 5);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // localStorage unavailable — recents just won't persist
  }
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [sims, setSims] = useState<SimEntry[] | null>(null);
  const [simsLoading, setSimsLoading] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const navigate = useCallback(
    (path: string) => router.push(path),
    [router]
  );

  const navigateToSim = useCallback(
    (simId: string) => {
      pushRecent(simId);
      router.push(`/simulations/${simId}`);
    },
    [router]
  );

  // Fetch the user's simulations once per open — cached in state for the session
  useEffect(() => {
    if (!open) return;
    setRecents(readRecents());
    let cancelled = false;
    const user = getCurrentUser();
    if (!user?.uid) {
      setSims([]);
      return;
    }
    setSimsLoading(true);
    listSimulations(user.uid)
      .then((data: any[]) => {
        if (cancelled) return;
        const mapped: SimEntry[] = (data || [])
          .map((s: any) => ({
            id: s.id,
            name: s.name,
            status: s.status,
            success: s.results?.success_probability ?? null,
            updatedAt: s.updated_at,
          }))
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        setSims(mapped);
      })
      .catch(() => { if (!cancelled) setSims([]); })
      .finally(() => { if (!cancelled) setSimsLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  const actions: PaletteEntry[] = useMemo(() => [
    { id: "new-sim", section: "actions", label: "New Simulation", description: "Create a new Monte Carlo simulation", icon: Plus, action: () => navigate("/simulations/new") },
    { id: "compare-sims", section: "actions", label: "Compare Simulations", description: "Compare results side by side", icon: GitBranch, action: () => navigate("/simulations/compare") },
    { id: "dashboard", section: "actions", label: "Dashboard", description: "Go to dashboard", icon: LayoutDashboard, action: () => navigate("/dashboard") },
    { id: "simulations", section: "actions", label: "Simulations", description: "View all simulations", icon: Layers, action: () => navigate("/simulations") },
    { id: "analytics", section: "actions", label: "Analytics", description: "View analytics & insights", icon: BarChart3, action: () => navigate("/analytics") },
    { id: "templates", section: "actions", label: "Templates", description: "Browse simulation templates", icon: LayoutTemplate, action: () => navigate("/templates") },
    { id: "docs", section: "actions", label: "Documentation", description: "Read the docs", icon: BookOpen, action: () => navigate("/docs") },
    { id: "settings", section: "actions", label: "Settings", description: "Account & preferences", icon: Settings, action: () => navigate("/settings") },
  ], [navigate]);

  // Build the flat, ordered entry list: recent → simulations → actions
  const entries: PaletteEntry[] = useMemo(() => {
    const q = query.trim();
    const result: PaletteEntry[] = [];
    const allSims = sims || [];
    const toEntry = (s: SimEntry, section: string): PaletteEntry => ({
      id: `${section}-${s.id}`,
      section,
      label: s.name,
      sim: s,
      action: () => navigateToSim(s.id),
    });

    if (!q) {
      // Recent: last 5 opened, in recency order
      const byId = new Map(allSims.map((s) => [s.id, s]));
      const recentSims = recents
        .map((id) => byId.get(id))
        .filter((s): s is SimEntry => Boolean(s))
        .slice(0, 5);
      result.push(...recentSims.map((s) => toEntry(s, "recent")));

      // Simulations: newest, excluding what's already shown
      const recentIds = new Set(recentSims.map((s) => s.id));
      result.push(
        ...allSims
          .filter((s) => !recentIds.has(s.id))
          .slice(0, 6)
          .map((s) => toEntry(s, "simulations"))
      );

      result.push(...actions);
      return result;
    }

    // Query mode — fuzzy filter sims by name, substring/fuzzy filter actions
    const scoredSims = allSims
      .map((s) => ({ s, score: fuzzyScore(q, s.name) }))
      .filter(({ score }) => score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    result.push(...scoredSims.map(({ s }) => toEntry(s, "simulations")));

    result.push(
      ...actions.filter(
        (a) =>
          fuzzyScore(q, a.label) >= 0 ||
          (a.description || "").toLowerCase().includes(q.toLowerCase())
      )
    );
    return result;
  }, [query, sims, recents, actions, navigateToSim]);

  const sections = Array.from(new Set(entries.map((e) => e.section)));

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
        setQuery("");
        setSelectedIndex(0);
        // Mark the "use the command palette" activation step as done (Wave J).
        try { localStorage.setItem("sylor-palette-used", "1"); } catch {}
      }
      if (e.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleSelect = useCallback(
    (index: number) => {
      const item = entries[index];
      if (item) {
        item.action();
        setOpen(false);
        setQuery("");
      }
    },
    [entries]
  );

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, entries.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      handleSelect(selectedIndex);
    }
  }

  if (!open) return null;

  let flatIndex = -1;

  return (
    <div className="fixed inset-0 z-[100]" onClick={() => setOpen(false)}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Dialog */}
      <div
        className="absolute top-[20%] left-1/2 -translate-x-1/2 w-full max-w-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-[var(--surface-bg)] border border-white/10 shadow-2xl">
          {/* Search input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06]">
            <Search className="w-4 h-4 text-white/25 shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search simulations and commands..."
              className="flex-1 bg-transparent text-sm text-white/80 placeholder:text-white/20 outline-none"
            />
            {simsLoading && <Loader2 className="w-3 h-3 animate-spin text-white/20 shrink-0" />}
            <kbd className="text-[10px] px-1.5 py-0.5 border border-white/10 text-white/20">esc</kbd>
          </div>

          {/* Results */}
          <div className="max-h-[320px] overflow-y-auto py-2">
            {entries.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-white/20">
                No results found
              </div>
            ) : (
              sections.map((section) => (
                <div key={section}>
                  <div className="px-4 py-1.5 text-[10px] text-white/20 uppercase tracking-wider">
                    {section}
                  </div>
                  {entries
                    .filter((e) => e.section === section)
                    .map((entry) => {
                      flatIndex++;
                      const idx = flatIndex;
                      return (
                        <button
                          key={entry.id}
                          onClick={() => handleSelect(idx)}
                          onMouseEnter={() => setSelectedIndex(idx)}
                          className={cn(
                            "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                            idx === selectedIndex
                              ? "bg-white/[0.06] text-white"
                              : "text-white/50 hover:bg-white/[0.03]"
                          )}
                        >
                          {entry.sim ? (
                            <span className={cn("dot shrink-0", statusDotClass[entry.sim.status] || "dot-yellow")} />
                          ) : entry.icon ? (
                            <entry.icon className="w-4 h-4 shrink-0 text-white/30" />
                          ) : null}
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium truncate">{entry.label}</div>
                            {entry.description && (
                              <div className="text-[10px] text-white/20 truncate">{entry.description}</div>
                            )}
                          </div>
                          {entry.sim?.success != null && (
                            <span className="text-[10px] font-mono text-white/30 shrink-0">
                              {Math.round(entry.sim.success)}%
                            </span>
                          )}
                          <ArrowRight className="w-3 h-3 shrink-0 opacity-0 group-hover:opacity-100" />
                        </button>
                      );
                    })}
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-2 border-t border-white/[0.06]">
            <div className="flex items-center gap-4 text-[10px] text-white/15">
              <span>↑↓ navigate</span>
              <span>↵ select</span>
              <span>esc close</span>
            </div>
            <div className="flex items-center gap-1 text-[10px] text-white/15">
              <Command className="w-2.5 h-2.5" />
              <span>K</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
