import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { melbourneToday } from "@/lib/aging";
import { fmtDate } from "@/lib/format";
import { FollowUpDone } from "./done-button";

export const metadata: Metadata = { title: "Follow-ups" };
export const dynamic = "force-dynamic";

export default async function FollowUpsPage() {
  await requireUser();
  const db = await createClient();
  const today = melbourneToday();
  const { data } = await db
    .from("notes")
    .select("id,body,tag,follow_up_date,author_name,created_at,customers(name)")
    .not("follow_up_date", "is", null)
    .eq("follow_up_done", false)
    .order("follow_up_date", { ascending: true })
    .limit(500);
  const rows = (data ?? []).map((n) => ({ ...n, customer: (Array.isArray(n.customers) ? n.customers[0] : n.customers) as { name: string } | null }));
  const due = rows.filter((r) => r.follow_up_date! <= today);
  const later = rows.filter((r) => r.follow_up_date! > today);

  const table = (list: typeof rows) => (
    <div className="table-scroll">
      <table className="list">
        <thead>
          <tr>
            <th>Due</th>
            <th>Customer</th>
            <th>Note</th>
            <th>By</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.id}>
              <td className={r.follow_up_date! < today ? "err" : ""} style={{ whiteSpace: "nowrap" }}>{fmtDate(r.follow_up_date)}</td>
              <td style={{ fontWeight: 600 }}>{r.customer?.name}</td>
              <td>
                {r.tag && <span className="badge" style={{ marginRight: 6 }}>{r.tag}</span>}
                {r.body}
              </td>
              <td className="muted" style={{ whiteSpace: "nowrap" }}>{r.author_name}</td>
              <td><FollowUpDone id={r.id} /></td>
            </tr>
          ))}
          {list.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">Nothing here.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="wrap" style={{ maxWidth: 1100 }}>
      <div style={{ display: "grid", gap: 6 }}>
        <span className="eyebrow">Collections</span>
        <h1>Follow-ups</h1>
        <p className="muted" style={{ margin: 0 }}>Notes with a follow-up date. Add one from a customer&apos;s notes on the Debtors page.</p>
      </div>
      <section style={{ display: "grid", gap: 10 }}>
        <h2>Due today or overdue · {due.length}</h2>
        {table(due)}
      </section>
      <section style={{ display: "grid", gap: 10 }}>
        <h2>Coming up · {later.length}</h2>
        {table(later)}
      </section>
    </div>
  );
}
