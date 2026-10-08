"use client";

import { useActionState } from "react";
import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { requestReset } from "../actions";

export default function ForgotPasswordPage() {
  const [state, action, pending] = useActionState(requestReset, undefined);
  return (
    <AuthCard title="Reset your password">
      {state?.message ? (
        <p style={{ margin: 0 }}>{state.message}</p>
      ) : (
        <form action={action}>
          <p className="muted" style={{ margin: 0 }}>Enter the email you sign in with and we&apos;ll send a link to choose a new password.</p>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" className="input" autoComplete="username" required autoFocus />
          </div>
          {state?.error && <p className="err small" role="alert" style={{ margin: 0 }}>{state.error}</p>}
          <button className="btn primary" type="submit" disabled={pending} style={{ justifyContent: "center" }}>
            {pending ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}
      <Link href="/login" className="small muted" style={{ textAlign: "center" }}>
        Back to sign in
      </Link>
    </AuthCard>
  );
}
