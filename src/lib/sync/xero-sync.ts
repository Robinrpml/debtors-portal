import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { xeroGetAll, xeroGet, xeroDate, brandFromLines, type XeroInvoice, type XeroCreditNote, type XeroPayment, type XeroContact } from "@/lib/xero";
import { melbourneToday } from "@/lib/aging";

const PAYMENT_HISTORY_DAYS = 120;

/**
 * Replace the debtors snapshot from Xero:
 *  - AUTHORISED sales invoices with an amount due (brand from the "Brand" tracking category)
 *  - AUTHORISED sales credit notes with remaining credit (stored as negative amounts)
 *  - customer payments for the last ~120 days (payment history strip)
 */
export async function syncXero() {
  const db = createAdminClient();
  const asOf = melbourneToday();

  const invoices = (
    await xeroGetAll<XeroInvoice>(`/Invoices?Statuses=AUTHORISED&where=${encodeURIComponent('Type=="ACCREC"')}`, "Invoices")
  ).filter((i) => i.AmountDue > 0.004);

  const credits = (
    await xeroGetAll<XeroCreditNote>(`/CreditNotes?where=${encodeURIComponent('Type=="ACCRECCREDIT" AND Status=="AUTHORISED"')}`, "CreditNotes")
  ).filter((c) => c.RemainingCredit > 0.004);

  const since = new Date(Date.now() - PAYMENT_HISTORY_DAYS * 864e5);
  const where = `Date>=DateTime(${since.getUTCFullYear()},${since.getUTCMonth() + 1},${since.getUTCDate()}) AND PaymentType=="ACCRECPAYMENT" AND Status=="AUTHORISED"`;
  const payments = await xeroGetAll<XeroPayment>(`/Payments?where=${encodeURIComponent(where)}`, "Payments");

  // Contacts referenced by anything we store
  const contactNames = new Map<string, string>();
  for (const i of invoices) contactNames.set(i.Contact.ContactID, i.Contact.Name);
  for (const c of credits) contactNames.set(c.Contact.ContactID, c.Contact.Name);
  for (const p of payments) if (p.Invoice?.Contact) contactNames.set(p.Invoice.Contact.ContactID, p.Invoice.Contact.Name);

  const emails = new Map<string, string | null>();
  const ids = [...contactNames.keys()];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const json = await xeroGet<{ Contacts: XeroContact[] }>(`/Contacts?IDs=${batch.join(",")}`);
    for (const c of json.Contacts ?? []) {
      emails.set(c.ContactID, c.EmailAddress || null);
      contactNames.set(c.ContactID, c.Name);
    }
  }

  // Upsert customers (keeps Ascora mapping + brand overrides untouched)
  const customerRows = ids.map((id) => ({ xero_contact_id: id, name: contactNames.get(id)!, email: emails.get(id) ?? null, updated_at: new Date().toISOString() }));
  for (let i = 0; i < customerRows.length; i += 500) {
    const { error } = await db.from("customers").upsert(customerRows.slice(i, i + 500), { onConflict: "xero_contact_id" });
    if (error) throw error;
  }
  const { data: custs, error: cErr } = await db.from("customers").select("id,xero_contact_id");
  if (cErr) throw cErr;
  const custId = new Map(custs!.map((c) => [c.xero_contact_id as string, c.id as string]));

  const now = new Date().toISOString();
  const invRows = [
    ...invoices.map((i) => ({
      xero_invoice_id: i.InvoiceID,
      number: i.InvoiceNumber,
      customer_id: custId.get(i.Contact.ContactID)!,
      doc_type: "invoice",
      brand: brandFromLines(i.LineItems),
      reference: i.Reference ?? null,
      issue_date: xeroDate(i.DateString),
      due_date: xeroDate(i.DueDateString),
      total: i.Total,
      amount_due: i.AmountDue,
      synced_at: now,
    })),
    ...credits.map((c) => ({
      xero_invoice_id: c.CreditNoteID,
      number: c.CreditNoteNumber,
      customer_id: custId.get(c.Contact.ContactID)!,
      doc_type: "credit",
      brand: brandFromLines(c.LineItems),
      reference: c.Reference ?? null,
      issue_date: xeroDate(c.DateString),
      due_date: xeroDate(c.DateString),
      total: -c.Total,
      amount_due: -c.RemainingCredit,
      synced_at: now,
    })),
  ];

  // Replace the snapshot: upsert current docs, then delete anything not seen this run.
  for (let i = 0; i < invRows.length; i += 500) {
    const { error } = await db.from("invoices").upsert(invRows.slice(i, i + 500), { onConflict: "xero_invoice_id" });
    if (error) throw error;
  }
  const { error: delErr } = await db.from("invoices").delete().lt("synced_at", now);
  if (delErr) throw delErr;

  const payRows = payments
    .filter((p) => p.Invoice?.Contact && custId.has(p.Invoice.Contact.ContactID))
    .map((p) => ({
      id: p.PaymentID,
      customer_id: custId.get(p.Invoice!.Contact!.ContactID)!,
      paid_date: xeroDate(p.Date)!,
      amount: p.Amount,
      invoice_number: p.Invoice?.InvoiceNumber ?? null,
    }));
  for (let i = 0; i < payRows.length; i += 500) {
    const { error } = await db.from("payments").upsert(payRows.slice(i, i + 500));
    if (error) throw error;
  }
  await db.from("payments").delete().lt("paid_date", since.toISOString().slice(0, 10));

  // Remittances whose invoices are all now paid in Xero close themselves.
  const open = new Set(invoices.map((i) => i.InvoiceNumber.toLowerCase()));
  const { data: rems } = await db.from("remittances").select("id,invoice_numbers").eq("status", "open").eq("kind", "remittance");
  const applied = (rems ?? []).filter((r) => r.invoice_numbers?.length && r.invoice_numbers.every((n: string) => !open.has(n.toLowerCase()))).map((r) => r.id);
  if (applied.length) await db.from("remittances").update({ status: "applied", status_at: now }).in("id", applied);

  const total = invRows.reduce((s, r) => s + Number(r.amount_due), 0);
  await db.from("app_state").upsert({
    key: "snapshot",
    value: { as_of: asOf, refreshed_at: now, pay_since: since.toISOString().slice(0, 10), total, documents: invRows.length, customers: new Set(invRows.map((r) => r.customer_id)).size },
    updated_at: now,
  });

  return { invoices: invoices.length, credits: credits.length, payments: payRows.length, total: Math.round(total * 100) / 100, remittances_applied: applied.length };
}
