"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Search, LayoutDashboard, Layers, BarChart3, LayoutTemplate,
  BookOpen, Settings, Plus, ArrowRight, Command,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface CommandItem {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  action: () => void;
  section: string;
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands: CommandItem[] = [
    { id: "new-sim", label: "New Simulation", description: "Create a new Monte Carlo simulation", icon: Plus, action: () => router.push("/simulations/new"), section: "Actions" },
    { id: "dashboard", label: "Dashboard", description: "Go to dashboard", icon: LayoutDashboard, action: () => router.push("/dashboard"), section: "Navigation" },
    { id: "simulations", label: "Simulations", description: "View all simulations", icon: Layers, action: () => router.push("/simulations"), section: "Navigation" },
    { id: "analytics", label: "Analytics", description: "View analytics & insights", icon: BarChart3, action: () => router.push("/analytics"), section: "Navigation" },
    { id: "templates", label: "Templates", description: "Browse simulation templates", icon: LayoutTemplate, action: () => router.push("/templates"), section: "Navigation" },
    { id: "docs", label: "Documentation", description: "Read the docs", icon: BookOpen, action: () => router.push("/docs"), section: "Navigation" },
    { id: "settings", label: "Settings", description: "Account & preferences", icon: Settings, action: () => router.push("/settings"), section: "Navigation" },
    { id: "startup-template", label: "SaaS Launch Template", description: "Start with SaaS launch template", icon: Plus, action: () => router.push("/simulations/new?template=startup"), section: "Quick Start" },
    { id: "finance-template", label: "Stock Portfolio Template", description: "Start with finance template", icon: Plus, action: () => router.push("/simulations/new?template=finance"), section: "Quick Start" },
    { id: "biology-template", label: "Molecular Dynamics Template", description: "Start with biology template", icon: Plus, action: () => router.push("/simulations/new?template=biology"), section: "Quick Start" },
  ];

  const filtered = query.trim()
    ? commands.filter((c) =>
        c.label.toLowerCase().includes(query.toLowerCase()) ||
        c.description.toLowerCase().includes(query.toLowerCase())
      )
    : commands;

  const sections = Array.from(new Set(filtered.map((c) => c.section)));

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
        setQuery("");
        setSelectedIndex(0);
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
      const item = filtered[index];
      if (item) {
        item.action();
        setOpen(false);
        setQuery("");
      }
    },
    [filtered]
  );

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1));
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
              placeholder="Search commands..."
              className="flex-1 bg-transparent text-sm text-white/80 placeholder:text-white/20 outline-none"
            />
            <kbd className="text-[10px] px-1.5 py-0.5 border border-white/10 text-white/20">esc</kbd>
          </div>

          {/* Results */}
          <div className="max-h-[320px] overflow-y-auto py-2">
            {filtered.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-white/20">
                No results found
              </div>
            ) : (
              sections.map((section) => (
                <div key={section}>
                  <div className="px-4 py-1.5 text-[10px] text-white/20 uppercase tracking-wider">
                    {section}
                  </div>
                  {filtered
                    .filter((c) => c.section === section)
                    .map((cmd) => {
                      flatIndex++;
                      const idx = flatIndex;
                      return (
                        <button
                          key={cmd.id}
                          onClick={() => handleSelect(idx)}
                          onMouseEnter={() => setSelectedIndex(idx)}
                          className={cn(
                            "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                            idx === selectedIndex
                              ? "bg-white/[0.06] text-white"
                              : "text-white/50 hover:bg-white/[0.03]"
                          )}
                        >
                          <cmd.icon className="w-4 h-4 shrink-0 text-white/30" />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium">{cmd.label}</div>
                            <div className="text-[10px] text-white/20 truncate">{cmd.description}</div>
                          </div>
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
