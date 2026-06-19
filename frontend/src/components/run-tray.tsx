"use client";

/**
 * Global Run Tray + Notifications (Wave F)
 *
 * Holds a Map of active tracked simulation runs and renders a persistent
 * collapsed pill bottom-right that expands to per-run progress bars. Each
 * tracked run owns a runSimulationStream() that drives its progress. On
 * completion we fire a toast, an optional browser Notification, and briefly
 * flash document.title. The tray only renders when signed in (so it never
 * appears on the public landing/login pages) or when there is >=1 active run.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { Loader2, CheckCircle, XCircle, ChevronDown, ChevronUp, Activity, X } from "lucide-react";
import { runSimulationStream, getResults, type SimulationProgress } from "@/lib/api";
import { onAuthChange } from "@/lib/firebase/auth";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export type RunStatus = "running" | "completed" | "failed";

export interface TrackedRun {
  simId: string;
  name: string;
  percent: number;
  phase: string;
  status: RunStatus;
  successProbability?: number;
}

interface StartRunOptions {
  num_runs?: number;
  variable_overrides?: Record<string, number>;
}

interface RunTrayState {
  runs: TrackedRun[];
  // Owns a runSimulationStream() for this sim and drives its progress.
  startTrackedRun: (simId: string, name: string, opts?: StartRunOptions) => void;
  // Tracks a run that was started elsewhere (e.g. a background task). The tray
  // does NOT start a new run — it polls results until the run resolves. Use
  // this when the run is already in flight server-side to avoid double-running.
  trackExternalRun: (simId: string, name: string) => void;
  dismissRun: (simId: string) => void;
}

const RunTrayContext = createContext<RunTrayState | null>(null);

// Human labels for the SSE stream phases (mirrors the sim detail page).
const PHASE_LABELS: Record<string, string> = {
  running: "running scenarios",
  aggregating: "aggregating results",
  ai_insights: "generating ai insights",
  saving: "saving results",
};

export function RunTrayProvider({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();
  const router = useRouter();
  const [runs, setRuns] = useState<Record<string, TrackedRun>>({});

  // Track which simIds are currently being streamed so a duplicate
  // startTrackedRun() for the same sim doesn't spawn a second stream.
  const activeStreams = useRef<Set<string>>(new Set());
  // Whether we've already prompted for Notification permission this session.
  const askedPermission = useRef(false);
  // Polling fallback timers per sim, cleared on completion/unmount.
  const pollTimers = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  // Per-sim poll attempt counters, to cap an unbounded poll on a stuck run.
  const pollAttempts = useRef<Record<string, number>>({});
  // Serialized tab-title flash state (single shared timer + true original).
  const titleFlash = useRef<{ original: string; timer: ReturnType<typeof setTimeout> | null }>({
    original: "",
    timer: null,
  });

  const updateRun = useCallback((simId: string, patch: Partial<TrackedRun>) => {
    setRuns((prev) => {
      const existing = prev[simId];
      if (!existing) return prev;
      return { ...prev, [simId]: { ...existing, ...patch } };
    });
  }, []);

  // Flash the tab title briefly, then restore it. Serialized so that two
  // completions within the flash window don't capture the flashed text as the
  // "original" and leave the title permanently stuck (the true original is
  // stored once in a ref and a single shared timeout always restores it).
  const flashTitle = useCallback((text: string) => {
    if (typeof document === "undefined") return;
    if (titleFlash.current.timer === null) {
      // No flash active — capture the genuine current title.
      titleFlash.current.original = document.title;
    } else {
      clearTimeout(titleFlash.current.timer);
    }
    document.title = text;
    titleFlash.current.timer = setTimeout(() => {
      document.title = titleFlash.current.original;
      titleFlash.current.timer = null;
    }, 4000);
  }, []);

  const fireBrowserNotification = useCallback(
    (simId: string, name: string, successProbability?: number) => {
      if (typeof window === "undefined" || !("Notification" in window)) return;
      if (Notification.permission !== "granted") return;
      try {
        const pct =
          successProbability != null ? `${Math.round(successProbability)}% success` : "results ready";
        const notification = new Notification(`${name} finished — ${pct}`, {
          body: "click to view your simulation results",
          tag: `sylor-run-${simId}`,
        });
        notification.onclick = () => {
          window.focus();
          router.push(`/simulations/${simId}`);
          notification.close();
        };
      } catch {
        // Notification construction can throw on some platforms — non-critical.
      }
    },
    [router]
  );

  const handleComplete = useCallback(
    (simId: string, name: string, successProbability?: number) => {
      if (pollTimers.current[simId]) {
        clearInterval(pollTimers.current[simId]);
        delete pollTimers.current[simId];
      }
      delete pollAttempts.current[simId];
      activeStreams.current.delete(simId);
      updateRun(simId, { percent: 100, status: "completed", successProbability });
      const pct =
        successProbability != null ? `${Math.round(successProbability)}% success` : undefined;
      toast({
        title: `${name} finished`,
        description: pct ? `success probability: ${pct}` : "results are ready to explore",
        variant: "success",
      });
      fireBrowserNotification(simId, name, successProbability);
      flashTitle("✓ run complete");
    },
    [updateRun, toast, fireBrowserNotification, flashTitle]
  );

  const handleFail = useCallback(
    (simId: string, name: string, detail?: string) => {
      if (pollTimers.current[simId]) {
        clearInterval(pollTimers.current[simId]);
        delete pollTimers.current[simId];
      }
      delete pollAttempts.current[simId];
      activeStreams.current.delete(simId);
      updateRun(simId, { status: "failed", phase: detail || "the run failed" });
      toast({
        title: `${name} failed`,
        description: detail || "the simulation encountered an error",
        variant: "error",
      });
    },
    [updateRun, toast]
  );

  // Fallback: the stream broke or closed without a terminal event but the run
  // keeps going server-side — poll results until it resolves. Bounded so a run
  // that never reaches a terminal state (orphaned/stuck background task, a
  // sim deleted server-side) can't leave an immortal poll loop hammering the
  // API for the whole session (RunTrayProvider never unmounts).
  const startPolling = useCallback(
    (simId: string, name: string) => {
      if (pollTimers.current[simId]) return;
      const MAX_ATTEMPTS = 240; // ~10 min at 2.5s
      pollAttempts.current[simId] = 0;
      pollTimers.current[simId] = setInterval(async () => {
        pollAttempts.current[simId] = (pollAttempts.current[simId] || 0) + 1;
        if (pollAttempts.current[simId] > MAX_ATTEMPTS) {
          clearInterval(pollTimers.current[simId]);
          delete pollTimers.current[simId];
          delete pollAttempts.current[simId];
          activeStreams.current.delete(simId);
          updateRun(simId, {
            phase: "still running in the background — reopen to check",
          });
          return;
        }
        try {
          const data = await getResults(simId);
          if (data.status === "completed") {
            handleComplete(simId, name, data.results?.success_probability);
          } else if (data.status === "failed") {
            handleFail(simId, name);
          }
        } catch (err: any) {
          // A 4xx (e.g. the sim was deleted) is terminal — stop polling.
          if (err?.status >= 400 && err.status < 500) {
            handleFail(simId, name, "the simulation is no longer available");
          }
          // Otherwise a transient error — the next tick retries (within the cap).
        }
      }, 2500);
    },
    [handleComplete, handleFail, updateRun]
  );

  const startTrackedRun = useCallback(
    (simId: string, name: string, opts: StartRunOptions = {}) => {
      // Ask for Notification permission contextually the first time a tracked
      // run starts this session (not on page load).
      if (
        !askedPermission.current &&
        typeof window !== "undefined" &&
        "Notification" in window &&
        Notification.permission === "default"
      ) {
        askedPermission.current = true;
        Notification.requestPermission().catch(() => {});
      }

      // Register/refresh the run in the tray immediately.
      setRuns((prev) => ({
        ...prev,
        [simId]: {
          simId,
          name,
          percent: prev[simId]?.percent ?? 0,
          phase: "starting run...",
          status: "running",
        },
      }));

      // Don't spawn a second stream for an already-tracked sim.
      if (activeStreams.current.has(simId)) return;
      activeStreams.current.add(simId);

      let completed = false;
      let failed = false;

      runSimulationStream(simId, opts, {
        onProgress: (p: SimulationProgress) => {
          updateRun(simId, {
            percent: Math.round(p.percent),
            phase: `${PHASE_LABELS[p.phase] || p.phase} · ${p.completed.toLocaleString()}/${p.total.toLocaleString()}`,
            status: "running",
          });
        },
        onComplete: (data) => {
          completed = true;
          handleComplete(simId, name, data?.success_probability);
        },
        onError: (detail: string) => {
          failed = true;
          handleFail(simId, name, detail);
        },
      })
        .then(async () => {
          if (completed || failed) return;
          // Stream closed without a terminal event — fetch once, else poll.
          try {
            const data = await getResults(simId);
            if (data.status === "completed") {
              handleComplete(simId, name, data.results?.success_probability);
            } else if (data.status === "failed") {
              handleFail(simId, name);
            } else {
              updateRun(simId, { phase: "waiting for results..." });
              startPolling(simId, name);
            }
          } catch {
            startPolling(simId, name);
          }
        })
        .catch((err: any) => {
          if (completed || failed) return;
          if (err?.status >= 400 && err.status < 500) {
            // The run never started (auth/validation) — surface and stop.
            handleFail(simId, name, err.message || "could not start run");
          } else {
            // Stream connection broke — the run may still be going; poll.
            updateRun(simId, { phase: "live progress unavailable — polling..." });
            startPolling(simId, name);
          }
        });
    },
    [updateRun, handleComplete, handleFail, startPolling]
  );

  const trackExternalRun = useCallback(
    (simId: string, name: string) => {
      if (
        !askedPermission.current &&
        typeof window !== "undefined" &&
        "Notification" in window &&
        Notification.permission === "default"
      ) {
        askedPermission.current = true;
        Notification.requestPermission().catch(() => {});
      }
      setRuns((prev) => ({
        ...prev,
        [simId]: {
          simId,
          name,
          percent: prev[simId]?.percent ?? 0,
          phase: "running...",
          status: "running",
        },
      }));
      // The run is already in flight server-side — only poll for completion.
      startPolling(simId, name);
    },
    [startPolling]
  );

  const dismissRun = useCallback((simId: string) => {
    // Tear down any live timer/stream tracking so a dismissed run can't leave
    // a poll loop running behind the scenes.
    if (pollTimers.current[simId]) {
      clearInterval(pollTimers.current[simId]);
      delete pollTimers.current[simId];
    }
    delete pollAttempts.current[simId];
    activeStreams.current.delete(simId);
    setRuns((prev) => {
      const next = { ...prev };
      delete next[simId];
      return next;
    });
  }, []);

  // Clear all polling timers on unmount.
  useEffect(() => {
    return () => {
      Object.values(pollTimers.current).forEach(clearInterval);
    };
  }, []);

  const runList = useMemo(() => Object.values(runs), [runs]);

  const value = useMemo(
    () => ({ runs: runList, startTrackedRun, trackExternalRun, dismissRun }),
    [runList, startTrackedRun, trackExternalRun, dismissRun]
  );

  return (
    <RunTrayContext.Provider value={value}>
      {children}
      <RunTrayUI />
    </RunTrayContext.Provider>
  );
}

export function useRunTray() {
  const ctx = useContext(RunTrayContext);
  if (!ctx) throw new Error("useRunTray must be used within a RunTrayProvider");
  return ctx;
}

const statusDot: Record<RunStatus, string> = {
  running: "dot-blue",
  completed: "dot-green",
  failed: "dot-red",
};

// The persistent collapsed pill / expanded tray. Renders nothing on public
// pages: gated on the user being signed in OR there being >=1 active run.
function RunTrayUI() {
  const { runs, dismissRun } = useRunTray();
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    const unsub = onAuthChange((user) => setSignedIn(!!user));
    return () => unsub();
  }, []);

  if (runs.length === 0) return null;
  if (!signedIn) return null;

  const runningCount = runs.filter((r) => r.status === "running").length;
  const label =
    runningCount > 0
      ? `${runningCount} running`
      : `${runs.length} ${runs.length === 1 ? "run" : "runs"} done`;

  return (
    <div className="fixed bottom-4 right-4 z-[90] w-72 max-w-[calc(100vw-2rem)]">
      {expanded && (
        <div className="surface-raised mb-2 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
            <span className="text-[10px] uppercase tracking-widest text-white/30">tracked runs</span>
            <button
              onClick={() => setExpanded(false)}
              className="text-white/25 hover:text-white/60 transition-colors"
              aria-label="collapse run tray"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {runs.map((run) => (
              <div
                key={run.simId}
                className="px-3 py-2.5 border-b border-white/[0.04] last:border-b-0 hover:bg-white/[0.03] transition-colors group"
              >
                <button
                  onClick={() => router.push(`/simulations/${run.simId}`)}
                  className="w-full text-left"
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span aria-hidden="true" className={cn("dot shrink-0", statusDot[run.status])} />
                    <span className="sr-only">{run.status}:</span>
                    <span className="text-xs text-white/70 truncate flex-1 group-hover:text-white transition-colors">
                      {run.name}
                    </span>
                    {run.status === "running" && <Loader2 aria-hidden="true" className="w-3 h-3 text-white/30 animate-spin shrink-0" />}
                    {run.status === "completed" && <CheckCircle aria-hidden="true" className="w-3 h-3 text-emerald-400 shrink-0" />}
                    {run.status === "failed" && <XCircle aria-hidden="true" className="w-3 h-3 text-red-400 shrink-0" />}
                  </div>
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${run.percent}%` }} />
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[10px] text-white/25 truncate pr-2">
                      {run.status === "completed"
                        ? run.successProbability != null
                          ? `${Math.round(run.successProbability)}% success`
                          : "complete"
                        : run.status === "failed"
                        ? run.phase
                        : run.phase}
                    </span>
                    <span className="text-[10px] text-white/30 font-mono shrink-0">{run.percent}%</span>
                  </div>
                </button>
                {run.status !== "running" && (
                  <button
                    onClick={() => dismissRun(run.simId)}
                    className="mt-1.5 text-[9px] text-white/20 hover:text-white/50 transition-colors flex items-center gap-1"
                  >
                    <X className="w-2.5 h-2.5" /> dismiss
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={() => setExpanded((e) => !e)}
        className="surface-raised w-full flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-white/[0.04] transition-colors"
      >
        {runningCount > 0 ? (
          <Loader2 className="w-3.5 h-3.5 text-white/50 animate-spin shrink-0" />
        ) : (
          <Activity className="w-3.5 h-3.5 text-emerald-400/70 shrink-0" />
        )}
        <span className="text-xs text-white/70 flex-1 text-left">{label}</span>
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-white/30" />
        ) : (
          <ChevronUp className="w-3.5 h-3.5 text-white/30" />
        )}
      </button>
    </div>
  );
}
