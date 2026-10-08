"use server";

import { revalidatePath } from "next/cache";
import { assertManager } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import { retryNoteSync } from "../../notes-actions";

export async function confirmMapping(customerId: string, ascoraId: string, ascoraName: string | null) {
  const me = await assertManager();
  const id = ascoraId.trim();
  if (!/^[0-9a-f-]{32,36}$/i.test(id)) throw new Error("That doesn't look like an Ascora customer ID");
  const db = createAdminClient();
  await db.from("customers").update({ ascora_customer_id: id, ascora_customer_name: ascoraName, ascora_match: "confirmed" }).eq("id", customerId);
  await audit(me, "mapping.confirmed", customerId, { ascora_id: id });
  // Push any notes written before the customer was matched.
  const { data: waiting } = await db.from("notes").select("id").eq("customer_id", customerId).in("sync_status", ["skipped", "failed"]).eq("source", "portal");
  for (const n of waiting ?? []) await retryNoteSync(n.id);
  revalidatePath("/admin/mappings");
  revalidatePath("/");
}

export async function rejectMapping(customerId: string) {
  const me = await assertManager();
  await createAdminClient().from("customers").update({ ascora_customer_id: null, ascora_match: "rejected" }).eq("id", customerId);
  await audit(me, "mapping.rejected", customerId);
  revalidatePath("/admin/mappings");
}

export async function resetMapping(customerId: string) {
  const me = await assertManager();
  await createAdminClient().from("customers").update({ ascora_customer_id: null, ascora_match: "none", ascora_checked_at: null }).eq("id", customerId);
  await audit(me, "mapping.reset", customerId);
  revalidatePath("/admin/mappings");
}

export async function setBrandOverride(customerId: string, brand: "DND" | "Gippsland" | null) {
  const me = await assertManager();
  await createAdminClient().from("customers").update({ brand_override: brand }).eq("id", customerId);
  await audit(me, "customer.brand_override", customerId, { brand });
  revalidatePath("/admin/mappings");
  revalidatePath("/");
}
