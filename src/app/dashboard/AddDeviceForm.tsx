"use client";

import { useActionState, useRef, useEffect } from "react";
import { createDevice } from "./actions";

export default function AddDeviceForm() {
  const [, formAction, pending] = useActionState<{ error?: string } | undefined, FormData>(createDevice, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!pending) formRef.current?.reset();
  }, [pending]);

  return (
    <form ref={formRef} action={formAction} className="flex gap-2">
      <input className="input-pill" name="name" placeholder="e.g. Living room laptop" style={{ maxWidth: 260 }} />
      <button className="btn-primary" type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add device"}
      </button>
    </form>
  );
}
