import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { ascoraConfigured, matchCustomer } from "@/lib/ascora";

/**
 * Map Xero contacts with open balances to Ascora customers.
 * Confirmed/rejected mappings (set by a Manager) are never overwritten.
 */
export async function syncAscoraCustomers(limit = 150) {
  if (!ascoraConfigured()) return { skipped: "ASCORA_API_KEY not set" };
  const db = createAdminClient();
  const { data: withBalance } = await db.from("invoices").select("customer_id");
  const ids = [...new Set((withBalance ?? []).map((r) => r.customer_id as string))];
  if (!ids.length) return { checked: 0 };

  const { data: custs, error } = await db
    .from("customers")
    .select("id,name,email,ascora_match,ascora_checked_at")
    .in("id", ids)
    .in("ascora_match", ["none", "review"])
    .order("ascora_checked_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) throw error;

  let auto = 0, review = 0, none = 0;
  for (const c of custs ?? []) {
    try {
      const r = await matchCustomer(c.name, c.email);
      await db
        .from("customers")
        .update({
          ascora_match: r.match,
          ascora_customer_id: r.match === "auto" ? r.best!.customerId : null,
          ascora_customer_name: r.best?.customerName ?? null,
          ...(r.match === "auto"
            ? { ascora_on_hold: !!r.best!.onHold, ascora_billing_on_hold: !!r.best!.billingCustomerOnHold, ascora_hold_checked_at: new Date().toISOString() }
            : {}),
          ascora_candidates: r.candidates.map((x) => ({ id: x.customerId, name: x.customerName, email: x.emailAddress ?? null })),
          ascora_checked_at: new Date().toISOString(),
        })
        .eq("id", c.id);
      if (r.match === "auto") auto++;
      else if (r.match === "review") review++;
      else none++;
    } catch (e) {
      console.error("ascora match failed", c.name, e);
    }
  }
  return { checked: custs?.length ?? 0, auto, review, none };
}
