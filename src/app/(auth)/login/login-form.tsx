"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signIn } from "../actions";

export function LoginForm({ next, notice }: { next: string; notice?: string }) {
  const [state, action, pending] = useActionState(signIn, undefined);
  return (
    <form action={action}>
      <input type="hidden" name="next" value={next} />
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" className="input" autoComplete="username" required autoFocus />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" className="input" autoComplete="current-password" required />
      </div>
      {(state?.error || notice) && <p className="err small" role="alert" style={{ margin: 0 }}>{state?.error ?? notice}</p>}
      <button className="btn primary" type="submit" disabled={pending} style={{ justifyContent: "center" }}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
      <Link href="/forgot-password" className="small muted" style={{ textAlign: "center" }}>
        Forgot password?
      </Link>
    </form>
  );
}
