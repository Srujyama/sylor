"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Activity, LayoutDashboard, Plus, Layers, History, Settings, LogOut, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { logOut } from "@/lib/firebase/auth";
import { Button } from "@/components/ui/button";

const navItems = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Simulations", href: "/simulations", icon: Layers },
  { label: "History", href: "/simulations?filter=completed", icon: History },
  { label: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await logOut();
    router.push("/");
  }

  return (
    <aside className="w-64 min-h-screen flex flex-col border-r border-white/10 bg-black/20 backdrop-blur-xl">
      {/* Logo */}
      <div className="p-6 border-b border-white/10">
        <Link href="/dashboard" className="flex items-center gap-2 group">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center group-hover:scale-110 transition-transform">
            <Activity className="w-4 h-4 text-white" />
          </div>
          <span className="text-lg font-bold gradient-text">SimWorld</span>
        </Link>
      </div>

      {/* New simulation CTA */}
      <div className="p-4">
        <Button variant="gradient" size="sm" className="w-full" asChild>
          <Link href="/simulations/new">
            <Plus className="w-4 h-4" />
            New Simulation
          </Link>
        </Button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-2 space-y-1">
        {navItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all group",
                active
                  ? "bg-violet-500/20 text-violet-400 border border-violet-500/20"
                  : "text-muted-foreground hover:text-white hover:bg-white/5"
              )}
            >
              <item.icon className={cn("w-4 h-4", active ? "text-violet-400" : "text-muted-foreground group-hover:text-white")} />
              {item.label}
              {active && <ChevronRight className="w-3 h-3 ml-auto text-violet-400" />}
            </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="p-4 border-t border-white/10">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:text-white hover:bg-white/5 transition-all w-full"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
