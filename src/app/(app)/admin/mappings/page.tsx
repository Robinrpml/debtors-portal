import type { Metadata } from "next";
import { requireManager } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectAll } from "@/lib/data";
import { linkTemplates } from "@/lib/ascora";
import { MappingsTable, type MapRow } from "./mappings-table";

export const metadata: Metadata = { title: "Ascora mapping" };
export const dynamic = "force-dynamic";

export default async function MappingsPage() {
  await requireManager();
  const db = createAdminClient();
  const invoices = await selectAll<{ customer_id: string; brand: string | null; amount_due: number }>((f, t) => db.from("invoices").select("customer_id,brand,amount_due").order("xero_invoice_id").range(f, t));
  const byCust = new Map<string, { total: number; untagged: number }>();
  for (const i of invoices) {
    const s = byCust.get(i.customer_id) ?? { total: 0, untagged: 0 };
    s.total += Number(i.amount_due);
    if (!i.brand) s.untagged++;
    byCust.set(i.customer_id, s);
  }
  const custs = await selectAll<{
    id: string; name: string; email: string | null; brand_override: string | null; ascora_customer_id: string | null; ascora_customer_name: string | null; ascora_match: string; ascora_candidates: { id: string; name: string; email: string | null }[] | null;
  }>((f, t) => db.from("customers").select("id,name,email,brand_override,ascora_customer_id,ascora_customer_name,ascora_match,ascora_candidates").order("name").range(f, t));

  const rows: MapRow[] = custs
    .filter((c) => byCust.has(c.id))
    .map((c) => ({ ...c, total: byCust.get(c.id)!.total, untagged: byCust.get(c.id)!.untagged }));

  return (
    <div className="wrap" style={{ maxWidth: 1300 }}>
      <div style={{ display: "grid", gap: 6 }}>
        <span className="eyebrow">Administration</span>
        <h1>Ascora mapping</h1>
        <p className="muted" style={{ margin: 0, maxWidth: 760 }}>
          Each Xero customer with a balance is matched to an Ascora customer so names link to Ascora and notes sync there.
          Exact name matches are linked automatically; check the ones marked <b>Review</b>. Brand override applies only to invoices that have no Brand tracking in Xero.
        </p>
      </div>
      <MappingsTable rows={rows} customerUrl={linkTemplates().customer} />
    </div>
  );
}
