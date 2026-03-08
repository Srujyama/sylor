import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SimWorld — AI Simulation Platform",
  description:
    "Simulate major decisions before making them. Build AI-powered simulations for business ideas, policies, and startup plans.",
  keywords: ["AI simulation", "business simulation", "startup planning", "decision making", "market simulation"],
  openGraph: {
    title: "SimWorld — AI Simulation Platform",
    description: "Simulate major decisions before making them using multi-agent AI",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} antialiased min-h-screen animated-bg`}>{children}</body>
    </html>
  );
}
