export const dynamic = 'force-dynamic';

// Public share layout — intentionally minimal: no Sidebar, no auth gate,
// no dashboard chrome. Anyone with the link can view the frozen snapshot.
export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen bg-[var(--page-bg)]">{children}</main>;
}
