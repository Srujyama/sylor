"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Menu, X, Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme-provider";

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handler);
    return () => window.removeEventListener("scroll", handler);
  }, []);

  const navLinks = [
    { label: "features", href: "#features" },
    { label: "domains", href: "#domains" },
    { label: "templates", href: "#templates" },
    { label: "pricing", href: "#pricing" },
    { label: "docs", href: "/docs" },
    { label: "changelog", href: "/changelog" },
  ];

  return (
    <nav
      className={cn(
        "fixed top-0 left-0 right-0 z-50 transition-all duration-200",
        scrolled
          ? "bg-[var(--page-bg)]/95 backdrop-blur-sm border-b border-[var(--surface-border)]"
          : "bg-transparent"
      )}
    >
      <div className="max-w-[1440px] mx-auto px-8">
        <div className="flex items-center justify-between h-14">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-5 h-5 bg-[var(--btn-primary-bg)] flex items-center justify-center shrink-0">
              <span className="text-[8px] font-black text-[var(--btn-primary-text)] tracking-widest">SY</span>
            </div>
            <span className="text-sm font-semibold text-[var(--page-text)] tracking-tight">sylor</span>
          </Link>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-7">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-xs text-[var(--page-text-dim)] hover:text-[var(--page-text)] transition-colors tracking-wide"
              >
                {link.label}
              </a>
            ))}
          </div>

          {/* CTA + Theme Toggle */}
          <div className="hidden md:flex items-center gap-2">
            <button
              onClick={toggleTheme}
              className="p-1.5 text-[var(--page-text-dim)] hover:text-[var(--page-text)] transition-colors"
              aria-label="Toggle theme"
            >
              {theme === "dark" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            </button>
            <Link
              href="/login"
              className="text-xs text-[var(--page-text-dim)] hover:text-[var(--page-text)] transition-colors px-3 py-1.5"
            >
              sign in
            </Link>
            <Link
              href="/signup"
              className="btn-primary text-xs py-1.5 px-4"
            >
              get started
            </Link>
          </div>

          {/* Mobile button */}
          <button
            className="md:hidden text-[var(--page-text-dim)] hover:text-[var(--page-text)] transition-colors"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden bg-[var(--page-bg)] border-b border-[var(--surface-border)] px-6 py-4">
          <div className="flex flex-col gap-3">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-xs text-[var(--page-text-dim)] hover:text-[var(--page-text)] transition-colors py-1"
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </a>
            ))}
            <button
              onClick={toggleTheme}
              className="flex items-center gap-2 text-xs text-[var(--page-text-dim)] hover:text-[var(--page-text)] transition-colors py-1"
            >
              {theme === "dark" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              {theme === "dark" ? "light mode" : "dark mode"}
            </button>
            <div className="flex gap-2 pt-3 border-t border-[var(--surface-border)]">
              <Link href="/login" className="btn-ghost text-xs flex-1 justify-center py-2">
                sign in
              </Link>
              <Link href="/signup" className="btn-primary text-xs flex-1 justify-center py-2">
                get started
              </Link>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
