import Link from "next/link";

export const metadata = {
  title: "terms of service — sylor",
  description: "The terms that govern your use of Sylor.",
};

export default function TermsPage() {
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
          <span className="text-xs text-white/30">terms</span>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-8 py-12">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white tracking-tight mb-2">terms of service</h1>
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
              These terms govern your use of Sylor, an AI-powered Monte Carlo simulation platform. By
              creating an account or using the service, you agree to them. If you do not agree, please
              do not use Sylor.
            </p>
          </section>

          {/* Highlighted not-advice notice */}
          <div className="surface p-5">
            <h2 className="text-xs font-semibold text-white/60 tracking-widest uppercase mb-3">
              simulations are illustrative, not advice
            </h2>
            <p className="text-[11px] text-white/35 leading-relaxed">
              Sylor produces probabilistic, illustrative scenarios — not predictions of the future
              and not guarantees of any outcome. Results depend entirely on the assumptions, data, and
              parameters you provide. Outputs are <strong className="text-white/55">not financial,
              investment, medical, legal, or professional advice</strong>. Do not make real-world
              decisions solely on the basis of a Sylor simulation; use your own judgment and consult
              qualified professionals where appropriate.
            </p>
          </div>

          <Section title="acceptable use">
            <p className="text-[11px] text-white/30 leading-relaxed mb-3">You agree not to:</p>
            <ul className="space-y-2.5">
              <Item>Use Sylor for any unlawful purpose or to violate anyone&apos;s rights.</Item>
              <Item>Upload content you do not have the right to upload, or that is malicious.</Item>
              <Item>Attempt to break, overload, reverse-engineer, or circumvent the service or its rate limits.</Item>
              <Item>Use the service to generate harmful, deceptive, or abusive material.</Item>
            </ul>
          </Section>

          <Section title="your account">
            <p className="text-[11px] text-white/30 leading-relaxed">
              You are responsible for activity under your account and for keeping your credentials
              secure. You must provide accurate information and be old enough to form a binding
              contract in your jurisdiction. Notify us promptly if you suspect unauthorized access.
            </p>
          </Section>

          <Section title="rate limits & fair use">
            <p className="text-[11px] text-white/30 leading-relaxed">
              To keep the platform reliable for everyone, we apply rate limits — especially on
              compute-intensive simulations and AI-powered features. We may adjust these limits or
              temporarily restrict accounts that place an excessive load on the service.
            </p>
          </Section>

          <Section title="intellectual property">
            <ul className="space-y-2.5">
              <Item>
                <strong className="text-white/55">Your inputs and outputs</strong> — you retain
                ownership of the documents, data, and configurations you upload, and of the results
                generated from them. You grant us the limited rights needed to host and process that
                content so we can provide the service to you.
              </Item>
              <Item>
                <strong className="text-white/55">The platform</strong> — Sylor, its software, design,
                and engine remain the property of Sylor, Inc. These terms do not transfer any rights
                in the platform to you.
              </Item>
            </ul>
          </Section>

          <Section title="disclaimer of warranties">
            <p className="text-[11px] text-white/30 leading-relaxed">
              Sylor is provided &quot;as is&quot; and &quot;as available,&quot; without warranties of
              any kind, whether express or implied, including fitness for a particular purpose,
              accuracy, or non-infringement. We do not warrant that results will be accurate, that the
              service will be uninterrupted, or that it is free of errors.
            </p>
          </Section>

          <Section title="limitation of liability">
            <p className="text-[11px] text-white/30 leading-relaxed">
              To the maximum extent permitted by law, Sylor, Inc. is not liable for any indirect,
              incidental, special, or consequential damages, or for any decisions made or actions
              taken in reliance on simulation results. Our total liability for any claim relating to
              the service is limited to the amount you paid us for it in the twelve months before the
              claim, if any.
            </p>
          </Section>

          <Section title="termination">
            <p className="text-[11px] text-white/30 leading-relaxed">
              You can stop using Sylor and delete your account at any time from Settings. We may
              suspend or terminate access if you violate these terms or to protect the service. On
              termination, your right to use the platform ends, though some provisions (such as the
              disclaimers and liability limits) survive.
            </p>
          </Section>

          <Section title="changes to these terms">
            <p className="text-[11px] text-white/30 leading-relaxed">
              We may update these terms as the product evolves. When we do, we will revise the
              &quot;last updated&quot; date above. Continued use of the service after changes take
              effect means you accept the updated terms.
            </p>
          </Section>

          <Section title="contact">
            <p className="text-[11px] text-white/30 leading-relaxed">
              Questions about these terms? Reach us at{" "}
              <a href="mailto:legal@sylor.app" className="text-white/55 hover:text-white/80 underline underline-offset-2 transition-colors">
                legal@sylor.app
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
