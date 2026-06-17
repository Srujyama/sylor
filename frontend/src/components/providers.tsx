"use client";

import { ToastContextProvider } from "@/components/ui/toast";
import { CommandPalette } from "@/components/command-palette";
import { GlobalHotkeys } from "@/components/global-hotkeys";
import { ThemeProvider } from "@/components/theme-provider";
import { RunTrayProvider } from "@/components/run-tray";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <ToastContextProvider>
        <RunTrayProvider>
          {children}
          <CommandPalette />
          <GlobalHotkeys />
        </RunTrayProvider>
      </ToastContextProvider>
    </ThemeProvider>
  );
}
