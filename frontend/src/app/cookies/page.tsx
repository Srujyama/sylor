import Link from "next/link";

export const metadata = {
  title: "cookie & storage policy — sylor",
  description: "How Sylor uses cookies and browser storage.",
};

export default function CookiesPage() {
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
          <span className="text-xs text-white/30">cookies</span>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-8 py-12">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white tracking-tight mb-2">cookie &amp; storage policy</h1>
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
              Sylor keeps its use of browser storage deliberately minimal. We do not run third-party
              advertising or cross-site tracking cookies. Instead, we rely mostly on your
              browser&apos;s local storage and on the authentication tokens that keep you signed in.
            </p>
          </section>

          <Section title="what we store in your browser">
            <ul className="space-y-2.5">
              <Item>
                <strong className="text-white/55">Authentication tokens</strong> — Firebase
                Authentication stores tokens so you stay signed in across page loads without
                re-entering your password.
              </Item>
              <Item>
                <strong className="text-white/55">Recently viewed</strong> — a list of recently opened
                simulations and pages so we can show you a &quot;recents&quot; shortcut.
              </Item>
              <Item>
                <strong className="text-white/55">Preferences</strong> — small settings like your theme
                choice.
              </Item>
              <Item>
                <strong className="text-white/55">Onboarding state</strong> — flags such as whether you
                have used the command palette and which activation-checklist steps you have completed,
                so we do not nag you about things you have already done.
              </Item>
            </ul>
          </Section>

          <Section title="what we do not use">
            <ul className="space-y-2.5">
              <Item>No third-party advertising cookies.</Item>
              <Item>No cross-site tracking or fingerprinting.</Item>
              <Item>No selling of any of this data.</Item>
            </ul>
          </Section>

          <Section title="how to clear it">
            <p className="text-[11px] text-white/30 leading-relaxed mb-3">
              You are always in control of this storage:
            </p>
            <ul className="space-y-2.5">
              <Item>Signing out clears your authentication tokens.</Item>
              <Item>
                You can clear local storage at any time through your browser&apos;s settings (Clear
                browsing data → Cookies and site data), or via the developer tools for this site.
              </Item>
              <Item>
                Clearing storage will sign you out and reset preferences and recents, but it does not
                delete your account or your saved simulations, which live in Firestore.
              </Item>
            </ul>
          </Section>

          <Section title="related">
            <p className="text-[11px] text-white/30 leading-relaxed">
              For the bigger picture on how we handle your data, see our{" "}
              <Link href="/privacy" className="text-white/55 hover:text-white/80 underline underline-offset-2 transition-colors">
                privacy policy
              </Link>.
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
