import Link from "next/link";

export const metadata = {
  title: "privacy policy — sylor",
  description: "How Sylor collects, uses, and protects your data.",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen">
      {/* Simple header */}
      <div className="border-b border-white/[0.06] px-8 py-4">
        <div className="max-w-3xl mx-auto flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-5 h-5 bg-white flex items-center justify-center shrink-0">
              <span className="text-[8px] font-black text-black tracking-widest">SY</span>
            </div>
            <span className="text-sm font-semibold text-white tracking-tight">sylor</span>
          </Link>
          <span className="text-white/15">·</span>
          <span className="text-xs text-white/30">privacy</span>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-8 py-12">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white tracking-tight mb-2">privacy policy</h1>
          <p className="text-sm text-white/30">last updated June 20, 2026</p>
        </div>

        {/* Disclaimer */}
        <div className="surface p-4 mb-10">
          <p className="text-[11px] text-white/40 leading-relaxed">
            This is a template provided for transparency and is not legal advice. It has not been
            reviewed by a lawyer; consult one before relying on it.
          </p>
        </div>

        <div className="space-y-10">
          <section>
            <p className="text-sm text-white/40 leading-relaxed">
              Sylor is an AI-powered Monte Carlo simulation platform. You upload documents and CSVs,
              build knowledge graphs, configure simulations, and run them — and we store the results
              so you can come back to them. This policy explains, in plain English, what data we
              collect, why we collect it, who we share it with, and how you can get it back or
              delete it.
            </p>
          </section>

          <Section title="what we collect">
            <ul className="space-y-2.5">
              <Item>
                <strong className="text-white/55">Account information</strong> — when you sign up we
                use Firebase Authentication, which stores your email address (and, if you use Google
                sign-in, your basic Google profile). We do not store your password; Firebase handles
                that.
              </Item>
              <Item>
                <strong className="text-white/55">Uploaded content</strong> — the documents, CSVs,
                and spreadsheets you upload to build knowledge graphs and power simulations. We
                process these to extract entities, numeric series, and context.
              </Item>
              <Item>
                <strong className="text-white/55">Simulation data</strong> — the configurations you
                create (variables, agents, assumptions) and the results we compute (outcome
                distributions, risk factors, run history) are stored in Firestore under your account.
              </Item>
              <Item>
                <strong className="text-white/55">Usage metrics</strong> — basic, per-user counts and
                events (for example, how many simulations you have run) so we can show you analytics
                and operate the service. We do not run third-party advertising trackers.
              </Item>
            </ul>
          </Section>

          <Section title="how we use it">
            <ul className="space-y-2.5">
              <Item>To run your simulations and generate the analysis, charts, and AI insights you ask for.</Item>
              <Item>To save your work so it persists between sessions and devices.</Item>
              <Item>To operate, secure, debug, and improve the platform.</Item>
              <Item>To enforce rate limits and prevent abuse.</Item>
            </ul>
            <p className="text-[11px] text-white/30 leading-relaxed mt-4">
              We do not sell your personal data, and we do not use your uploaded content to train
              models of our own.
            </p>
          </Section>

          <Section title="third-party processors">
            <p className="text-[11px] text-white/30 leading-relaxed mb-3">
              To run the service we rely on a small number of trusted infrastructure providers. Your
              data may be processed by:
            </p>
            <ul className="space-y-2.5">
              <Item>
                <strong className="text-white/55">Firebase / Google Cloud</strong> — authentication
                and the Firestore database that stores your projects, simulations, and results.
              </Item>
              <Item>
                <strong className="text-white/55">Anthropic (Claude)</strong> — when you use AI
                features (context analysis, what-if verdicts, insights, copilot, hero runs), the
                relevant text is sent to Anthropic&apos;s Claude API to generate a response.
              </Item>
              <Item>
                <strong className="text-white/55">Vercel and Fly.io</strong> — hosting for the web
                frontend and the simulation API.
              </Item>
            </ul>
            <p className="text-[11px] text-white/30 leading-relaxed mt-4">
              Each of these providers processes data under its own terms and security practices.
            </p>
          </Section>

          <Section title="cookies & local storage">
            <p className="text-[11px] text-white/30 leading-relaxed">
              Sylor relies mainly on your browser&apos;s local storage and on Firebase Authentication
              tokens rather than tracking cookies. We use these to keep you signed in and to remember
              small preferences such as recently viewed items, your theme, and onboarding-checklist
              state. We do not set third-party advertising cookies. See our{" "}
              <Link href="/cookies" className="text-white/55 hover:text-white/80 underline underline-offset-2 transition-colors">
                cookie &amp; storage policy
              </Link>{" "}
              for details.
            </p>
          </Section>

          <Section title="data retention & deletion">
            <p className="text-[11px] text-white/30 leading-relaxed">
              We keep your account data and simulations for as long as your account is active. You can
              delete your account at any time from Settings, which removes your account and the
              associated data we hold. Backups and provider logs may persist for a short period before
              they age out.
            </p>
          </Section>

          <Section title="your rights">
            <ul className="space-y-2.5">
              <Item><strong className="text-white/55">Access &amp; export</strong> — you can export your data from Settings.</Item>
              <Item><strong className="text-white/55">Deletion</strong> — you can delete your account and its data from Settings.</Item>
              <Item><strong className="text-white/55">Correction</strong> — you can edit your simulations and account details directly in the app.</Item>
            </ul>
            <p className="text-[11px] text-white/30 leading-relaxed mt-4">
              Depending on where you live, you may have additional rights under laws such as the GDPR
              or CCPA. Contact us to exercise them.
            </p>
          </Section>

          <Section title="contact">
            <p className="text-[11px] text-white/30 leading-relaxed">
              Questions about this policy or your data? Reach us at{" "}
              <a href="mailto:privacy@sylor.app" className="text-white/55 hover:text-white/80 underline underline-offset-2 transition-colors">
                privacy@sylor.app
              </a>.
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xs font-semibold text-white/60 tracking-widest uppercase mb-4">{title}</h2>
      {children}
    </section>
  );
}

function Item({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-[11px] text-white/30 leading-relaxed">
      <div className="w-1 h-1 bg-white/15 shrink-0 mt-1.5" />
      <span>{children}</span>
    </li>
  );
}
