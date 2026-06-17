"use client";

import { useEffect, useRef } from "react";
import { onAuthChange } from "@/lib/firebase/auth";
import { claimDemo } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import type { StoredDemo } from "@/types";

const STORAGE_KEY = "sylor-demo";

function readStoredDemo(): StoredDemo | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.demo_id && parsed.config && parsed.results) return parsed as StoredDemo;
    return null;
  } catch {
    return null;
  }
}

/**
 * Detects a zero-signup demo stashed in localStorage and, once a user is signed
 * in, claims it as a real owner-scoped simulation. Clears localStorage on
 * success and surfaces a toast with a link to the new sim.
 *
 * Mounted on the dashboard (first authed landing after signup), so it catches
 * both email and Google signup flows without touching the auth pages.
 *
 * @param onClaimed optional callback with the new simulation id (e.g. to refresh a list)
 */
export function useDemoClaim(onClaimed?: (simulationId: string) => void) {
  const { toast } = useToast();
  const claiming = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!readStoredDemo()) return; // nothing to claim — skip the auth listener entirely

    const unsubscribe = onAuthChange(async (user) => {
      if (!user || claiming.current) return;
      const stored = readStoredDemo();
      if (!stored) return;

      claiming.current = true;
      try {
        const { simulation_id } = await claimDemo({
          demo_id: stored.demo_id,
          config: stored.config,
          results: stored.results,
        });
        localStorage.removeItem(STORAGE_KEY);
        toast({
          title: "your demo simulation was saved",
          description: "it's now in your dashboard — open it to rerun, branch, or share",
          variant: "success",
        });
        onClaimed?.(simulation_id);
      } catch {
        // Leave the demo in localStorage so a later visit can retry the claim.
        claiming.current = false;
      }
    });

    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
