import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { ascoraConfigured, getCustomer } from "@/lib/ascora";

/** Refresh Ascora On Hold flags for every matched customer with an open balance. */
export async function syncAscoraHolds() {
  if (!ascoraConfigured()) return { skipped: "ASCORA_API_KEY not set" };
  const db = createAdminClient();
  const { data: withBalance } = await db.from("invoices").select("customer_id");
  const ids = [...new Set((withBalance ?? []).map((r) => r.customer_id as string))];
  if (!ids.length) return { checked: 0 };

  const { data: custs, error } = await db
    .from("customers")
    .select("id,ascora_customer_id")
    .in("id", ids)
    .in("ascora_match", ["auto", "confirmed"])
    .not("ascora_customer_id", "is", null);
  if (error) throw error;

  let checked = 0, onHold = 0, failed = 0;
  for (const c of custs ?? []) {
    try {
      const a = await getCustomer(c.ascora_customer_id!);
      if (!a) continue;
      await db
        .from("customers")
        .update({ ascora_on_hold: !!a.onHold, ascora_billing_on_hold: !!a.billingCustomerOnHold, ascora_hold_checked_at: new Date().toISOString() })
        .eq("id", c.id);
      checked++;
      if (a.onHold || a.billingCustomerOnHold) onHold++;
    } catch (e) {
      failed++;
      console.error("ascora hold check failed", c.id, e);
    }
  }
  return { checked, on_hold: onHold, failed };
}
