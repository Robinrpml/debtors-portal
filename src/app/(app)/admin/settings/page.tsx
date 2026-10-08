import type { Metadata } from "next";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { optionalEnv } from "@/lib/env";
import { accountsAddresses } from "@/lib/missive";
import { fmtDateTime } from "@/lib/format";
import { RunButtons, DisconnectButton, HoldWriteTest } from "./controls";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";
export const maxDuration = 300; // lets "Refresh now" run a full Xero sync

export default async function SettingsPage(props: PageProps<"/admin/settings">) {
  const me = await requireManager();
  const sp = await props.searchParams;
  const db = await createClient();
  const [{ data: conn }, { data: runs }, { data: logs }] = await Promise.all([
    db.from("app_state").select("value").eq("key", "xero_connection").maybeSingle(),
    db.from("sync_runs").select("id,job,started_at,finished_at,ok,detail,error").order("started_at", { ascending: false }).limit(25),
    db.from("audit_log").select("id,at,user_email,action,target").order("at", { ascending: false }).limit(50),
  ]);
  const x = (conn?.value ?? {}) as { connected?: boolean; tenant_name?: string; error?: string; refreshed_at?: string };
  const owner = me.role === "owner";

  const checks = [
    { name: "Xero app", ok: !!optionalEnv("XERO_CLIENT_ID") && !!optionalEnv("XERO_CLIENT_SECRET"), detail: "XERO_CLIENT_ID / XERO_CLIENT_SECRET" },
    { name: "Ascora API", ok: !!optionalEnv("ASCORA_API_KEY"), detail: "ASCORA_API_KEY — customer matching and notes" },
    { name: "Ascora customer links", ok: !!optionalEnv("ASCORA_CUSTOMER_URL"), detail: "ASCORA_CUSTOMER_URL" },
    { name: "Ascora invoice links", ok: !!optionalEnv("ASCORA_INVOICE_URL"), detail: "ASCORA_INVOICE_URL (+ webhooks for invoice IDs)" },
    { name: "Change On Hold", ok: optionalEnv("ASCORA_HOLD_WRITE_ENABLED") === "true", detail: "ASCORA_HOLD_WRITE_ENABLED=true — lets Managers put customers on hold / release in Ascora" },
    { name: "Missive", ok: !!optionalEnv("MISSIVE_API_TOKEN"), detail: `MISSIVE_API_TOKEN — checks ${accountsAddresses().join(", ")}` },
    { name: "Claude API", ok: !!optionalEnv("ANTHROPIC_API_KEY"), detail: "ANTHROPIC_API_KEY — reads remittance emails" },
    { name: "Cron secret", ok: !!optionalEnv("CRON_SECRET"), detail: "CRON_SECRET — scheduled syncs" },
  ];

  return (
    <div className="wrap" style={{ maxWidth: 1200 }}>
      <div style={{ display: "grid", gap: 6 }}>
        <span className="eyebrow">Administration</span>
        <h1>Settings</h1>
      </div>

      {sp.xero === "connected" && <div className="banner good">Xero connected. Run a refresh to load the debtors.</div>}
      {sp.xero === "error" && <div className="banner bad">Xero connection didn&apos;t complete. Try again, and check the redirect URI in the Xero app matches this site.</div>}

      <section className="panel">
        <div className="panel-head">
          <h2>Xero</h2>
          {x.connected ? <span className="badge">Connected · {x.tenant_name}</span> : <span className="badge off">Not connected</span>}
        </div>
        {x.error && <p className="err small" style={{ margin: 0 }}>{x.error}</p>}
        {owner ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a className="btn primary" href="/api/xero/connect">{x.connected ? "Reconnect Xero" : "Connect Xero"}</a>
            {x.connected && <DisconnectButton />}
          </div>
        ) : (
          <p className="muted small" style={{ margin: 0 }}>Only an Owner can connect or reconnect Xero.</p>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Refresh now</h2>
          <span className="status">Scheduled daily at about 5:30am, plus through the business day</span>
        </div>
        <RunButtons />
      </section>

      {owner && (
        <section className="panel">
          <div className="panel-head">
            <h2>Test On Hold writing</h2>
            <span className="status">Owner only</span>
          </div>
          <p className="muted small" style={{ margin: 0, maxWidth: 760 }}>
            Ascora&apos;s docs don&apos;t say whether updating a customer keeps the fields we don&apos;t send. This puts a test customer on hold and
            straight back, then checks nothing else changed. Use a dummy customer, not a real one.
          </p>
          <HoldWriteTest />
        </section>
      )}

      <section className="panel">
        <h2>Connections</h2>
        <table className="list">
          <tbody>
            {checks.map((c) => (
              <tr key={c.name}>
                <td style={{ width: 200, fontWeight: 600 }}>{c.name}</td>
                <td>{c.ok ? <span className="ok">Set</span> : <span className="err">Missing</span>}</td>
                <td className="muted small">{c.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint" style={{ margin: 0 }}>These are Vercel environment variables. Change them in the Vercel project, then redeploy.</p>
      </section>

      <section className="panel">
        <h2>Recent syncs</h2>
        <div style={{ overflowX: "auto" }}>
          <table className="list">
            <thead>
              <tr><th>Job</th><th>Started</th><th>Result</th><th>Detail</th></tr>
            </thead>
            <tbody>
              {(runs ?? []).map((r) => (
                <tr key={r.id}>
                  <td>{r.job}</td>
                  <td className="small" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.started_at)}</td>
                  <td>{r.ok === null ? <span className="muted">Running…</span> : r.ok ? <span className="ok">OK</span> : <span className="err">Failed</span>}</td>
                  <td className="small muted" style={{ fontFamily: "var(--f-mono)", overflowWrap: "anywhere" }}>{r.error ?? (r.detail ? JSON.stringify(r.detail) : "")}</td>
                </tr>
              ))}
              {!runs?.length && <tr><td colSpan={4} className="muted">No syncs yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2>Audit log</h2>
        <div style={{ overflowX: "auto" }}>
          <table className="list">
            <thead>
              <tr><th>When</th><th>Who</th><th>Action</th><th>Target</th></tr>
            </thead>
            <tbody>
              {(logs ?? []).map((l) => (
                <tr key={l.id}>
                  <td className="small" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(l.at)}</td>
                  <td className="small">{l.user_email ?? "system"}</td>
                  <td className="small">{l.action}</td>
                  <td className="small muted" style={{ overflowWrap: "anywhere" }}>{l.target}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
