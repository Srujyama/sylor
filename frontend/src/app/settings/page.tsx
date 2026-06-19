"use client";

export const dynamic = 'force-dynamic';

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { onAuthChange, logOut } from "@/lib/firebase/auth";
import { getDocument, updateDocument } from "@/lib/firebase/firestore";
import { useToast } from "@/components/ui/toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/utils";
import { getUserUsage, exportSimulations, deleteCurrentUser } from "@/lib/api";
import type { UserUsage } from "@/types";
import type { User as FirebaseUser } from "firebase/auth";
import {
  User, Bell, Palette, BarChart2, Shield, Download, Trash2, Check, Loader2, LogOut,
} from "lucide-react";

type SettingsTab = "account" | "preferences" | "usage" | "notifications" | "danger";

const tabs: { id: SettingsTab; label: string; icon: typeof User }[] = [
  { id: "account", label: "account", icon: User },
  { id: "preferences", label: "preferences", icon: Palette },
  { id: "usage", label: "usage & data", icon: BarChart2 },
  { id: "notifications", label: "notifications", icon: Bell },
  { id: "danger", label: "danger zone", icon: Shield },
];

export default function SettingsPage() {
  const { toast } = useToast();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<SettingsTab>("account");
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Form states
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [defaultRuns, setDefaultRuns] = useState("1000");
  const [defaultHorizon, setDefaultHorizon] = useState("12");
  const [autoRunOnCreate, setAutoRunOnCreate] = useState(true);
  const [showInsightsPanel, setShowInsightsPanel] = useState(true);
  const [darkCharts, setDarkCharts] = useState(true);
  const [compactMode, setCompactMode] = useState(false);
  const [emailOnComplete, setEmailOnComplete] = useState(true);
  const [emailOnFail, setEmailOnFail] = useState(true);
  const [weeklyDigest, setWeeklyDigest] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [usage, setUsage] = useState<UserUsage | null>(null);
  const [usageLoading, setUsageLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthChange(async (u) => {
      if (u) {
        setUser(u);
        setDisplayName(u.displayName || "");
        setEmail(u.email || "");
        // Load real usage stats from the API
        getUserUsage()
          .then((data) => setUsage(data))
          .catch((err: any) => {
            toast({ title: "Failed to load usage data", description: err.message, variant: "error" });
          })
          .finally(() => setUsageLoading(false));
        // Load saved preferences from Firestore
        const profile = await getDocument("profiles", u.uid);
        if (profile) {
          const prefs = (profile as any).preferences || {};
          const notifs = (profile as any).notifications || {};
          if (prefs.defaultRuns) setDefaultRuns(String(prefs.defaultRuns));
          if (prefs.defaultHorizon) setDefaultHorizon(String(prefs.defaultHorizon));
          if (prefs.autoRunOnCreate !== undefined) setAutoRunOnCreate(prefs.autoRunOnCreate);
          if (prefs.showInsightsPanel !== undefined) setShowInsightsPanel(prefs.showInsightsPanel);
          if (prefs.darkCharts !== undefined) setDarkCharts(prefs.darkCharts);
          if (prefs.compactMode !== undefined) setCompactMode(prefs.compactMode);
          if (notifs.emailOnComplete !== undefined) setEmailOnComplete(notifs.emailOnComplete);
          if (notifs.emailOnFail !== undefined) setEmailOnFail(notifs.emailOnFail);
          if (notifs.weeklyDigest !== undefined) setWeeklyDigest(notifs.weeklyDigest);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  async function handleSave() {
    if (!user) return;
    setSaving(true);
    try {
      await updateDocument("profiles", user.uid, {
        fullName: displayName,
        preferences: {
          defaultRuns: parseInt(defaultRuns) || 1000,
          defaultHorizon: parseInt(defaultHorizon) || 12,
          autoRunOnCreate,
          showInsightsPanel,
          darkCharts,
          compactMode,
        },
        notifications: {
          emailOnComplete,
          emailOnFail,
          weeklyDigest,
        },
      });
      toast({ title: "Settings saved", variant: "success" });
    } catch {
      toast({ title: "Failed to save settings", variant: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function handleExport(format: "json" | "csv") {
    if (!user) return;
    setExporting(true);
    try {
      const blob = await exportSimulations(format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `simulations.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: `Exported as ${format.toUpperCase()}` });
    } catch {
      toast({ title: "Export failed", variant: "error" });
    } finally {
      setExporting(false);
    }
  }

  async function handleLogout() {
    try {
      await logOut();
      router.push("/login");
    } catch {
      toast({ title: "Failed to sign out", variant: "error" });
    }
  }

  async function handleDeleteAccount() {
    if (!user) return;
    const confirmed = window.confirm(
      "This will permanently delete your account and ALL data. This cannot be undone. Are you sure?"
    );
    if (!confirmed) return;

    setDeleting(true);
    try {
      await deleteCurrentUser();
      await logOut();
      router.push("/login");
    } catch {
      toast({ title: "Failed to delete account", variant: "error" });
      setDeleting(false);
    }
  }

  return (
    <div className="p-8 max-w-4xl">
      {/* Header */}
      <div className="mb-8">
        <p className="text-xs text-white/25 mb-1 tracking-wide">sylor / settings</p>
        <h1 className="text-2xl font-bold text-white tracking-tight">settings</h1>
      </div>

      <div className="flex gap-8">
        {/* Tab sidebar */}
        <div className="w-48 shrink-0">
          <nav className="space-y-0.5">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium transition-colors text-left ${
                  activeTab === tab.id
                    ? "bg-white/[0.06] text-white"
                    : "text-white/35 hover:text-white/70 hover:bg-white/[0.03]"
                }`}
              >
                <tab.icon className={`w-3.5 h-3.5 shrink-0 ${activeTab === tab.id ? "text-white" : "text-white/30"}`} />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Account */}
          {activeTab === "account" && (
            <div className="space-y-6 animate-fade-in">
              <div>
                <h2 className="text-sm font-semibold text-white mb-1">account information</h2>
                <p className="text-[11px] text-white/25">manage your profile and login details</p>
              </div>

              <div className="surface p-5 space-y-4">
                <div className="flex items-center gap-4 pb-4 border-b border-white/[0.06]">
                  <div className="w-12 h-12 bg-white/[0.06] flex items-center justify-center text-sm font-bold text-white/40">
                    {displayName ? displayName[0].toUpperCase() : "?"}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-white">{displayName || "Anonymous"}</div>
                    <div className="text-xs text-white/30">{email}</div>
                  </div>
                  <span className="tag tag-green ml-auto">free plan</span>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs text-white/50">Display Name</Label>
                    <Input className="mt-1" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs text-white/50">Email</Label>
                    <Input className="mt-1" value={email} disabled />
                  </div>
                </div>

                <div>
                  <Label className="text-xs text-white/50">User ID</Label>
                  <div className="mt-1 text-xs text-white/20 font-mono bg-white/[0.02] border border-white/[0.06] px-3 py-2">
                    {user?.uid || "demo-user"}
                  </div>
                </div>
              </div>

              <div className="surface p-5">
                <h3 className="text-xs font-semibold text-white mb-3">subscription</h3>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-white">Free Plan</div>
                    <div className="text-[11px] text-white/25">5 simulations/month · 100 runs/sim</div>
                  </div>
                  <button className="btn-primary text-xs py-1.5 px-4">upgrade to pro</button>
                </div>
              </div>

              <button onClick={handleSave} disabled={saving} className="btn-primary text-xs py-2 px-6">
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} save changes
              </button>
            </div>
          )}

          {/* Preferences */}
          {activeTab === "preferences" && (
            <div className="space-y-6 animate-fade-in">
              <div>
                <h2 className="text-sm font-semibold text-white mb-1">preferences</h2>
                <p className="text-[11px] text-white/25">customize your simulation experience</p>
              </div>

              <div className="surface p-5 space-y-4">
                <h3 className="text-xs font-semibold text-white/60 tracking-widest uppercase">simulation defaults</h3>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs text-white/50">Default Monte Carlo Runs</Label>
                    <Input className="mt-1" type="number" value={defaultRuns} onChange={(e) => setDefaultRuns(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs text-white/50">Default Time Horizon (months)</Label>
                    <Input className="mt-1" type="number" value={defaultHorizon} onChange={(e) => setDefaultHorizon(e.target.value)} />
                  </div>
                </div>

                <ToggleRow
                  label="Auto-run simulation on create"
                  description="Automatically start running the simulation after creation"
                  checked={autoRunOnCreate}
                  onChange={setAutoRunOnCreate}
                />
              </div>

              <div className="surface p-5 space-y-4">
                <h3 className="text-xs font-semibold text-white/60 tracking-widest uppercase">display</h3>

                <ToggleRow
                  label="Show AI insights panel"
                  description="Display AI-generated insights alongside simulation results"
                  checked={showInsightsPanel}
                  onChange={setShowInsightsPanel}
                />

                <ToggleRow
                  label="Dark chart theme"
                  description="Use dark backgrounds for all charts and visualizations"
                  checked={darkCharts}
                  onChange={setDarkCharts}
                />

                <ToggleRow
                  label="Compact mode"
                  description="Reduce spacing and padding for denser information display"
                  checked={compactMode}
                  onChange={setCompactMode}
                />
              </div>

              <button onClick={handleSave} disabled={saving} className="btn-primary text-xs py-2 px-6">
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} save preferences
              </button>
            </div>
          )}

          {/* Usage & data */}
          {activeTab === "usage" && (
            <div className="space-y-6 animate-fade-in">
              <div>
                <h2 className="text-sm font-semibold text-white mb-1">usage & data</h2>
                <p className="text-[11px] text-white/25">your simulation activity and data exports</p>
              </div>

              <div className="surface p-5 space-y-4">
                <h3 className="text-xs font-semibold text-white/60 tracking-widest uppercase">usage</h3>
                {usageLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="w-4 h-4 animate-spin text-white/20" />
                  </div>
                ) : usage ? (
                  <>
                    <div className="grid grid-cols-4 gap-4">
                      <div>
                        <div className="text-xl font-bold text-white">{usage.total_simulations}</div>
                        <div className="text-[10px] text-white/25">total simulations</div>
                      </div>
                      <div>
                        <div className="text-xl font-bold text-white">{usage.completed_simulations}</div>
                        <div className="text-[10px] text-white/25">completed</div>
                      </div>
                      <div>
                        <div className="text-xl font-bold text-white">{usage.total_runs.toLocaleString()}</div>
                        <div className="text-[10px] text-white/25">monte carlo runs</div>
                      </div>
                      <div>
                        <div className="text-xl font-bold text-white">{usage.avg_success_rate}%</div>
                        <div className="text-[10px] text-white/25">avg success rate</div>
                      </div>
                    </div>
                    <div className="progress-bar">
                      <div
                        className="progress-fill"
                        style={{
                          width: `${
                            usage.total_simulations > 0
                              ? Math.round((usage.completed_simulations / usage.total_simulations) * 100)
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                    {usage.categories_used.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {usage.categories_used.map((c) => (
                          <span key={c} className="tag text-[10px]">{c}</span>
                        ))}
                      </div>
                    )}
                    {usage.last_active && (
                      <div className="text-[10px] text-white/20">last active {formatDate(usage.last_active)}</div>
                    )}
                  </>
                ) : (
                  <div className="text-[11px] text-white/25">usage data unavailable</div>
                )}
              </div>

              <div className="surface p-5 space-y-3">
                <h3 className="text-xs font-semibold text-white/60 tracking-widest uppercase">data export</h3>
                <p className="text-[11px] text-white/25">
                  Export all your simulation data in machine-readable formats.
                </p>
                <div className="flex gap-2">
                  <button onClick={() => handleExport("json")} disabled={exporting} className="btn-ghost text-xs py-1.5 px-4">
                    {exporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />} export as JSON
                  </button>
                  <button onClick={() => handleExport("csv")} disabled={exporting} className="btn-ghost text-xs py-1.5 px-4">
                    {exporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />} export as CSV
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Notifications */}
          {activeTab === "notifications" && (
            <div className="space-y-6 animate-fade-in">
              <div>
                <h2 className="text-sm font-semibold text-white mb-1">notifications</h2>
                <p className="text-[11px] text-white/25">choose what you want to be notified about</p>
              </div>

              <div className="surface p-5 space-y-4">
                <h3 className="text-xs font-semibold text-white/60 tracking-widest uppercase">email notifications</h3>

                <ToggleRow
                  label="Simulation completed"
                  description="Get an email when your simulation finishes running"
                  checked={emailOnComplete}
                  onChange={setEmailOnComplete}
                />

                <ToggleRow
                  label="Simulation failed"
                  description="Get notified if a simulation encounters an error"
                  checked={emailOnFail}
                  onChange={setEmailOnFail}
                />

                <ToggleRow
                  label="Weekly digest"
                  description="Receive a weekly summary of your simulation activity"
                  checked={weeklyDigest}
                  onChange={setWeeklyDigest}
                />
              </div>

              <button onClick={handleSave} disabled={saving} className="btn-primary text-xs py-2 px-6">
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} save notification settings
              </button>
            </div>
          )}

          {/* Danger Zone */}
          {activeTab === "danger" && (
            <div className="space-y-6 animate-fade-in">
              <div>
                <h2 className="text-sm font-semibold text-white mb-1">danger zone</h2>
                <p className="text-[11px] text-white/25">irreversible actions — proceed with caution</p>
              </div>

              {/* Sign out */}
              <div className="surface p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-white">Sign out</div>
                    <div className="text-[11px] text-white/25">Sign out of your account on this device</div>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="text-xs py-1.5 px-4 border border-white/10 text-white/50 hover:bg-white/[0.05] transition-colors"
                  >
                    <LogOut className="w-3 h-3 inline mr-1.5" /> sign out
                  </button>
                </div>
              </div>

              <div className="border border-red-500/20 p-5 space-y-4 bg-red-500/[0.02]">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-white">Delete account</div>
                    <div className="text-[11px] text-white/25">Permanently delete your account and all associated data</div>
                  </div>
                  <button
                    onClick={handleDeleteAccount}
                    disabled={deleting}
                    className="text-xs py-1.5 px-4 border border-red-500/30 text-red-400/70 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                  >
                    {deleting ? <Loader2 className="w-3 h-3 inline mr-1.5 animate-spin" /> : <Trash2 className="w-3 h-3 inline mr-1.5" />}
                    {deleting ? "deleting..." : "delete account"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Toggle row component
function ToggleRow({
  label, description, checked, onChange,
}: {
  label: string; description: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/[0.04] last:border-0">
      <div>
        <div className="text-xs text-white/70">{label}</div>
        <div className="text-[10px] text-white/25">{description}</div>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 transition-colors ${
          checked ? "bg-white/20" : "bg-white/[0.06]"
        }`}
      >
        <div
          className={`absolute top-0.5 w-4 h-4 bg-white transition-transform ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
