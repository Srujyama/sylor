import Link from "next/link";
import { Activity, Github, Twitter, Linkedin } from "lucide-react";

const footerLinks = {
  Product: [
    { label: "Features", href: "#features" },
    { label: "Templates", href: "#templates" },
    { label: "Pricing", href: "#pricing" },
    { label: "Changelog", href: "/changelog" },
  ],
  Company: [
    { label: "About", href: "/about" },
    { label: "Blog", href: "/blog" },
    { label: "Careers", href: "/careers" },
    { label: "Contact", href: "/contact" },
  ],
  Legal: [
    { label: "Privacy Policy", href: "/privacy" },
    { label: "Terms of Service", href: "/terms" },
    { label: "Cookie Policy", href: "/cookies" },
  ],
};

export function Footer() {
  return (
    <footer className="border-t border-white/10 py-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-12">
          {/* Brand */}
          <div className="col-span-2">
            <Link href="/" className="flex items-center gap-2 mb-4 group">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center">
                <Activity className="w-4 h-4 text-white" />
              </div>
              <span className="text-xl font-bold gradient-text">SimWorld</span>
            </Link>
            <p className="text-sm text-muted-foreground max-w-xs leading-relaxed mb-6">
              Simulate major decisions before you make them. Built for founders, strategists,
              and policy makers who want evidence-based confidence.
            </p>
            <div className="flex gap-3">
              <a href="https://twitter.com" className="w-9 h-9 glass rounded-lg flex items-center justify-center hover:border-white/20 transition-colors">
                <Twitter className="w-4 h-4 text-muted-foreground" />
              </a>
              <a href="https://github.com" className="w-9 h-9 glass rounded-lg flex items-center justify-center hover:border-white/20 transition-colors">
                <Github className="w-4 h-4 text-muted-foreground" />
              </a>
              <a href="https://linkedin.com" className="w-9 h-9 glass rounded-lg flex items-center justify-center hover:border-white/20 transition-colors">
                <Linkedin className="w-4 h-4 text-muted-foreground" />
              </a>
            </div>
          </div>

          {/* Links */}
          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category}>
              <h4 className="text-sm font-semibold text-white mb-4">{category}</h4>
              <ul className="space-y-3">
                {links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted-foreground hover:text-white transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="border-t border-white/10 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            © 2026 SimWorld, Inc. All rights reserved.
          </p>
          <p className="text-sm text-muted-foreground">
            Made with AI, for decision makers
          </p>
        </div>
      </div>
    </footer>
  );
}
