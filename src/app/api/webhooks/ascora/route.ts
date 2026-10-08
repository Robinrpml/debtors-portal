import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { ascoraConfigured, getCustomer } from "@/lib/ascora";

export const dynamic = "force-dynamic";

/**
 * Ascora web hook receiver. Subscribe with:
 *   POST https://api.ascora.com.au/WebHooks
 *   { "hookUrl": "https://<site>/api/webhooks/ascora?secret=<ASCORA_WEBHOOK_SECRET>", "systemName": "Debtors Portal", "hookEvent": "InvoiceCreated" }
 * (repeat for InvoiceModified and CustomerModified). Ascora's docs don't define the payload, so we store it raw and
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
  // CustomerModified / CustomerCreated: refresh On Hold for any customer we have mapped.
  // The payload shape isn't documented, so we take the customer IDs it mentions and re-read them from Ascora.
  let holds = 0;
  if (/^customer/i.test(event) && ascoraConfigured()) {
    const ids = [...new Set(findCustomerIds(payload))].slice(0, 10);
    if (ids.length) {
      const { data: mapped } = await db.from("customers").select("id,ascora_customer_id").in("ascora_customer_id", ids);
      for (const m of mapped ?? []) {
        const a = await getCustomer(m.ascora_customer_id!).catch(() => null);
        if (!a) continue;
        await db
          .from("customers")
          .update({ ascora_on_hold: !!a.onHold, ascora_billing_on_hold: !!a.billingCustomerOnHold, ascora_hold_checked_at: new Date().toISOString() })
          .eq("id", m.id);
        holds++;
      }
    }
  }
  return NextResponse.json({ ok: true, invoices: pairs.length, customers: holds });
}

function findCustomerIds(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((n) => findCustomerIds(n, out));
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (/^(customerid|entityid)$/i.test(k) && typeof v === "string" && /^[0-9a-f-]{32,36}$/i.test(v)) out.push(v.toLowerCase());
      else findCustomerIds(v, out);
    }
  }
  return out;
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
