"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthChange } from "@/lib/firebase/auth";

/**
 * Wraps the landing page. If the user is already signed in,
 * redirects them straight to /dashboard so they never see the
 * marketing page when they're already logged in.
 */
export function AuthRedirect({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthChange((user) => {
      if (user) {
        // Already signed in — go straight to dashboard
        router.replace("/dashboard");
      } else {
        // Not signed in — show the landing page
        setChecked(true);
      }
    });
    return () => unsubscribe();
  }, [router]);

  // Don't flash the landing page while checking auth
  if (!checked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--page-bg)]">
        <div className="w-5 h-5 bg-foreground/20 animate-pulse" />
      </div>
    );
  }

  return <>{children}</>;
}
