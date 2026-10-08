"use client";

import { useState, useTransition } from "react";
import { runJob, disconnect, testHoldWrite } from "./actions";

const JOBS = [
  { job: "sync-xero", label: "Refresh from Xero" },
  { job: "sync-remittances", label: "Check accounts inboxes" },
  { job: "sync-ascora-customers", label: "Match customers to Ascora" },
  { job: "sync-ascora-holds", label: "Refresh On Hold from Ascora" },
] as const;

export function RunButtons() {
  const [pending, start] = useTransition();
  const [running, setRunning] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {JOBS.map((j) => (
          <button
            key={j.job}
            className="btn"
            disabled={pending}
            onClick={() => {
              setRunning(j.job);
              setMsg(null);
              start(async () => {
                const r = await runJob(j.job);
                setMsg({ ok: r.ok, text: r.ok ? `${j.label}: done.` : `${j.label} failed: ${r.error}` });
                setRunning(null);
              });
            }}
          >
            {running === j.job ? "Running…" : j.label}
          </button>
        ))}
      </div>
      {msg && <span className={msg.ok ? "ok small" : "err small"}>{msg.text}</span>}
    </div>
  );
}

export function HoldWriteTest() {
  const [id, setId] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input className="input" style={{ maxWidth: 360 }} placeholder="Ascora ID of a dummy test customer" value={id} onChange={(e) => setId(e.target.value)} />
        <button className="btn" disabled={pending || !id.trim()} onClick={() => start(async () => setMsg(await testHoldWrite(id)))}>
          {pending ? "Testing…" : "Run test"}
        </button>
      </div>
      {msg && <span className={msg.ok ? "ok small" : "err small"}>{msg.text}</span>}
    </div>
  );
}

export function DisconnectButton() {
  const [pending, start] = useTransition();
  return (
    <button
      className="btn danger"
      disabled={pending}
      onClick={() => {
        if (confirm("Disconnect Xero? Syncs stop until it's reconnected.")) start(() => disconnect());
      }}
    >
      Disconnect
    </button>
  );
}
