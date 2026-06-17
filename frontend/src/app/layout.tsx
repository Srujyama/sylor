import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "Sylor — AI Simulation Platform",
  description:
    "Simulate major decisions before making them. Build AI-powered simulations for business ideas, policies, and startup plans.",
  keywords: ["AI simulation", "business simulation", "startup planning", "decision making", "market simulation"],
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Sylor",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    title: "Sylor — AI Simulation Platform",
    description: "Simulate major decisions before making them using multi-agent AI",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="antialiased min-h-screen bg-[var(--page-bg)] text-[var(--page-text)] transition-colors duration-200">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
