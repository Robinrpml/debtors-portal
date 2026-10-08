"use client";

import { useMemo, useState, useTransition } from "react";
import { money } from "@/lib/format";
import { fillTemplate } from "@/lib/format";
import { confirmMapping, rejectMapping, resetMapping, setBrandOverride } from "./actions";

export type MapRow = {
  id: string;
  name: string;
  email: string | null;
  brand_override: string | null;
  ascora_customer_id: string | null;
  ascora_customer_name: string | null;
  ascora_match: string;
  ascora_candidates: { id: string; name: string; email: string | null }[] | null;
  total: number;
  untagged: number;
};

const FILTERS = [
  { v: "review", label: "Needs review" },
  { v: "none", label: "No match" },
  { v: "linked", label: "Linked" },
  { v: "untagged", label: "Untagged invoices" },
  { v: "all", label: "All" },
] as const;

export function MappingsTable({ rows, customerUrl }: { rows: MapRow[]; customerUrl: string | null }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["v"]>("review");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const shown = useMemo(
    () =>
      rows.filter((r) =>
        filter === "all" ? true : filter === "linked" ? ["auto", "confirmed"].includes(r.ascora_match) : filter === "untagged" ? r.untagged > 0 : filter === "none" ? ["none", "rejected"].includes(r.ascora_match) : r.ascora_match === "review",
      ),
    [rows, filter],
  );
  const act = (fn: () => Promise<void>) => start(async () => { try { setErr(null); await fn(); } catch (e) { setErr(String((e as Error).message)); } });

  return (
    <>
      <div className="controls">
        <div className="seg" role="group" aria-label="Filter">
          {FILTERS.map((f) => (
            <button key={f.v} aria-pressed={filter === f.v} onClick={() => setFilter(f.v)}>
              {f.label} · {rows.filter((r) => (f.v === "all" ? true : f.v === "linked" ? ["auto", "confirmed"].includes(r.ascora_match) : f.v === "untagged" ? r.untagged > 0 : f.v === "none" ? ["none", "rejected"].includes(r.ascora_match) : r.ascora_match === "review")).length}
            </button>
          ))}
        </div>
        {pending && <span className="status">Saving…</span>}
        {err && <span className="err small">{err}</span>}
      </div>
      <section className="panel" style={{ padding: 0, overflowX: "auto" }}>
        <table className="list">
          <thead>
            <tr>
              <th>Xero customer</th>
              <th style={{ textAlign: "right" }}>Balance</th>
              <th>Ascora customer</th>
              <th>Brand override</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const linked = ["auto", "confirmed"].includes(r.ascora_match);
              const href = linked ? fillTemplate(customerUrl, { id: r.ascora_customer_id }) : null;
              return (
                <tr key={r.id}>
                  <td>
                    <b>{r.name}</b>
                    <div className="muted small">{r.email ?? "no email in Xero"}</div>
                  </td>
                  <td className="num" style={{ textAlign: "right", whiteSpace: "nowrap" }}>{money.format(r.total)}</td>
                  <td style={{ minWidth: 340 }}>
                    {linked ? (
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        {href ? <a className="ext" href={href} target="_blank" rel="noopener noreferrer">{r.ascora_customer_name ?? r.ascora_customer_id}</a> : <span>{r.ascora_customer_name ?? r.ascora_customer_id}</span>}
                        <span className="badge">{r.ascora_match === "auto" ? "Auto-matched" : "Confirmed"}</span>
                        {r.ascora_match === "auto" && <button className="linkbtn" onClick={() => act(() => confirmMapping(r.id, r.ascora_customer_id!, r.ascora_customer_name))}>Confirm</button>}
                        <button className="linkbtn" onClick={() => act(() => rejectMapping(r.id))}>Unlink</button>
                      </div>
                    ) : (
                      <Candidates r={r} onPick={(id, name) => act(() => confirmMapping(r.id, id, name))} onReject={() => act(() => rejectMapping(r.id))} onReset={() => act(() => resetMapping(r.id))} />
                    )}
                  </td>
                  <td>
                    <select
                      className="input"
                      style={{ width: "auto" }}
                      value={r.brand_override ?? ""}
                      onChange={(e) => act(() => setBrandOverride(r.id, (e.target.value || null) as "DND" | null))}
                      aria-label={`Brand override for ${r.name}`}
                    >
                      <option value="">From Xero</option>
                      <option value="DND">DND</option>
                      <option value="Gippsland">Gippsland</option>
                    </select>
                    {r.untagged > 0 && <div className="small warn" style={{ color: "var(--warn)" }}>{r.untagged} invoice{r.untagged > 1 ? "s" : ""} untagged in Xero</div>}
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr><td colSpan={4} className="muted">Nothing in this list.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}

function Candidates({ r, onPick, onReject, onReset }: { r: MapRow; onPick: (id: string, name: string | null) => void; onReject: () => void; onReset: () => void }) {
  const [manual, setManual] = useState("");
  const cands = r.ascora_candidates ?? [];
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {r.ascora_match === "rejected" && <span className="muted small">Marked as no match.</span>}
      {r.ascora_match === "none" && <span className="muted small">No Ascora customer found yet.</span>}
      {cands.map((c) => (
        <div key={c.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn sm" onClick={() => onPick(c.id, c.name)}>Use</button>
          <span>{c.name}</span>
          {c.email && <span className="muted small">{c.email}</span>}
        </div>
      ))}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input className="input" style={{ width: 260 }} placeholder="Or paste Ascora customer ID" value={manual} onChange={(e) => setManual(e.target.value)} />
        <button className="btn sm" disabled={!manual.trim()} onClick={() => onPick(manual.trim(), null)}>Link</button>
        {r.ascora_match !== "rejected" && <button className="linkbtn" onClick={onReject}>Not in Ascora</button>}
        {r.ascora_match === "rejected" && <button className="linkbtn" onClick={onReset}>Search again</button>}
      </div>
    </div>
  );
}
