"use server";

import { revalidatePath } from "next/cache";
import { assertManager, assertOwner } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { recordRun } from "@/lib/sync/run";
import { syncXero } from "@/lib/sync/xero-sync";
import { syncAscoraCustomers } from "@/lib/sync/ascora-customers";
import { syncRemittances } from "@/lib/sync/remittance-sync";
import { disconnectXero } from "@/lib/xero";

type Job = "sync-xero" | "sync-remittances" | "sync-ascora-customers";
const JOBS: Record<Job, () => Promise<Record<string, unknown>>> = {
  "sync-xero": syncXero,
  "sync-remittances": syncRemittances,
  "sync-ascora-customers": () => syncAscoraCustomers(),
};

export async function runJob(job: Job): Promise<{ ok: boolean; error?: string }> {
  const me = await assertManager();
  if (!Object.hasOwn(JOBS, job)) return { ok: false, error: "Unknown job" };
  await audit(me, "sync.manual", job);
  const r = await recordRun<Record<string, unknown>>(job, JOBS[job]);
  revalidatePath("/", "layout");
  return { ok: r.ok, error: r.error };
}

export async function disconnect() {
  const me = await assertOwner();
  await disconnectXero();
  await audit(me, "xero.disconnected");
  revalidatePath("/admin/settings");
}
