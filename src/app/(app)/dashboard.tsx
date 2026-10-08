"use client";

import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import { BUCKETS, OVERDUE, bucketFor, daysBetween, type BucketKey } from "@/lib/aging";
import { money, money0, fmtDate, fmtDateTime, fillTemplate } from "@/lib/format";
import type { DashboardData, DashRemittance } from "@/lib/data";
import { dismissRemittance } from "./notes-actions";
import { NotesPanel } from "./notes-panel";

type Me = { id: string; name: string; manager: boolean; brandAccess: string };
type BrandFilter = "all" | "DND" | "Gippsland" | "none";
type Inv = { n: string; due: string | null; k: BucketKey; a: number; t: "invoice" | "credit"; brand: string };

type Row = {
  id: string;
  name: string;
  email: string | null;
  ascoraId: string | null;
  inv: Inv[];
  b: Record<BucketKey, number>;
  total: number;
  over: number;
  s60: number;
  oldest: number;
  remAmt: number;
  brands: Set<string>;
  pay: { last: string | null; since: number | null; a30: number; a90: number; n90: number; list: [string, number][] } | null;
  quiet: boolean;
  remits: DashRemittance[];
  notes: number;
  dueFollowUps: number;
};

const COLS = [
  { id: "name", label: "Customer" },
  { id: "brand", label: "Brand" },
  { id: "paid", label: "Last paid" },
  ...BUCKETS.map((b) => ({ id: "b" + b.k, label: b.short, sw: b.color, bucket: b.k })),
  { id: "over", label: "Overdue" },
  { id: "total", label: "Total" },
] as { id: string; label: string; sw?: string; bucket?: BucketKey }[];

const UI_KEY = "pt-debtors-ui";

export function Dashboard({ data, me }: { data: DashboardData; me: Me }) {
  const [brand, setBrand] = useState<BrandFilter>("all");
  const [q, setQ] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [sort, setSort] = useState("over");
  const [asc, setAsc] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(UI_KEY) || "{}");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring per-viewer UI preferences after hydration
      if (s.brand) setBrand(s.brand);
      if (s.sort) setSort(s.sort);
      setAsc(!!s.asc);
      setOverdueOnly(!!s.overdueOnly);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify({ brand, sort, asc, overdueOnly }));
    } catch {}
  }, [brand, sort, asc, overdueOnly]);

  const asOf = data.asOf;
  const custById = useMemo(() => new Map(data.customers.map((c) => [c.id, c])), [data.customers]);

  // Build per-customer rows for the selected brand. Brand filtering is per invoice.
  const all: Row[] = useMemo(() => {
    const byCust = new Map<string, Inv[]>();
    for (const i of data.invoices) {
      const c = custById.get(i.c);
      const eff = i.b ?? c?.brandOverride ?? "";
      if (brand === "DND" && eff !== "DND") continue;
      if (brand === "Gippsland" && eff !== "Gippsland") continue;
      if (brand === "none" && eff !== "") continue;
      const list = byCust.get(i.c) ?? [];
      list.push({ n: i.n, due: i.d, k: bucketFor(i.d, asOf), a: i.a, t: i.t, brand: eff });
      byCust.set(i.c, list);
    }
    const paysBy = new Map<string, [string, number][]>();
    for (const p of data.payments) {
      const l = paysBy.get(p.c) ?? [];
      l.push([p.d, p.a]);
      paysBy.set(p.c, l);
    }
    const remBy = new Map<string, DashRemittance[]>();
    for (const r of data.remittances) if (r.customerId) remBy.set(r.customerId, [...(remBy.get(r.customerId) ?? []), r]);
    const notesBy = new Map(data.noteStats.map((s) => [s.c, s]));

    const rows: Row[] = [];
    for (const [cid, inv] of byCust) {
      const c = custById.get(cid);
      if (!c) continue;
      const b: Record<BucketKey, number> = { C: 0, L: 0, "1": 0, "2": 0, "3": 0, O: 0 };
      let total = 0;
      for (const i of inv) {
        b[i.k] += i.a;
        total += i.a;
      }
      const over = OVERDUE.reduce((s, k) => s + b[k], 0);
      const s60 = b["2"] + b["3"] + b.O;
      const oldest = inv.filter((i) => i.a > 0 && i.k !== "C" && i.due).reduce((m, i) => Math.max(m, daysBetween(i.due!, asOf)), 0);
      const remits = remBy.get(cid) ?? [];
      const remNums = new Set(remits.filter((r) => r.kind === "remittance").flatMap((r) => r.invoices.map((x) => x.toLowerCase())));
      const remAmt = inv.filter((i) => remNums.has(i.n.toLowerCase())).reduce((s, i) => s + i.a, 0);

      const plist = (paysBy.get(cid) ?? []).sort((x, y) => (x[0] < y[0] ? 1 : -1));
      let pay: Row["pay"] = null;
      if (plist.length) {
        const byDate = new Map<string, number>();
        for (const [d, a] of plist) byDate.set(d, (byDate.get(d) ?? 0) + a);
        const dates = [...byDate.entries()].sort((x, y) => (x[0] < y[0] ? 1 : -1));
        const last = dates[0][0];
        const since = daysBetween(last, asOf);
        const in30 = dates.filter(([d]) => daysBetween(d, asOf) <= 30);
        const in90 = dates.filter(([d]) => daysBetween(d, asOf) <= 90);
        pay = { last, since, a30: in30.reduce((s, x) => s + x[1], 0), a90: in90.reduce((s, x) => s + x[1], 0), n90: in90.length, list: dates };
      }
      const quiet = over > 0.005 && (!pay || (pay.since ?? 999) > 30);
      const ns = notesBy.get(cid);
      rows.push({
        id: cid,
        name: c.name,
        email: c.email,
        ascoraId: c.ascoraId,
        inv,
        b,
        total,
        over,
        s60,
        oldest,
        remAmt,
        brands: new Set(inv.map((i) => i.brand).filter(Boolean)),
        pay,
        quiet,
        remits,
        notes: ns?.count ?? 0,
        dueFollowUps: ns?.dueFollowUps ?? 0,
      });
    }
    return rows;
  }, [data, brand, asOf, custById]);

  const rows = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const r = all.filter((x) => {
      if (overdueOnly && x.over <= 0.005) return false;
      if (qq && !x.name.toLowerCase().includes(qq) && !x.inv.some((i) => i.n.toLowerCase().includes(qq))) return false;
      return true;
    });
    const get = (x: Row): string | number => {
      if (sort === "name") return x.name.toLowerCase();
      if (sort === "brand") return [...x.brands].sort().join("/");
      if (sort === "paid") return x.pay?.since == null ? -1e9 : -x.pay.since;
      if (sort === "total") return x.total;
      if (sort.startsWith("b")) return x.b[sort.slice(1) as BucketKey];
      return x.over;
    };
    return r.sort((a, b) => {
      const A = get(a), B = get(b);
      const c = A < B ? -1 : A > B ? 1 : 0;
      return asc ? c : -c;
    });
  }, [all, q, overdueOnly, sort, asc]);

  const T: Record<BucketKey, number> = { C: 0, L: 0, "1": 0, "2": 0, "3": 0, O: 0 };
  let total = 0, over = 0, s60 = 0, rem = 0;
  for (const r of rows) {
    for (const k of Object.keys(T) as BucketKey[]) T[k] += r.b[k];
    total += r.total;
    over += r.over;
    s60 += r.s60;
    rem += r.remAmt;
  }
  const inView = new Set(rows.map((r) => r.id));
  const panelRemits = data.remittances.filter((r) => (r.customerId ? inView.has(r.customerId) : brand === "all" && !q));
  const remN = panelRemits.filter((r) => r.kind === "remittance" && r.customerId).length;
  const pos = BUCKETS.map((b) => Math.max(0, T[b.k]));
  const psum = pos.reduce((a, b) => a + b, 0) || 1;

  const custLink = (r: Row) => fillTemplate(data.links.customer, { id: r.ascoraId });
  const invLink = (n: string) => fillTemplate(data.links.invoice, { id: data.ascoraInvoiceIds[n.toLowerCase()], number: n });

  function toggle(id: string) {
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function sortBy(id: string) {
    if (sort === id) setAsc(!asc);
    else {
      setSort(id);
      setAsc(id === "name" || id === "brand");
    }
  }

  const brandButtons: { v: BrandFilter; label: string }[] =
    me.brandAccess === "all"
      ? [
          { v: "all", label: "All brands" },
          { v: "DND", label: "DND" },
          { v: "Gippsland", label: "Gippsland" },
          { v: "none", label: "Untagged" },
        ]
      : [];

  return (
    <div className="wrap">
      <header style={{ display: "flex", flexWrap: "wrap", gap: "12px 24px", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div style={{ display: "grid", gap: 6 }}>
          <span className="eyebrow">DND Insulation · Gippsland Insulation · Accounts receivable</span>
          <h1>Aged debtors by customer</h1>
          <div className="status" style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px" }}>
            <span>As at <b style={{ color: "var(--ink)" }}>{fmtDate(asOf)}</b></span>
            <span>Refreshed <b style={{ color: "var(--ink)" }}>{data.refreshedAt ? fmtDateTime(data.refreshedAt) : "not yet"}</b></span>
            <span>Xero, by due date</span>
          </div>
        </div>
      </header>

      {!data.refreshedAt && (
        <div className="banner">
          <span>No Xero data yet. {me.manager ? "Connect Xero and run a refresh from Settings." : "A manager needs to connect Xero."}</span>
          {me.manager && <a className="btn sm" href="/admin/settings">Open Settings</a>}
        </div>
      )}

      <div className="controls">
        {brandButtons.length > 0 && (
          <div className="seg" role="group" aria-label="Brand">
            {brandButtons.map((b) => (
              <button key={b.v} aria-pressed={brand === b.v} onClick={() => setBrand(b.v)}>
                {b.label}
              </button>
            ))}
          </div>
        )}
        <input className="search" type="search" placeholder="Search customer or invoice number" aria-label="Search customers" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="chk">
          <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} /> Overdue customers only
        </label>
      </div>

      <section className="kpis" aria-label="Summary">
        <div className="kpi">
          <span className="eyebrow">Total outstanding</span>
          <span className="v">{money0.format(total)}</span>
          <span className="s">{rows.length} customers · {rows.reduce((s, r) => s + r.inv.length, 0)} documents</span>
        </div>
        <div className="kpi alert">
          <span className="eyebrow">Overdue</span>
          <span className="v">{money0.format(over)}</span>
          <span className="s">{total > 0 ? `${((over / total) * 100).toFixed(1)}% of outstanding · ${rows.filter((r) => r.over > 0.005).length} customers` : " "}</span>
        </div>
        <div className="kpi">
          <span className="eyebrow">Over 60 days</span>
          <span className="v">{money0.format(s60)}</span>
          <span className="s">{rows.filter((r) => r.s60 > 0.005).length} customers with invoices 2+ months overdue</span>
        </div>
        <div className="kpi flag">
          <span className="eyebrow">Remitted, not applied</span>
          <span className="v">{money0.format(rem)}</span>
          <span className="s">{remN ? `${remN} remittance${remN > 1 ? "s" : ""} still open in Xero` : "Nothing waiting to be applied"}</span>
        </div>
      </section>

      <section className="panel" aria-labelledby="aging-h">
        <div className="panel-head">
          <h2 id="aging-h">Aging profile</h2>
          <span className="status">By due date, as Xero reports it</span>
        </div>
        <div className="aging-bar" role="img" aria-label={"Aging profile: " + BUCKETS.map((b) => `${b.label} ${money0.format(T[b.k])}`).join(", ")}>
          {BUCKETS.map((b, i) => (pos[i] > 0 ? <span key={b.k} title={`${b.label}: ${money.format(T[b.k])}`} style={{ flex: `0 0 ${((pos[i] / psum) * 100).toFixed(3)}%`, background: b.color }} /> : null))}
        </div>
        <div className="legend">
          {BUCKETS.map((b) => (
            <div className="lg" key={b.k}>
              <i style={{ background: b.color }} />
              <span className="lab">{b.label} · {total ? ((T[b.k] / total) * 100).toFixed(1) : "0.0"}%</span>
              <span className="amt">{money.format(T[b.k])}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel" aria-labelledby="rem-h">
        <div className="panel-head">
          <h2 id="rem-h">Payment advice from the accounts inboxes</h2>
          <span className="status">Remittances and claims for customers with open invoices</span>
        </div>
        <div className="remits">
          {panelRemits.length === 0 && <div className="empty">No payment advice waiting for customers in this view.</div>}
          {panelRemits.map((r) => (
            <div key={r.id} className={`rm ${r.kind}`}>
              <span className="tag">{{ remittance: "Remitted", claim: "Claim approved", note: "Note" }[r.kind]}</span>
              <div className="body">
                <span className="who">
                  {r.customerId ? custById.get(r.customerId)?.name : `${r.customerName ?? "Unknown sender"} (not matched)`}{" "}
                  <span className="detail">
                    {r.ref ? `· ${r.ref} ` : ""}
                    {r.date ? `· ${fmtDate(r.date)}` : ""}
                    {r.inbox ? ` · ${r.inbox.split("@")[1]?.split(".")[0]}` : ""}
                  </span>
                </span>
                {r.note && <span className="detail">{r.note}</span>}
                {r.invoices.length > 0 && <span className="invs">{r.invoices.join(" · ")}</span>}
              </div>
              <div className="amt">
                {r.amount != null ? money.format(r.amount) : ""}
                {r.url && (
                  <a href={r.url} target="_blank" rel="noopener noreferrer">Open email ↗</a>
                )}
                {me.manager && (
                  <button className="linkbtn" onClick={() => startTransition(() => dismissRemittance(r.id))}>Dismiss</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ display: "grid", gap: 10, minWidth: 0 }}>
        <div className="panel-head">
          <h2>Customers</h2>
          <span className="status">{rows.length} of {all.length} customers</span>
        </div>
        <div className="table-scroll">
          <table className="ledger">
            <thead>
              <tr>
                {COLS.map((c) => (
                  <th key={c.id} scope="col" className={sort === c.id ? `sorted${asc ? " asc" : ""}` : ""} onClick={() => sortBy(c.id)} aria-sort={sort === c.id ? (asc ? "ascending" : "descending") : "none"}>
                    {c.sw && <span className="sw" style={{ background: c.sw }} />}
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={COLS.length} className="empty" style={{ textAlign: "left", fontFamily: "var(--f-body)" }}>No customers match these filters.</td>
                </tr>
              )}
              {rows.map((r) => {
                const isOpen = open.has(r.id);
                const link = custLink(r);
                const brands = [...r.brands];
                return (
                  <Fragment key={r.id}>
                    <tr
                      className={`cust${isOpen ? " open" : ""}`}
                      tabIndex={0}
                      aria-expanded={isOpen}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest("a,button")) return;
                        toggle(r.id);
                      }}
                      onKeyDown={(e) => {
                        if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
                          e.preventDefault();
                          toggle(r.id);
                        }
                      }}
                    >
                      <td className="name">
                        <div className="nm">
                          <span className="caret">▸</span>
                          {link ? (
                            <a className="ext" href={link} target="_blank" rel="noopener noreferrer" title="Open customer in Ascora">{r.name}</a>
                          ) : (
                            <span>{r.name}</span>
                          )}
                          {r.remits.some((x) => x.kind === "remittance") && <span className="pill rem">Remitted {money0.format(r.remAmt)}</span>}
                          {r.remits.some((x) => x.kind === "claim") && <span className="pill clm">Claim approved</span>}
                          {r.total < 0 && <span className="pill cr">In credit</span>}
                          {r.quiet && <span className="pill quiet">{r.pay ? `Quiet ${r.pay.since}d` : "No recent payments"}</span>}
                          {r.dueFollowUps > 0 && <span className="pill fu">Follow up due</span>}
                          {r.notes > 0 && <span className="pill notes" title={`${r.notes} note${r.notes > 1 ? "s" : ""}`}>✎ {r.notes}</span>}
                        </div>
                      </td>
                      <td style={{ textAlign: "left" }}>
                        {brands.length === 0 ? (
                          <span className="muted small">—</span>
                        ) : brands.length > 1 ? (
                          <span className="brand both"><i />Both</span>
                        ) : (
                          <span className={`brand ${brands[0] === "DND" ? "dnd" : "gip"}`}><i />{brands[0]}</span>
                        )}
                      </td>
                      {r.pay ? (
                        <td className={`lp${r.quiet ? " stale" : ""}`}>
                          {fmtDate(r.pay.last)}
                          <span className="d">{r.pay.since === 0 ? "today" : `${r.pay.since}d ago`}</span>
                        </td>
                      ) : (
                        <td className="lp z">–</td>
                      )}
                      {BUCKETS.map((b) => (
                        <MoneyCell key={b.k} v={r.b[b.k]} hot={(b.k === "3" || b.k === "O") && r.b[b.k] > 0.005} />
                      ))}
                      <MoneyCell v={r.over} hot={r.over > 0.005} />
                      <td>
                        <b>{money.format(r.total)}</b>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="inv-row">
                        <td colSpan={COLS.length}>
                          <div className="drawer">
                            <div className="drawer-col">
                              <div className="inv-head">
                                <span>{r.inv.length} open document{r.inv.length > 1 ? "s" : ""}</span>
                                {r.email && (
                                  <span>
                                    Accounts contact: <span style={{ userSelect: "all", color: "var(--ink)" }}>{r.email}</span>
                                  </span>
                                )}
                                {r.oldest > 0 && <span>Oldest overdue: {r.oldest} days</span>}
                                {link && (
                                  <a className="ext" href={link} target="_blank" rel="noopener noreferrer">Customer in Ascora</a>
                                )}
                              </div>
                              <PayBlock r={r} asOf={asOf} paySince={data.paySince} />
                              <div style={{ overflowX: "auto" }}>
                                <table className="inv-table">
                                  <thead>
                                    <tr>
                                      <th scope="col">Document</th>
                                      <th scope="col">Due</th>
                                      <th scope="col">Days overdue</th>
                                      <th scope="col">Bucket</th>
                                      <th scope="col">Brand</th>
                                      <th scope="col">Amount</th>
                                      <th scope="col">Remittance</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {[...r.inv]
                                      .sort((a, b) => ((a.due ?? "") < (b.due ?? "") ? -1 : 1))
                                      .map((i) => {
                                        const b = BUCKETS.find((x) => x.k === i.k)!;
                                        const rm = r.remits.find((x) => x.kind === "remittance" && x.invoices.some((n) => n.toLowerCase() === i.n.toLowerCase()));
                                        const il = invLink(i.n);
                                        return (
                                          <tr key={i.n}>
                                            <td>
                                              {il ? (
                                                <a className="ext" href={il} target="_blank" rel="noopener noreferrer" title="Open invoice in Ascora">{i.n}</a>
                                              ) : (
                                                i.n
                                              )}
                                              {i.t === "credit" && <span className="muted small"> credit</span>}
                                            </td>
                                            <td>{fmtDate(i.due)}</td>
                                            <td>{i.k === "C" || !i.due ? "–" : daysBetween(i.due, asOf)}</td>
                                            <td style={{ fontFamily: "var(--f-body)" }}>
                                              <span className="bdot" style={{ background: b.color }} />
                                              {b.label}
                                            </td>
                                            <td style={{ fontFamily: "var(--f-body)" }}>{i.brand || "—"}</td>
                                            <td>{money.format(i.a)}</td>
                                            <td>{rm ? <span className="remit-mark">{rm.ref ?? "Remitted"}</span> : ""}</td>
                                          </tr>
                                        );
                                      })}
                                  </tbody>
                                </table>
                              </div>
                              {r.remits
                                .filter((x) => x.kind !== "remittance")
                                .map((x) => (
                                  <div key={x.id} className="status">
                                    {x.ref}: {x.note}
                                  </div>
                                ))}
                            </div>
                            <NotesPanel customerId={r.id} customerName={r.name} ascoraLinked={!!r.ascoraId} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr>
                  <td style={{ textAlign: "left", fontFamily: "var(--f-body)" }}>Total</td>
                  <td />
                  <td />
                  {BUCKETS.map((b) => (
                    <td key={b.k}>{money.format(T[b.k])}</td>
                  ))}
                  <td>{money.format(over)}</td>
                  <td>{money.format(total)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      <footer className="status small" style={{ display: "grid", gap: 4 }}>
        <span>
          Refreshed from Xero each morning and through the day; Xero is the source of truth. Brand comes from the Brand tracking category on each invoice line.
          Payment history covers customer payments since {fmtDate(data.paySince)}.
        </span>
      </footer>
    </div>
  );
}

function MoneyCell({ v, hot }: { v: number; hot?: boolean }) {
  if (Math.abs(v) < 0.005) return <td className="z">–</td>;
  return <td className={hot ? "hot" : ""}>{money.format(v)}</td>;
}

function PayBlock({ r, asOf, paySince }: { r: Row; asOf: string; paySince: string | null }) {
  if (!r.pay) return <div className="pay"><div className="pay-sum"><span><b>Recent payments:</b> none recorded since {fmtDate(paySince)}</span></div></div>;
  const p = r.pay;
  const end = Date.parse(asOf);
  const W = 13;
  const wk = new Array(W).fill(0);
  for (const [d, a] of p.list) {
    const i = Math.floor((end - Date.parse(d)) / (7 * 864e5));
    if (i >= 0 && i < W) wk[W - 1 - i] += a;
  }
  const mx = Math.max(...wk, 1);
  return (
    <div className="pay">
      <div className="pay-sum">
        <span><b>Recent payments</b></span>
        <span>Last paid <b>{fmtDate(p.last)}</b> ({p.since === 0 ? "today" : `${p.since} days ago`})</span>
        <span>Last 30 days <b>{money0.format(p.a30)}</b></span>
        <span>Last 90 days <b>{money0.format(p.a90)}</b> over {p.n90} payment date{p.n90 === 1 ? "" : "s"}</span>
      </div>
      <div className="pay-bar" aria-label="Weekly payments, last 13 weeks">
        {wk.map((v, i) => (
          <i key={i} className={v > 0 ? "" : "z"} style={{ height: v > 0 ? Math.max(4, Math.round((v / mx) * 28)) : 2 }} title={v > 0 ? money.format(v) : "No payments"} />
        ))}
      </div>
      <div className="pay-list">
        {p.list.slice(0, 8).map(([d, a]) => (
          <span key={d} className="pay-chip">
            {fmtDate(d)}
            <b>{money.format(a)}</b>
          </span>
        ))}
      </div>
    </div>
  );
}
