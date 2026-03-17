"use client";

import { ToastContextProvider } from "@/components/ui/toast";
import { CommandPalette } from "@/components/command-palette";
import { ThemeProvider } from "@/components/theme-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <ToastContextProvider>
        {children}
        <CommandPalette />
      </ToastContextProvider>
    </ThemeProvider>
  );
}
