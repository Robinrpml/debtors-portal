import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Ascora web hook receiver. Subscribe with:
 *   POST https://api.ascora.com.au/WebHooks
 *   { "hookUrl": "https://<site>/api/webhooks/ascora?secret=<ASCORA_WEBHOOK_SECRET>", "systemName": "Debtors Portal", "hookEvent": "InvoiceCreated" }
 * (repeat for InvoiceModified). Ascora's docs don't define the payload, so we store it raw and
 * pull out any invoice id/number pair we can find, to build invoice deep links.
 */
export async function POST(req: NextRequest) {
  if (!safeEqual(req.nextUrl.searchParams.get("secret"), process.env.ASCORA_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const payload = await req.json().catch(() => null);
  if (!payload || typeof payload !== "object") return NextResponse.json({ error: "Bad payload" }, { status: 400 });

  const db = createAdminClient();
  const event = String((payload as Record<string, unknown>).hookEvent ?? (payload as Record<string, unknown>).event ?? "unknown");
  await db.from("ascora_events").insert({ event, payload });

  const pairs = findInvoicePairs(payload);
  if (pairs.length) {
    await db.from("ascora_invoice_ids").upsert(
      pairs.map((p) => ({ invoice_number: p.number.toLowerCase(), ascora_invoice_id: p.id, updated_at: new Date().toISOString() })),
    );
  }
  return NextResponse.json({ ok: true, invoices: pairs.length });
}

function findInvoicePairs(node: unknown, out: { id: string; number: string }[] = []): { id: string; number: string }[] {
  if (Array.isArray(node)) node.forEach((n) => findInvoicePairs(n, out));
  else if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    const lower = Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));
    const number = lower.invoicenumber;
    const id = lower.invoiceid ?? (number ? lower.id : undefined);
    if (typeof number === "string" && typeof id === "string" && id.length >= 8) out.push({ id, number });
    Object.values(o).forEach((v) => findInvoicePairs(v, out));
  }
  return out;
}
