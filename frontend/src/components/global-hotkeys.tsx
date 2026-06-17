"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Command, X } from "lucide-react";

// Shortcuts shown in the cheat sheet. Chords ("g d") are listed as two keys.
const SHORTCUTS: Array<{ keys: string[]; label: string }> = [
  { keys: ["c"], label: "new simulation" },
  { keys: ["g", "d"], label: "go to dashboard" },
  { keys: ["g", "a"], label: "go to analytics" },
  { keys: ["g", "t"], label: "go to templates" },
  { keys: ["⌘", "k"], label: "command palette" },
  { keys: ["?"], label: "this cheat sheet" },
];

// True when keystrokes should be ignored (user is typing in a field).
function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable
  );
}

export function GlobalHotkeys() {
  const router = useRouter();
  const [cheatOpen, setCheatOpen] = useState(false);
  // Tracks a pending "g" chord prefix and when it expires.
  const chordPrefix = useRef<string | null>(null);
  const chordTimer = useRef<NodeJS.Timeout | null>(null);

  const clearChord = useCallback(() => {
    chordPrefix.current = null;
    if (chordTimer.current) {
      clearTimeout(chordTimer.current);
      chordTimer.current = null;
    }
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Never hijack the existing Cmd/Ctrl+K palette or other modified combos.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Ignore while typing in a field.
      if (isEditableTarget(e.target)) return;

      if (e.key === "Escape") {
        setCheatOpen(false);
        clearChord();
        return;
      }

      // Resolve a pending chord (e.g. "g" then "d").
      if (chordPrefix.current === "g") {
        const map: Record<string, string> = { d: "/dashboard", a: "/analytics", t: "/templates" };
        const dest = map[e.key.toLowerCase()];
        clearChord();
        if (dest) {
          e.preventDefault();
          router.push(dest);
        }
        return;
      }

      // Start a "g" chord.
      if (e.key === "g") {
        e.preventDefault();
        chordPrefix.current = "g";
        chordTimer.current = setTimeout(clearChord, 1200);
        return;
      }

      // Single-key shortcuts.
      if (e.key === "c") {
        e.preventDefault();
        router.push("/simulations/new");
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        setCheatOpen((o) => !o);
        return;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (chordTimer.current) clearTimeout(chordTimer.current);
    };
  }, [router, clearChord]);

  if (!cheatOpen) return null;

  return (
    <div className="fixed inset-0 z-[100]" onClick={() => setCheatOpen(false)}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Dialog */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-[var(--surface-bg)] border border-white/10 shadow-2xl">
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
            <Command className="w-3.5 h-3.5 text-white/30" />
            <span className="text-xs font-medium text-white/70 tracking-wide">keyboard shortcuts</span>
            <button
              onClick={() => setCheatOpen(false)}
              className="ml-auto text-white/25 hover:text-white/60 transition-colors"
              aria-label="close"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Shortcut list */}
          <div className="py-2">
            {SHORTCUTS.map((s) => (
              <div key={s.label} className="flex items-center justify-between px-4 py-2">
                <span className="text-xs text-white/50">{s.label}</span>
                <div className="flex items-center gap-1">
                  {s.keys.map((k, i) => (
                    <kbd
                      key={i}
                      className="text-[10px] min-w-[20px] text-center px-1.5 py-0.5 border border-white/10 text-white/40 bg-white/[0.02]"
                    >
                      {k}
                    </kbd>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-white/[0.06] text-[10px] text-white/15">
            press <kbd className="px-1 py-0.5 border border-white/10 text-white/30">?</kbd> anywhere to toggle this
          </div>
        </div>
      </div>
    </div>
  );
}
