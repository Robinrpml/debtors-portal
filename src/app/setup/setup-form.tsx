"use client";

import { useActionState } from "react";
import { createFirstOwner } from "./actions";

export function SetupForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(createFirstOwner, undefined);
  return (
    <form action={action}>
      <input type="hidden" name="token" value={token} />
      <div className="field">
        <label htmlFor="name">Your name</label>
        <input id="name" name="name" className="input" required autoComplete="name" />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" className="input" minLength={12} required autoComplete="new-password" />
      </div>
      <div className="field">
        <label htmlFor="confirm">Confirm password</label>
        <input id="confirm" name="confirm" type="password" className="input" minLength={12} required autoComplete="new-password" />
      </div>
      {state?.error && <p className="err small" role="alert" style={{ margin: 0 }}>{state.error}</p>}
      <button className="btn primary" disabled={pending} style={{ justifyContent: "center" }}>
        {pending ? "Creating…" : "Create Owner account"}
      </button>
    </form>
  );
}
