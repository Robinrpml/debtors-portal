"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertManager } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ascoraConfigured, holdWriteEnabled, setCustomerOnHold, createCustomerNote } from "@/lib/ascora";
import { audit } from "@/lib/audit";

const Input = z.object({ customerId: z.string().uuid(), onHold: z.boolean(), reason: z.string().trim().max(500).optional() });

/**
 * Managers only. Writes On Hold to Ascora (Ascora stays the source of truth), then mirrors it locally
 * and records a note + audit entry.
 */
export async function setOnHold(input: z.input<typeof Input>): Promise<{ ok: boolean; error?: string; warning?: string }> {
  const me = await assertManager();
  const p = Input.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid request" };
  const { customerId, onHold, reason } = p.data;

  if (!ascoraConfigured()) return { ok: false, error: "Ascora isn't connected yet." };
  if (!holdWriteEnabled()) return { ok: false, error: "Changing On Hold from the portal is switched off (ASCORA_HOLD_WRITE_ENABLED)." };

  const db = createAdminClient();
  const { data: c } = await db.from("customers").select("id,name,ascora_customer_id,ascora_match").eq("id", customerId).single();
  if (!c?.ascora_customer_id || !["auto", "confirmed"].includes(c.ascora_match)) {
    return { ok: false, error: "This customer isn't matched to Ascora yet. Link it on the Ascora mapping page first." };
  }

  let result: Awaited<ReturnType<typeof setCustomerOnHold>>;
  try {
    result = await setCustomerOnHold(c.ascora_customer_id, onHold);
  } catch (e) {
    await audit(me, onHold ? "customer.hold_failed" : "customer.release_failed", customerId, { error: String(e) });
    return { ok: false, error: e instanceof Error ? e.message : "Ascora update failed" };
  }

  await db
    .from("customers")
    .update({ ascora_on_hold: result.onHold, ascora_billing_on_hold: result.billingCustomerOnHold, ascora_hold_checked_at: new Date().toISOString() })
    .eq("id", customerId);

  const who = me.full_name || me.email;
  const body = `${onHold ? "Put on hold" : "Released from hold"} in Ascora by ${who}.${reason ? `\nReason: ${reason}` : ""}`;
  const { data: note } = await db
    .from("notes")
    .insert({ customer_id: customerId, author_id: me.id, author_name: who, body, tag: "Other", sync_status: "pending" })
    .select("id")
    .single();
  if (note) {
    try {
      const id = await createCustomerNote(c.ascora_customer_id, `${body}\n— via Debtors portal`, who);
      await db.from("notes").update({ sync_status: "synced", ascora_note_id: id }).eq("id", note.id);
    } catch (e) {
      await db.from("notes").update({ sync_status: "failed", sync_error: String(e).slice(0, 300) }).eq("id", note.id);
    }
  }

  await audit(me, onHold ? "customer.put_on_hold" : "customer.released", c.name, { ascora_id: c.ascora_customer_id, reason, changed_fields: result.changedFields });
  revalidatePath("/");

  const warning =
    result.onHold !== onHold
      ? "Ascora accepted the change but still reports the old status — check the customer in Ascora."
      : result.changedFields.length
        ? `Heads up: Ascora also changed ${result.changedFields.join(", ")} on this customer. Check it in Ascora.`
        : undefined;
  return { ok: true, warning };
}
