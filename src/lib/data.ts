import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Supabase caps each select at 1,000 rows; page through to get them all. */
export async function selectAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

export type DashInvoice = { n: string; c: string; b: string | null; d: string | null; a: number; t: "invoice" | "credit" };
export type DashCustomer = {
  id: string;
  name: string;
  email: string | null;
  brandOverride: string | null;
  ascoraId: string | null;
  onHold: boolean;
  billingOnHold: boolean;
};
export type DashPayment = { c: string; d: string; a: number };
export type DashRemittance = {
  id: string;
  customerId: string | null;
  customerName: string | null;
  kind: "remittance" | "claim" | "note";
  ref: string | null;
  date: string | null;
  amount: number | null;
  invoices: string[];
  note: string | null;
  url: string | null;
  inbox: string | null;
};
export type DashNoteStat = { c: string; count: number; dueFollowUps: number; last: string | null };

export type DashboardData = {
  asOf: string;
  refreshedAt: string | null;
  paySince: string | null;
  invoices: DashInvoice[];
  customers: DashCustomer[];
  payments: DashPayment[];
  remittances: DashRemittance[];
  noteStats: DashNoteStat[];
  ascoraInvoiceIds: Record<string, string>;
  links: { customer: string | null; invoice: string | null };
  holdWrite: boolean;
};

export async function loadDashboard(db: SupabaseClient, asOfFallback: string, links: DashboardData["links"], holdWrite = false): Promise<DashboardData> {
  const [snap, invoices, customers, payments, remits, notes, ascoraIds] = await Promise.all([
    db.from("app_state").select("value").eq("key", "snapshot").maybeSingle(),
    selectAll<{ number: string; customer_id: string; brand: string | null; due_date: string | null; amount_due: number; doc_type: "invoice" | "credit" }>((f, t) =>
      db.from("invoices").select("number,customer_id,brand,due_date,amount_due,doc_type").order("xero_invoice_id").range(f, t),
    ),
    selectAll<{
      id: string; name: string; email: string | null; brand_override: string | null; ascora_customer_id: string | null; ascora_match: string; ascora_on_hold: boolean; ascora_billing_on_hold: boolean;
    }>((f, t) =>
      db.from("customers").select("id,name,email,brand_override,ascora_customer_id,ascora_match,ascora_on_hold,ascora_billing_on_hold").order("id").range(f, t),
    ),
    selectAll<{ customer_id: string; paid_date: string; amount: number }>((f, t) => db.from("payments").select("customer_id,paid_date,amount").order("id").range(f, t)),
    db.from("remittances").select("id,customer_id,customer_name_raw,kind,ref,doc_date,amount,invoice_numbers,note,missive_url,inbox").eq("status", "open").order("doc_date", { ascending: false }),
    selectAll<{ customer_id: string; follow_up_date: string | null; follow_up_done: boolean; created_at: string }>((f, t) =>
      db.from("notes").select("customer_id,follow_up_date,follow_up_done,created_at").order("id").range(f, t),
    ),
    selectAll<{ invoice_number: string; ascora_invoice_id: string }>((f, t) => db.from("ascora_invoice_ids").select("invoice_number,ascora_invoice_id").order("invoice_number").range(f, t)),
  ]);

  const s = (snap.data?.value ?? {}) as { as_of?: string; refreshed_at?: string; pay_since?: string };
  const asOf = s.as_of ?? asOfFallback;
  const used = new Set(invoices.map((i) => i.customer_id));

  const stats = new Map<string, DashNoteStat>();
  for (const n of notes) {
    const st = stats.get(n.customer_id) ?? { c: n.customer_id, count: 0, dueFollowUps: 0, last: null };
    st.count++;
    if (n.follow_up_date && !n.follow_up_done && n.follow_up_date <= asOf) st.dueFollowUps++;
    if (!st.last || n.created_at > st.last) st.last = n.created_at;
    stats.set(n.customer_id, st);
  }

  return {
    asOf,
    refreshedAt: s.refreshed_at ?? null,
    paySince: s.pay_since ?? null,
    invoices: invoices.map((i) => ({ n: i.number, c: i.customer_id, b: i.brand, d: i.due_date, a: Number(i.amount_due), t: i.doc_type })),
    customers: customers
      .filter((c) => used.has(c.id))
      .map((c) => {
        const linked = ["auto", "confirmed"].includes(c.ascora_match);
        return {
          id: c.id,
          name: c.name,
          email: c.email,
          brandOverride: c.brand_override,
          ascoraId: linked ? c.ascora_customer_id : null,
          onHold: linked && c.ascora_on_hold,
          billingOnHold: linked && c.ascora_billing_on_hold,
        };
      }),
    payments: payments.filter((p) => used.has(p.customer_id)).map((p) => ({ c: p.customer_id, d: p.paid_date, a: Number(p.amount) })),
    remittances: (remits.data ?? []).map((r) => ({
      id: r.id,
      customerId: r.customer_id,
      customerName: r.customer_name_raw,
      kind: r.kind,
      ref: r.ref,
      date: r.doc_date,
      amount: r.amount == null ? null : Number(r.amount),
      invoices: r.invoice_numbers ?? [],
      note: r.note,
      url: r.missive_url,
      inbox: r.inbox,
    })),
    noteStats: [...stats.values()],
    ascoraInvoiceIds: Object.fromEntries(ascoraIds.map((x) => [x.invoice_number.toLowerCase(), x.ascora_invoice_id])),
    links,
    holdWrite,
  };
}
