"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard, Plus, Layers, LayoutTemplate, BookOpen, Settings, LogOut,
  BarChart3, Search, Network, FolderKanban, FileText, Sun, Moon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { logOut } from "@/lib/firebase/auth";
import { useTheme } from "@/components/theme-provider";

const navItems = [
  { label: "dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "projects", href: "/projects", icon: FolderKanban },
  { label: "simulations", href: "/simulations", icon: Layers },
  { label: "knowledge graphs", href: "/graphs", icon: Network },
  { label: "reports", href: "/reports", icon: FileText },
  { label: "analytics", href: "/analytics", icon: BarChart3 },
  { label: "templates", href: "/templates", icon: LayoutTemplate },
  { label: "docs", href: "/docs", icon: BookOpen },
  { label: "settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();

  async function handleLogout() {
    await logOut();
    router.push("/");
  }

  return (
    <aside className="w-52 min-h-screen flex flex-col border-r bg-[var(--sidebar-bg)] border-[var(--sidebar-border)] transition-colors duration-200">
      {/* Logo */}
      <div className="px-5 py-4 border-b border-[var(--sidebar-border)]">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <div className="w-5 h-5 bg-[var(--btn-primary-bg)] flex items-center justify-center shrink-0">
            <span className="text-[8px] font-black text-[var(--btn-primary-text)] tracking-widest">SY</span>
          </div>
          <span className="text-sm font-semibold text-[var(--page-text)] tracking-tight">sylor</span>
        </Link>
      </div>

      {/* New simulation CTA */}
      <div className="px-4 py-3 border-b border-[var(--sidebar-border)]">
        <Link
          href="/simulations/new"
          className="btn-primary w-full justify-center text-xs py-2"
        >
          <Plus className="w-3 h-3" />
          new simulation
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5">
        {navItems.map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== "/dashboard" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 text-xs font-medium transition-colors rounded-sm",
                active
                  ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-text-active)]"
                  : "text-[var(--sidebar-text)] hover:text-[var(--sidebar-text-active)] hover:bg-[var(--sidebar-active-bg)]"
              )}
            >
              <item.icon className={cn("w-3.5 h-3.5 shrink-0", active ? "text-[var(--sidebar-text-active)]" : "text-[var(--sidebar-text)]")} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="px-2 py-3 border-t border-[var(--sidebar-border)] space-y-0.5">
        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="flex items-center gap-2.5 px-3 py-2 text-xs text-[var(--sidebar-text)] hover:text-[var(--sidebar-text-active)] hover:bg-[var(--sidebar-active-bg)] transition-colors w-full rounded-sm"
        >
          {theme === "dark" ? (
            <Sun className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <Moon className="w-3.5 h-3.5 shrink-0" />
          )}
          <span className="flex-1 text-left">{theme === "dark" ? "light mode" : "dark mode"}</span>
        </button>
        <button
          onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
          className="flex items-center gap-2.5 px-3 py-2 text-xs text-[var(--sidebar-text)] hover:text-[var(--sidebar-text-active)] hover:bg-[var(--sidebar-active-bg)] transition-colors w-full rounded-sm"
        >
          <Search className="w-3.5 h-3.5 shrink-0" />
          <span className="flex-1 text-left">search</span>
          <kbd className="text-[9px] px-1 py-0.5 border border-[var(--sidebar-border)] text-[var(--sidebar-text)]">⌘K</kbd>
        </button>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2.5 px-3 py-2 text-xs text-[var(--sidebar-text)] hover:text-[var(--sidebar-text-active)] hover:bg-[var(--sidebar-active-bg)] transition-colors w-full rounded-sm"
        >
          <LogOut className="w-3.5 h-3.5 shrink-0" />
          sign out
        </button>
      </div>
    </aside>
  );
}
