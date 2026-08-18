import Link from "next/link";
import { logout } from "@/app/(auth)/actions";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-canvas-parchment)]">
      <nav className="h-11 bg-[var(--color-surface-black)] flex items-center px-6">
        <Link
          href="/dashboard"
          className="text-[12px] tracking-[-0.12px]"
          style={{ color: "var(--color-body-on-dark)" }}
        >
          Guardrail
        </Link>
        <form action={logout} className="ml-auto">
          <button className="text-[12px] tracking-[-0.12px]" style={{ color: "var(--color-body-muted)" }}>
            Sign out
          </button>
        </form>
      </nav>
      <main className="flex-1 w-full max-w-[980px] mx-auto px-6 py-12">{children}</main>
    </div>
  );
}
