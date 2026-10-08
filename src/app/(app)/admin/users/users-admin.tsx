"use client";

import { useState, useTransition } from "react";
import { fmtDateTime } from "@/lib/format";
import { createUser, updateUser, setUserPassword, sendResetLink, setActive } from "./actions";

export type UserRow = {
  id: string;
  email: string;
  full_name: string;
  role: "owner" | "manager" | "staff";
  brand_access: "all" | "DND" | "Gippsland";
  active: boolean;
  must_change_password: boolean;
  last_seen_at: string | null;
  created_at: string;
};

type Msg = { ok: boolean; error?: string; message?: string } | null;

export function UsersAdmin({ users, me }: { users: UserRow[]; me: { id: string; role: string } }) {
  const [msg, setMsg] = useState<Msg>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const owner = me.role === "owner";
  const run = (fn: () => Promise<Msg>) => start(async () => setMsg(await fn()));

  return (
    <>
      {msg && <div className={`banner ${msg.ok ? "good" : "bad"}`}>{msg.ok ? msg.message : msg.error}</div>}

      <AddUser owner={owner} pending={pending} onSubmit={(v) => run(() => createUser(v))} />

      <section className="panel" style={{ padding: 0, overflowX: "auto" }}>
        <table className="list">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Brands</th>
              <th>Last sign-in</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const canEdit = owner || u.role === "staff";
              return (
                <tr key={u.id}>
                  <td style={{ fontWeight: 600 }}>{u.full_name || "—"}{u.id === me.id && <span className="muted small"> (you)</span>}</td>
                  <td>{u.email}</td>
                  <td><span className={`badge ${u.role === "owner" ? "owner" : ""}`}>{u.role}</span></td>
                  <td>{u.brand_access === "all" ? "All" : u.brand_access}</td>
                  <td className="muted small">{u.last_seen_at ? fmtDateTime(u.last_seen_at) : "Never"}</td>
                  <td>
                    {!u.active ? <span className="badge off">Disabled</span> : u.must_change_password ? <span className="badge">Password pending</span> : <span className="badge">Active</span>}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {canEdit && (
                      <button className="btn sm" onClick={() => setEditing(editing === u.id ? null : u.id)}>
                        {editing === u.id ? "Close" : "Manage"}
                      </button>
                    )}
                    {editing === u.id && (
                      <ManageUser u={u} owner={owner} self={u.id === me.id} pending={pending} run={run} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}

function AddUser({ owner, pending, onSubmit }: { owner: boolean; pending: boolean; onSubmit: (v: Parameters<typeof createUser>[0]) => void }) {
  const [mode, setMode] = useState<"password" | "invite">("password");
  return (
    <details className="panel">
      <summary><b>Add user</b></summary>
      <form
        style={{ display: "grid", gap: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          onSubmit({
            name: String(f.get("name")),
            email: String(f.get("email")),
            role: String(f.get("role")) as "staff",
            brand: String(f.get("brand")) as "all",
            mode,
            password: String(f.get("password") ?? ""),
          });
          e.currentTarget.reset();
        }}
      >
        <div className="grid2">
          <div className="field"><label htmlFor="nu-name">Name</label><input id="nu-name" name="name" className="input" required /></div>
          <div className="field"><label htmlFor="nu-email">Login email</label><input id="nu-email" name="email" type="email" className="input" required /></div>
          <div className="field">
            <label htmlFor="nu-role">Role</label>
            <select id="nu-role" name="role" className="input" defaultValue="staff">
              <option value="staff">Staff — view debtors, add notes</option>
              {owner && <option value="manager">Manager — also manage users and mappings</option>}
              {owner && <option value="owner">Owner — everything, incl. Xero connection</option>}
            </select>
          </div>
          <div className="field">
            <label htmlFor="nu-brand">Can see</label>
            <select id="nu-brand" name="brand" className="input" defaultValue="all">
              <option value="all">DND and Gippsland</option>
              <option value="DND">DND only</option>
              <option value="Gippsland">Gippsland only</option>
            </select>
          </div>
        </div>
        <div className="seg" role="group" aria-label="How they get in" style={{ justifySelf: "start" }}>
          <button type="button" aria-pressed={mode === "password"} onClick={() => setMode("password")}>Set a starting password</button>
          <button type="button" aria-pressed={mode === "invite"} onClick={() => setMode("invite")}>Email them a set-password link</button>
        </div>
        {mode === "password" ? (
          <div className="field" style={{ maxWidth: 360 }}>
            <label htmlFor="nu-pw">Starting password</label>
            <input id="nu-pw" name="password" type="text" className="input" minLength={12} required autoComplete="off" />
            <span className="hint">At least 12 characters. They&apos;ll be asked to choose their own at first sign-in.</span>
          </div>
        ) : (
          <p className="hint" style={{ margin: 0 }}>They&apos;ll get an email with a link to choose their password.</p>
        )}
        <div><button className="btn primary" disabled={pending}>{pending ? "Adding…" : "Add user"}</button></div>
      </form>
    </details>
  );
}

function ManageUser({ u, owner, self, pending, run }: { u: UserRow; owner: boolean; self: boolean; pending: boolean; run: (fn: () => Promise<Msg>) => void }) {
  const [pw, setPw] = useState("");
  return (
    <div style={{ display: "grid", gap: 12, textAlign: "left", marginTop: 10, padding: 12, border: "1px solid var(--line)", borderRadius: 8, minWidth: 300 }}>
      <form
        style={{ display: "grid", gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          run(() => updateUser({ id: u.id, name: String(f.get("name")), role: String(f.get("role")) as "staff", brand: String(f.get("brand")) as "all" }));
        }}
      >
        <input name="name" className="input" defaultValue={u.full_name} aria-label="Name" />
        <select name="role" className="input" defaultValue={u.role} aria-label="Role" disabled={!owner}>
          <option value="staff">Staff</option>
          <option value="manager">Manager</option>
          <option value="owner">Owner</option>
        </select>
        {!owner && <input type="hidden" name="role" value={u.role} />}
        <select name="brand" className="input" defaultValue={u.brand_access} aria-label="Brand access">
          <option value="all">DND and Gippsland</option>
          <option value="DND">DND only</option>
          <option value="Gippsland">Gippsland only</option>
        </select>
        <button className="btn sm" disabled={pending}>Save details</button>
      </form>
      <div style={{ display: "grid", gap: 6 }}>
        <input className="input" type="text" placeholder="New password (12+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" aria-label="New password" />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button className="btn sm" disabled={pending || pw.length < 12} onClick={() => { run(() => setUserPassword(u.id, pw, true)); setPw(""); }}>Set password</button>
          <button className="btn sm" disabled={pending} onClick={() => run(() => sendResetLink(u.id))}>Email reset link</button>
        </div>
      </div>
      {!self && (
        <button className={`btn sm ${u.active ? "danger" : ""}`} disabled={pending} onClick={() => run(() => setActive(u.id, !u.active))}>
          {u.active ? "Disable account" : "Enable account"}
        </button>
      )}
    </div>
  );
}
