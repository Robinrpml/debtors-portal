"use client";

import { useState, useTransition } from "react";
import { runJob, disconnect } from "./actions";

const JOBS = [
  { job: "sync-xero", label: "Refresh from Xero" },
  { job: "sync-remittances", label: "Check accounts inboxes" },
  { job: "sync-ascora-customers", label: "Match customers to Ascora" },
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
