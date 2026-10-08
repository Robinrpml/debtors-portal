import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { recordRun } from "@/lib/sync/run";
import { syncXero } from "@/lib/sync/xero-sync";
import { syncAscoraCustomers } from "@/lib/sync/ascora-customers";
import { syncRemittances } from "@/lib/sync/remittance-sync";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const JOBS: Record<string, () => Promise<Record<string, unknown>>> = {
  "sync-xero": syncXero,
  "sync-ascora-customers": () => syncAscoraCustomers(),
  "sync-remittances": syncRemittances,
  // Runs everything in order; used by the daily Vercel cron.
  "sync-all": async () => {
    const xero = await recordRun("sync-xero", syncXero);
    const remittances = await recordRun("sync-remittances", syncRemittances);
    const ascora = await recordRun("sync-ascora-customers", () => syncAscoraCustomers());
    return { xero: xero.ok, remittances: remittances.ok, ascora: ascora.ok };
  },
};

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
async function handle(req: NextRequest, ctx: RouteContext<"/api/cron/[job]">) {
  const auth = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!safeEqual(auth, process.env.CRON_SECRET)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const { job } = await ctx.params;
  const fn = JOBS[job];
  if (!fn) return NextResponse.json({ error: "Unknown job" }, { status: 404 });
  const result = job === "sync-all" ? { ok: true, detail: await fn() } : await recordRun(job, fn);
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export const GET = handle;
export const POST = handle;
