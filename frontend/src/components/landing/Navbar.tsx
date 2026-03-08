"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handler);
    return () => window.removeEventListener("scroll", handler);
  }, []);

  const navLinks = [
    { label: "features", href: "#features" },
    { label: "how it works", href: "#how-it-works" },
    { label: "templates", href: "#templates" },
    { label: "pricing", href: "#pricing" },
  ];

  return (
    <nav
      className={cn(
        "fixed top-0 left-0 right-0 z-50 transition-all duration-200",
        scrolled
          ? "bg-[#0a0a0a]/95 backdrop-blur-sm border-b border-white/[0.06]"
          : "bg-transparent"
      )}
    >
      <div className="max-w-6xl mx-auto px-6">
        <div className="flex items-center justify-between h-14">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-5 h-5 bg-white flex items-center justify-center shrink-0">
              <span className="text-[8px] font-black text-black tracking-widest">SY</span>
            </div>
            <span className="text-sm font-semibold text-white tracking-tight">sylor</span>
          </Link>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-7">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-xs text-white/35 hover:text-white/75 transition-colors tracking-wide"
              >
                {link.label}
              </a>
            ))}
          </div>

          {/* CTA */}
          <div className="hidden md:flex items-center gap-2">
            <Link
              href="/login"
              className="text-xs text-white/35 hover:text-white/70 transition-colors px-3 py-1.5"
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
            className="md:hidden text-white/40 hover:text-white transition-colors"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden bg-[#0a0a0a] border-b border-white/[0.06] px-6 py-4">
          <div className="flex flex-col gap-3">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-xs text-white/40 hover:text-white/80 transition-colors py-1"
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </a>
            ))}
            <div className="flex gap-2 pt-3 border-t border-white/[0.06]">
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
