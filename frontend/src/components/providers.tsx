"use client";

import { ToastContextProvider } from "@/components/ui/toast";
import { CommandPalette } from "@/components/command-palette";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ToastContextProvider>
      {children}
      <CommandPalette />
    </ToastContextProvider>
  );
}
