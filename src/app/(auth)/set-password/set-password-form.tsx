"use client";

import { useActionState } from "react";
import { setPassword } from "../actions";

export function SetPasswordForm() {
  const [state, action, pending] = useActionState(setPassword, undefined);
  return (
    <form action={action}>
      <div className="field">
        <label htmlFor="password">New password</label>
        <input id="password" name="password" type="password" className="input" autoComplete="new-password" minLength={12} required autoFocus />
      </div>
      <div className="field">
        <label htmlFor="confirm">Confirm password</label>
        <input id="confirm" name="confirm" type="password" className="input" autoComplete="new-password" minLength={12} required />
      </div>
      {state?.error && <p className="err small" role="alert" style={{ margin: 0 }}>{state.error}</p>}
      <button className="btn primary" type="submit" disabled={pending} style={{ justifyContent: "center" }}>
        {pending ? "Saving…" : "Save password"}
      </button>
    </form>
  );
}
