export const dynamic = 'force-dynamic';

// Public demo layout — intentionally minimal: no Sidebar, no auth gate, no
// dashboard chrome. Mirrors the /s/[shareId] public layout pattern.
export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen bg-[var(--page-bg)]">{children}</main>;
}
