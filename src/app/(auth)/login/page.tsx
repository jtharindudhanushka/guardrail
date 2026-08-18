"use client";

import { useActionState } from "react";
import Link from "next/link";
import { login } from "../actions";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState<{ error?: string } | undefined, FormData>(login, undefined);

  return (
    <div className="bg-[var(--color-canvas)] rounded-[18px] p-8 border border-[var(--color-hairline)]">
      <h1 className="text-[28px] font-semibold tracking-[-0.28px] mb-1" style={{ color: "var(--color-ink)" }}>
        Sign in
      </h1>
      <p className="text-[14px] mb-6" style={{ color: "var(--color-ink-muted-48)" }}>
        Manage limits from your portal.
      </p>

      <form action={formAction} className="flex flex-col gap-3">
        <input className="input-pill" type="email" name="email" placeholder="Email" required autoFocus />
        <input className="input-pill" type="password" name="password" placeholder="Password" required />

        {state?.error && (
          <p className="text-[14px]" style={{ color: "#c0392b" }}>
            {state.error}
          </p>
        )}

        <button className="btn-primary mt-2 justify-center" type="submit" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="text-[14px] mt-6 text-center" style={{ color: "var(--color-ink-muted-48)" }}>
        No account?{" "}
        <Link href="/signup" className="text-link">
          Create one
        </Link>
      </p>
    </div>
  );
}
