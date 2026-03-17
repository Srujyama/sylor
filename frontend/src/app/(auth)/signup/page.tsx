"use client";

export const dynamic = 'force-dynamic';

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Activity, ArrowLeft, Loader2, Check } from "lucide-react";
import { signUpWithEmail, signInWithGoogle, onAuthChange } from "@/lib/firebase/auth";

const benefits = [
  "5 free simulations per month",
  "Up to 100 runs per simulation",
  "6 pre-built templates",
  "No credit card required",
];

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const router = useRouter();

  // Once Firebase confirms auth state, navigate to dashboard
  useEffect(() => {
    if (!loading && !googleLoading) return;
    const unsubscribe = onAuthChange((user) => {
      if (user) {
        router.push("/dashboard");
      }
    });
    return () => unsubscribe();
  }, [loading, googleLoading, router]);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await signUpWithEmail(email, password, fullName);
      // onAuthChange listener above will redirect once Firebase confirms the user
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Sign up failed";
      setError(
        msg.includes("email-already-in-use")
          ? "An account with this email already exists"
          : msg.includes("weak-password")
          ? "Password must be at least 6 characters"
          : msg
      );
      setLoading(false);
    }
  }

  async function handleGoogleSignup() {
    setGoogleLoading(true);
    setError("");
    try {
      await signInWithGoogle();
      // onAuthChange listener above will redirect once Firebase confirms the user
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Google sign-in failed";
      setError(msg.includes("popup-closed") ? "Sign-in popup was closed" : msg);
      setGoogleLoading(false);
    }
  }

  return (
    <div className="min-h-screen animated-bg flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-white mb-8 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to home
        </Link>

        <div className="glass-card rounded-2xl p-8">
          <div className="flex items-center gap-2 mb-8">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center">
              <Activity className="w-5 h-5 text-[#ffffff]" />
            </div>
            <span className="text-xl font-bold gradient-text">SimWorld</span>
          </div>

          <h1 className="text-2xl font-bold text-white mb-1">Start simulating</h1>
          <p className="text-sm text-muted-foreground mb-4">Create your free account</p>

          {/* Benefits */}
          <div className="grid grid-cols-2 gap-2 mb-6">
            {benefits.map((b) => (
              <div key={b} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Check className="w-3 h-3 text-green-400 flex-shrink-0" />
                {b}
              </div>
            ))}
          </div>

          <Button variant="glass" className="w-full mb-4" onClick={handleGoogleSignup} disabled={googleLoading}>
            {googleLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
            )}
            Continue with Google
          </Button>

          <div className="relative mb-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-white/10" />
            </div>
            <div className="relative flex justify-center text-xs text-muted-foreground">
              <span className="px-3">or sign up with email</span>
            </div>
          </div>

          <form onSubmit={handleSignup} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Full name</Label>
              <Input placeholder="Alex Johnson" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label>Password</Label>
              <Input type="password" placeholder="8+ characters" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
            </div>

            {error && (
              <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</div>
            )}

            <Button type="submit" variant="gradient" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create free account"}
            </Button>

            <p className="text-xs text-muted-foreground text-center">
              By signing up you agree to our{" "}
              <Link href="/terms" className="text-violet-400 hover:underline">Terms</Link> and{" "}
              <Link href="/privacy" className="text-violet-400 hover:underline">Privacy Policy</Link>
            </p>
          </form>

          <p className="text-center text-sm text-muted-foreground mt-6">
            Already have an account?{" "}
            <Link href="/login" className="text-violet-400 hover:text-violet-300 font-medium">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
