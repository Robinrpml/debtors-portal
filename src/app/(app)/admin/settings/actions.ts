"use server";

import { revalidatePath } from "next/cache";
import { assertManager, assertOwner } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { recordRun } from "@/lib/sync/run";
import { syncXero } from "@/lib/sync/xero-sync";
import { syncAscoraCustomers } from "@/lib/sync/ascora-customers";
import { syncRemittances } from "@/lib/sync/remittance-sync";
import { syncAscoraHolds } from "@/lib/sync/ascora-holds";
import { disconnectXero } from "@/lib/xero";
import { getCustomer, setCustomerOnHold } from "@/lib/ascora";

type Job = "sync-xero" | "sync-remittances" | "sync-ascora-customers" | "sync-ascora-holds";
const JOBS: Record<Job, () => Promise<Record<string, unknown>>> = {
  "sync-xero": syncXero,
  "sync-remittances": syncRemittances,
  "sync-ascora-customers": () => syncAscoraCustomers(),
  "sync-ascora-holds": syncAscoraHolds,
};

export async function runJob(job: Job): Promise<{ ok: boolean; error?: string }> {
  const me = await assertManager();
  if (!Object.hasOwn(JOBS, job)) return { ok: false, error: "Unknown job" };
  await audit(me, "sync.manual", job);
  const r = await recordRun<Record<string, unknown>>(job, JOBS[job]);
  revalidatePath("/", "layout");
  return { ok: r.ok, error: r.error };
}

/**
 * Owner-only: puts a (dummy) Ascora customer on hold and straight back, reporting any other field
 * Ascora changed. Works even while ASCORA_HOLD_WRITE_ENABLED is off — it's how you decide to turn it on.
 */
export async function testHoldWrite(ascoraCustomerId: string): Promise<{ ok: boolean; text: string }> {
  const me = await assertOwner();
  const id = ascoraCustomerId.trim();
  if (!/^[0-9a-f-]{32,36}$/i.test(id)) return { ok: false, text: "Paste an Ascora customer ID (the long code in its URL)." };
  try {
    const before = await getCustomer(id);
    if (!before) return { ok: false, text: "No Ascora customer with that ID." };
    const original = !!before.onHold;
    const flipped = await setCustomerOnHold(id, !original);
    const restored = await setCustomerOnHold(id, original);
    const changed = [...new Set([...flipped.changedFields, ...restored.changedFields])];
    await audit(me, "ascora.hold_write_test", before.customerName, { changed });
    if (flipped.onHold === original) return { ok: false, text: "Ascora accepted the update but On Hold didn't change. Writing won't work as built." };
    if (restored.onHold !== original) return { ok: false, text: `On Hold didn't return to ${original}. Check ${before.customerName} in Ascora.` };
    return changed.length
      ? { ok: false, text: `On Hold toggled fine, but Ascora also changed: ${changed.join(", ")}. Don't enable writing yet — check ${before.customerName} in Ascora.` }
      : { ok: true, text: `Passed on ${before.customerName}: On Hold toggled and restored, nothing else changed. Safe to set ASCORA_HOLD_WRITE_ENABLED=true.` };
  } catch (e) {
    return { ok: false, text: e instanceof Error ? e.message : "Ascora error" };
  }
}

export async function disconnect() {
  const me = await assertOwner();
  await disconnectXero();
  await audit(me, "xero.disconnected");
  revalidatePath("/admin/settings");
}
