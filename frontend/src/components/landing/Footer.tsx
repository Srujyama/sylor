import Link from "next/link";
import { Github, Twitter } from "lucide-react";

const footerLinks = {
  product: [
    { label: "features", href: "#features" },
    { label: "templates", href: "#templates" },
    { label: "pricing", href: "#pricing" },
    { label: "changelog", href: "/changelog" },
  ],
  company: [
    { label: "about", href: "/about" },
    { label: "blog", href: "/blog" },
    { label: "careers", href: "/careers" },
    { label: "contact", href: "/contact" },
  ],
  legal: [
    { label: "privacy", href: "/privacy" },
    { label: "terms", href: "/terms" },
    { label: "cookies", href: "/cookies" },
  ],
};

export function Footer() {
  return (
    <footer className="border-t border-white/[0.05] py-16">
      <div className="max-w-[1440px] mx-auto px-8">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-10 mb-12">
          {/* Brand */}
          <div className="col-span-2">
            <Link href="/" className="flex items-center gap-2.5 mb-5">
              <div className="w-5 h-5 bg-white flex items-center justify-center shrink-0">
                <span className="text-[8px] font-black text-black tracking-widest">SY</span>
              </div>
              <span className="text-sm font-semibold text-white tracking-tight">sylor</span>
            </Link>
            <p className="text-xs text-white/30 leading-relaxed mb-6 max-w-xs">
              Simulate major decisions before you make them. Built for founders, strategists,
              and policy makers who want evidence-based confidence.
            </p>
            <div className="flex gap-2">
              <a
                href="https://twitter.com"
                className="w-8 h-8 surface flex items-center justify-center hover:bg-white/[0.06] transition-colors"
                aria-label="Twitter"
              >
                <Twitter className="w-3.5 h-3.5 text-white/30" />
              </a>
              <a
                href="https://github.com"
                className="w-8 h-8 surface flex items-center justify-center hover:bg-white/[0.06] transition-colors"
                aria-label="GitHub"
              >
                <Github className="w-3.5 h-3.5 text-white/30" />
              </a>
            </div>
          </div>

          {/* Links */}
          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category}>
              <h4 className="text-xs font-medium text-white/20 mb-4 tracking-widest uppercase">{category}</h4>
              <ul className="space-y-2.5">
                {links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-xs text-white/35 hover:text-white/70 transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="border-t border-white/[0.05] pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-white/20">
            © 2026 Sylor, Inc. All rights reserved.
          </p>
          <p className="text-xs text-white/20">
            made with AI, for decision makers
          </p>
        </div>
      </div>
    </footer>
  );
}
