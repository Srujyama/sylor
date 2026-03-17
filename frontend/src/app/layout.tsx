import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "Sylor — AI Simulation Platform",
  description:
    "Simulate major decisions before making them. Build AI-powered simulations for business ideas, policies, and startup plans.",
  keywords: ["AI simulation", "business simulation", "startup planning", "decision making", "market simulation"],
  openGraph: {
    title: "Sylor — AI Simulation Platform",
    description: "Simulate major decisions before making them using multi-agent AI",
    type: "website",
  },
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
