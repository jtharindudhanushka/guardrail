"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signup } from "../actions";

export default function SignupPage() {
  const [state, formAction, pending] = useActionState<{ error?: string } | undefined, FormData>(signup, undefined);

  return (
    <div className="bg-[var(--color-canvas)] rounded-[18px] p-8 border border-[var(--color-hairline)]">
      <h1 className="text-[28px] font-semibold tracking-[-0.28px] mb-1" style={{ color: "var(--color-ink)" }}>
        Create account
      </h1>
      <p className="text-[14px] mb-6" style={{ color: "var(--color-ink-muted-48)" }}>
        You&apos;ll be the gatekeeper — only you can unlock or edit limits.
      </p>

      <form action={formAction} className="flex flex-col gap-3">
        <input className="input-pill" type="email" name="email" placeholder="Email" required autoFocus />
        <input className="input-pill" type="password" name="password" placeholder="Password (min 8 characters)" required minLength={8} />

        {state?.error && (
          <p className="text-[14px]" style={{ color: "#c0392b" }}>
            {state.error}
          </p>
        )}

        <button className="btn-primary mt-2 justify-center" type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create account"}
        </button>
      </form>

      <p className="text-[14px] mt-6 text-center" style={{ color: "var(--color-ink-muted-48)" }}>
        Already have an account?{" "}
        <Link href="/login" className="text-link">
          Sign in
        </Link>
      </p>
    </div>
  );
}
