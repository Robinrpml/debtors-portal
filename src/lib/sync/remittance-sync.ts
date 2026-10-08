import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import { optionalEnv } from "@/lib/env";
import {
  missiveConfigured,
  recentConversations,
  conversationMessages,
  getMessage,
  accountsInboxFor,
  conversationUrl,
  downloadAttachment,
  type MissiveMessage,
} from "@/lib/missive";

const MODEL = () => optionalEnv("ANTHROPIC_MODEL") ?? "claude-haiku-5-5";
const LOOKBACK_DAYS_FIRST_RUN = 14;

type Extracted = {
  is_payment_advice: boolean;
  kind: "remittance" | "claim" | "note";
  customer_name: string | null;
  reference: string | null;
  date: string | null;
  amount: number | null;
  invoice_numbers: string[];
  note: string;
};

const TOOL: Anthropic.Tool = {
  name: "record_payment_advice",
  description: "Record what this email tells accounts receivable about a customer payment.",
  input_schema: {
    type: "object",
    properties: {
      is_payment_advice: {
        type: "boolean",
        description: "True only for remittance advice, payment confirmations, approved payment claims/RCTIs, or a customer saying when they will pay. False for quotes, bookings, supplier bills, marketing, and our own outgoing reminders.",
      },
      kind: { type: "string", enum: ["remittance", "claim", "note"], description: "remittance = payment made or scheduled; claim = approved payment claim / RCTI; note = other payment-related info (promise to pay, dispute)." },
      customer_name: { type: ["string", "null"], description: "The paying business or person as named in the email." },
      reference: { type: ["string", "null"], description: "Payment or claim reference (e.g. EFT ref, claim number)." },
      date: { type: ["string", "null"], description: "Payment date YYYY-MM-DD if stated." },
      amount: { type: ["number", "null"], description: "Total amount paid or approved, AUD." },
      invoice_numbers: { type: "array", items: { type: "string" }, description: "Our invoice numbers mentioned, normalised like i4727 (lowercase i + digits)." },
      note: { type: "string", description: "One or two plain sentences for the accounts team: what was paid/approved and anything to check." },
    },
    required: ["is_payment_advice", "kind", "customer_name", "reference", "date", "amount", "invoice_numbers", "note"],
  },
};

const strip = (html: string) =>
  html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

async function extract(client: Anthropic, m: MissiveMessage): Promise<Extracted | null> {
  const content: Anthropic.ContentBlockParam[] = [];
  for (const a of m.attachments ?? []) {
    const isPdf = a.media_type === "application/pdf" || a.extension?.toLowerCase() === "pdf" || a.filename?.toLowerCase().endsWith(".pdf");
    if (!isPdf || !a.url || content.length >= 2) continue;
    const buf = await downloadAttachment(a.url);
    if (buf) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") }, title: a.filename });
  }
  const text = [
    `From: ${m.from_field?.name ?? ""} <${m.from_field?.address ?? ""}>`,
    `Subject: ${m.subject ?? ""}`,
    "",
    strip(m.body ?? m.preview ?? "").slice(0, 12000),
  ].join("\n");
  content.push({ type: "text", text: `Email received by our accounts inbox (insulation contractor, invoices numbered like i4727):\n\n${text}` });

  const res = await client.messages.create({
    model: MODEL(),
    max_tokens: 800,
    tools: [TOOL],
    tool_choice: { type: "tool", name: TOOL.name },
    messages: [{ role: "user", content }],
  });
  const block = res.content.find((b) => b.type === "tool_use");
  return block && block.type === "tool_use" ? (block.input as Extracted) : null;
}

const normName = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/\b(pty|ltd|limited|the)\b/g, "").replace(/[^a-z0-9]/g, "");

export async function syncRemittances() {
  if (!missiveConfigured()) return { skipped: "MISSIVE_API_TOKEN not set" };
  if (!optionalEnv("ANTHROPIC_API_KEY")) return { skipped: "ANTHROPIC_API_KEY not set" };
  const db = createAdminClient();
  const client = new Anthropic();

  const { data: cursorRow } = await db.from("app_state").select("value").eq("key", "missive_cursor").maybeSingle();
  const since = (cursorRow?.value as { since?: number } | null)?.since ?? Math.floor(Date.now() / 1000) - LOOKBACK_DAYS_FIRST_RUN * 86400;
  const startedAt = Math.floor(Date.now() / 1000);

  const convs = await recentConversations(since);
  const { data: invs } = await db.from("invoices").select("number,customer_id");
  const invCustomer = new Map((invs ?? []).map((i) => [String(i.number).toLowerCase(), i.customer_id as string]));
  const { data: custs } = await db.from("customers").select("id,name,email");

  let checked = 0, found = 0;
  for (const c of convs) {
    const msgs = await conversationMessages(c.id);
    for (const summary of msgs) {
      const inbox = accountsInboxFor(summary);
      if (!inbox) continue;
      const fromAddr = summary.from_field?.address?.toLowerCase() ?? "";
      if (fromAddr.endsWith("@dndinsulation.com.au") || fromAddr.endsWith("@gippslandinsulation.com.au")) continue;
      const { data: seen } = await db.from("missive_seen").select("message_id").eq("message_id", summary.id).maybeSingle();
      if (seen) continue;

      checked++;
      let outcome = "not payment advice";
      try {
        const full = await getMessage(summary.id);
        const x = await extract(client, full);
        if (x?.is_payment_advice) {
          const nums = (x.invoice_numbers ?? []).map((n) => n.trim().toLowerCase()).filter((n) => /^i?\d{3,}$/.test(n)).map((n) => (n.startsWith("i") ? n : `i${n}`));
          let customerId = nums.map((n) => invCustomer.get(n)).find(Boolean) ?? null;
          if (!customerId && fromAddr) customerId = custs?.find((k) => k.email?.toLowerCase() === fromAddr)?.id ?? null;
          if (!customerId && x.customer_name) customerId = custs?.find((k) => normName(k.name) === normName(x.customer_name!))?.id ?? null;
          await db.from("remittances").upsert(
            {
              source_key: summary.id,
              inbox,
              customer_id: customerId,
              customer_name_raw: x.customer_name ?? summary.from_field?.name ?? fromAddr,
              kind: x.kind,
              ref: x.reference,
              doc_date: x.date && /^\d{4}-\d{2}-\d{2}$/.test(x.date) ? x.date : null,
              amount: x.amount,
              invoice_numbers: nums,
              note: x.note,
              missive_url: conversationUrl(c),
            },
            { onConflict: "source_key" },
          );
          found++;
          outcome = `flagged ${x.kind}`;
        }
      } catch (e) {
        outcome = `error: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300);
        console.error("remittance extract failed", summary.id, e);
      }
      await db.from("missive_seen").upsert({ message_id: summary.id, conversation_id: c.id, outcome });
    }
  }

  await db.from("app_state").upsert({ key: "missive_cursor", value: { since: startedAt }, updated_at: new Date().toISOString() });
  return { conversations: convs.length, messages_checked: checked, flagged: found };
}
