"use client";

export const dynamic = 'force-dynamic';

import { useState, useEffect } from "react";
import { onAuthChange } from "@/lib/firebase/auth";
import { useToast } from "@/components/ui/toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  User, Bell, Palette, Key, Shield, Download, Trash2, Check, Copy, Eye, EyeOff,
} from "lucide-react";

type SettingsTab = "account" | "preferences" | "api" | "notifications" | "danger";

const tabs: { id: SettingsTab; label: string; icon: typeof User }[] = [
  { id: "account", label: "account", icon: User },
  { id: "preferences", label: "preferences", icon: Palette },
  { id: "api", label: "API & integrations", icon: Key },
  { id: "notifications", label: "notifications", icon: Bell },
  { id: "danger", label: "danger zone", icon: Shield },
];

export default function SettingsPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<SettingsTab>("account");
  const [user, setUser] = useState<any>(null);

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
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthChange((u) => {
      if (u) {
        setUser(u);
        setDisplayName(u.displayName || "");
        setEmail(u.email || "");
      }
    });
    return () => unsubscribe();
  }, []);

  function handleSave() {
    toast({ title: "Settings saved", variant: "success" });
  }

  function handleCopyApiKey() {
    navigator.clipboard.writeText("sk-sylor-demo-xxxxxxxxxxxx");
    toast({ title: "API key copied to clipboard" });
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

              <button onClick={handleSave} className="btn-primary text-xs py-2 px-6">
                <Check className="w-3 h-3" /> save changes
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

              <button onClick={handleSave} className="btn-primary text-xs py-2 px-6">
                <Check className="w-3 h-3" /> save preferences
              </button>
            </div>
          )}

          {/* API */}
          {activeTab === "api" && (
            <div className="space-y-6 animate-fade-in">
              <div>
                <h2 className="text-sm font-semibold text-white mb-1">API & integrations</h2>
                <p className="text-[11px] text-white/25">manage API keys and third-party integrations</p>
              </div>

              <div className="surface p-5 space-y-4">
                <h3 className="text-xs font-semibold text-white/60 tracking-widest uppercase">API key</h3>
                <p className="text-[11px] text-white/25">
                  Use this key to access the Sylor API programmatically. Keep it secret.
                </p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-white/[0.02] border border-white/[0.06] px-3 py-2 font-mono text-xs text-white/40">
                    {showApiKey ? "sk-sylor-demo-xxxxxxxxxxxx" : "sk-sylor-•••••••••••••"}
                  </div>
                  <button
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="p-2 border border-white/[0.06] text-white/30 hover:text-white/60 hover:bg-white/[0.03] transition-colors"
                  >
                    {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={handleCopyApiKey}
                    className="p-2 border border-white/[0.06] text-white/30 hover:text-white/60 hover:bg-white/[0.03] transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
                <button className="btn-ghost text-xs py-1.5 px-4">
                  <Key className="w-3 h-3" /> regenerate key
                </button>
              </div>

              <div className="surface p-5 space-y-4">
                <h3 className="text-xs font-semibold text-white/60 tracking-widest uppercase">API usage</h3>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <div className="text-xl font-bold text-white">0</div>
                    <div className="text-[10px] text-white/25">requests today</div>
                  </div>
                  <div>
                    <div className="text-xl font-bold text-white">0</div>
                    <div className="text-[10px] text-white/25">this month</div>
                  </div>
                  <div>
                    <div className="text-xl font-bold text-white">1,000</div>
                    <div className="text-[10px] text-white/25">monthly limit</div>
                  </div>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: "0%" }} />
                </div>
              </div>

              <div className="surface p-5 space-y-3">
                <h3 className="text-xs font-semibold text-white/60 tracking-widest uppercase">webhooks</h3>
                <p className="text-[11px] text-white/25">
                  Get notified when simulations complete. Send results to Slack, Zapier, or your own endpoint.
                </p>
                <div>
                  <Label className="text-xs text-white/50">Webhook URL</Label>
                  <Input className="mt-1" placeholder="https://hooks.slack.com/..." />
                </div>
                <button onClick={handleSave} className="btn-ghost text-xs py-1.5 px-4">save webhook</button>
              </div>

              <div className="surface p-5 space-y-3">
                <h3 className="text-xs font-semibold text-white/60 tracking-widest uppercase">data export</h3>
                <p className="text-[11px] text-white/25">
                  Export all your simulation data in machine-readable formats.
                </p>
                <div className="flex gap-2">
                  <button className="btn-ghost text-xs py-1.5 px-4">
                    <Download className="w-3 h-3" /> export as JSON
                  </button>
                  <button className="btn-ghost text-xs py-1.5 px-4">
                    <Download className="w-3 h-3" /> export as CSV
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

              <button onClick={handleSave} className="btn-primary text-xs py-2 px-6">
                <Check className="w-3 h-3" /> save notification settings
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

              <div className="border border-red-500/20 p-5 space-y-4 bg-red-500/[0.02]">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-white">Delete all simulations</div>
                    <div className="text-[11px] text-white/25">Permanently remove all your simulations and results</div>
                  </div>
                  <button className="text-xs py-1.5 px-4 border border-red-500/30 text-red-400/70 hover:bg-red-500/10 transition-colors">
                    <Trash2 className="w-3 h-3 inline mr-1.5" /> delete all
                  </button>
                </div>

                <div className="border-t border-red-500/10" />

                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-white">Delete account</div>
                    <div className="text-[11px] text-white/25">Permanently delete your account and all associated data</div>
                  </div>
                  <button className="text-xs py-1.5 px-4 border border-red-500/30 text-red-400/70 hover:bg-red-500/10 transition-colors">
                    <Trash2 className="w-3 h-3 inline mr-1.5" /> delete account
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
