import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/** Wrap a job so every run is recorded in sync_runs (shown on Settings). */
export async function recordRun<T extends Record<string, unknown>>(job: string, fn: () => Promise<T>): Promise<{ ok: boolean; detail?: T; error?: string }> {
  const db = createAdminClient();
  const { data: run } = await db.from("sync_runs").insert({ job }).select("id").single();
  try {
    const detail = await fn();
    await db.from("sync_runs").update({ finished_at: new Date().toISOString(), ok: true, detail }).eq("id", run?.id);
    return { ok: true, detail };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[${job}]`, e);
    await db.from("sync_runs").update({ finished_at: new Date().toISOString(), ok: false, error }).eq("id", run?.id);
    return { ok: false, error };
  }
}
