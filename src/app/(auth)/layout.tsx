export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--color-canvas-parchment)] px-6">
      <div className="mb-10 text-center">
        <span
          className="inline-block text-[21px] font-semibold tracking-[0.231px]"
          style={{ color: "var(--color-ink)" }}
        >
          Guardrail
        </span>
      </div>
      <div className="w-full max-w-[380px]">{children}</div>
    </div>
  );
}
