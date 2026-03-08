"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, Plus, Layers, History, Settings, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { logOut } from "@/lib/firebase/auth";

const navItems = [
  { label: "dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "simulations", href: "/simulations", icon: Layers },
  { label: "history", href: "/simulations?filter=completed", icon: History },
  { label: "settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await logOut();
    router.push("/");
  }

  return (
    <aside className="w-52 min-h-screen flex flex-col border-r border-white/[0.06] bg-[#0c0c0c]">
      {/* Logo */}
      <div className="px-5 py-4 border-b border-white/[0.06]">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <div className="w-5 h-5 bg-white flex items-center justify-center shrink-0">
            <span className="text-[8px] font-black text-black tracking-widest">SY</span>
          </div>
          <span className="text-sm font-semibold text-white tracking-tight">sylor</span>
        </Link>
      </div>

      {/* New simulation CTA */}
      <div className="px-4 py-3 border-b border-white/[0.06]">
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
            (item.href === "/simulations" && pathname.startsWith("/simulations") && !pathname.includes("?filter=completed")) ||
            (item.href === "/simulations?filter=completed" && pathname.includes("?filter=completed"));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 text-xs font-medium transition-colors",
                active
                  ? "bg-white/[0.06] text-white"
                  : "text-white/35 hover:text-white/70 hover:bg-white/[0.03]"
              )}
            >
              <item.icon className={cn("w-3.5 h-3.5 shrink-0", active ? "text-white" : "text-white/30")} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="px-2 py-3 border-t border-white/[0.06]">
        <button
          onClick={handleLogout}
          className="flex items-center gap-2.5 px-3 py-2 text-xs text-white/25 hover:text-white/60 hover:bg-white/[0.03] transition-colors w-full"
        >
          <LogOut className="w-3.5 h-3.5 shrink-0" />
          sign out
        </button>
      </div>
    </aside>
  );
}
