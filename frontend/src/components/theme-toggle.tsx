"use client";

import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/components/theme-provider";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className={`relative inline-flex items-center gap-2 px-2 py-1.5 text-xs transition-colors rounded ${
        theme === "dark"
          ? "text-white/30 hover:text-white/60 hover:bg-white/[0.04]"
          : "text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100"
      } ${className}`}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
    >
      {theme === "dark" ? (
        <Sun className="w-3.5 h-3.5" />
      ) : (
        <Moon className="w-3.5 h-3.5" />
      )}
    </button>
  );
}

/**
 * A pill-style toggle for more prominent placement (e.g. navbar, settings).
 */
export function ThemeTogglePill({ className = "" }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className={`relative flex items-center w-11 h-6 rounded-full transition-colors duration-200 ${
        theme === "dark" ? "bg-white/[0.1]" : "bg-neutral-200"
      } ${className}`}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
    >
      <span
        className={`absolute top-0.5 flex items-center justify-center w-5 h-5 rounded-full transition-all duration-200 ${
          theme === "dark"
            ? "left-[1.375rem] bg-white/20"
            : "left-0.5 bg-[#ffffff] shadow-sm"
        }`}
      >
        {theme === "dark" ? (
          <Moon className="w-3 h-3 text-white/60" />
        ) : (
          <Sun className="w-3 h-3 text-amber-500" />
        )}
      </span>
    </button>
  );
}
