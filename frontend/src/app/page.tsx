"use client";

import { Navbar } from "@/components/landing/Navbar";
import { Hero } from "@/components/landing/Hero";
import { Features } from "@/components/landing/Features";
import { Domains } from "@/components/landing/Domains";
import { DataUpload } from "@/components/landing/DataUpload";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Templates } from "@/components/landing/Templates";
import { Pricing } from "@/components/landing/Pricing";
import { Footer } from "@/components/landing/Footer";
import { AuthRedirect } from "@/components/auth-redirect";

export default function LandingPage() {
  return (
    <AuthRedirect>
      <main>
        <Navbar />
        <Hero />
        <Features />
        <Domains />
        <DataUpload />
        <HowItWorks />
        <Templates />
        <Pricing />
        <Footer />
      </main>
    </AuthRedirect>
  );
}
