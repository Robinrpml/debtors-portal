"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertUser, assertManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ascoraConfigured, createCustomerNote } from "@/lib/ascora";
import { audit } from "@/lib/audit";

export type NoteView = {
  id: string;
  author: string;
  body: string;
  tag: string | null;
  followUp: string | null;
  followUpDone: boolean;
  source: "portal" | "ascora";
  sync: "pending" | "synced" | "failed" | "skipped";
  syncError: string | null;
  at: string;
};

export async function listNotes(customerId: string): Promise<NoteView[]> {
  await assertUser();
  const db = await createClient(); // RLS applies
  const { data, error } = await db
    .from("notes")
    .select("id,author_name,body,tag,follow_up_date,follow_up_done,source,sync_status,sync_error,created_at")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []).map((n) => ({
    id: n.id,
    author: n.author_name,
    body: n.body,
    tag: n.tag,
    followUp: n.follow_up_date,
    followUpDone: n.follow_up_done,
    source: n.source,
    sync: n.sync_status,
    syncError: n.sync_error,
    at: n.created_at,
  }));
}

const NoteInput = z.object({
  customerId: z.string().uuid(),
  body: z.string().trim().min(1, "Write a note first.").max(4000),
  tag: z.enum(["Called", "Emailed", "Promised to pay", "Disputed", "Other"]).nullable(),
  followUp: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

/** Save locally first, then push to Ascora. A failed push is kept and can be retried. */
export async function addNote(input: z.input<typeof NoteInput>): Promise<{ ok: boolean; error?: string }> {
  const me = await assertUser();
  const parsed = NoteInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid note" };
  const { customerId, body, tag, followUp } = parsed.data;

  // The user must be able to see this customer (RLS check via their own client).
  const userDb = await createClient();
  const { data: visible } = await userDb.from("customers").select("id").eq("id", customerId).maybeSingle();
  if (!visible) return { ok: false, error: "Customer not found" };

  const db = createAdminClient();
  const { data: note, error } = await db
    .from("notes")
    .insert({ customer_id: customerId, author_id: me.id, author_name: me.full_name || me.email, body, tag, follow_up_date: followUp, sync_status: "pending" })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  await audit(me, "note.added", customerId, { note_id: note.id });

  await pushToAscora(note.id);
  revalidatePath("/");
  revalidatePath("/follow-ups");
  return { ok: true };
}

export async function retryNoteSync(noteId: string) {
  await assertUser();
  await pushToAscora(noteId);
  revalidatePath("/");
}

export async function completeFollowUp(noteId: string) {
  const me = await assertUser();
  const userDb = await createClient();
  const { data: visible } = await userDb.from("notes").select("id").eq("id", noteId).maybeSingle();
  if (!visible) throw new Error("Note not found");
  await createAdminClient().from("notes").update({ follow_up_done: true }).eq("id", noteId);
  await audit(me, "note.follow_up_done", noteId);
  revalidatePath("/");
  revalidatePath("/follow-ups");
}

async function pushToAscora(noteId: string) {
  const db = createAdminClient();
  const { data: n } = await db.from("notes").select("id,body,tag,author_name,follow_up_date,customer_id,customers(ascora_customer_id,ascora_match)").eq("id", noteId).single();
  if (!n) return;
  const cust = (Array.isArray(n.customers) ? n.customers[0] : n.customers) as { ascora_customer_id: string | null; ascora_match: string } | null;
  if (!ascoraConfigured()) {
    await db.from("notes").update({ sync_status: "skipped", sync_error: "Ascora isn't connected yet" }).eq("id", noteId);
    return;
  }
  if (!cust?.ascora_customer_id || !["auto", "confirmed"].includes(cust.ascora_match)) {
    await db.from("notes").update({ sync_status: "skipped", sync_error: "Customer isn't matched to Ascora yet" }).eq("id", noteId);
    return;
  }
  const text = [n.tag ? `[${n.tag}]` : null, n.body, n.follow_up_date ? `Follow up: ${n.follow_up_date}` : null, "— via Debtors portal"].filter(Boolean).join("\n");
  try {
    const ascoraId = await createCustomerNote(cust.ascora_customer_id, text, n.author_name);
    await db.from("notes").update({ sync_status: "synced", sync_error: null, ascora_note_id: ascoraId }).eq("id", noteId);
  } catch (e) {
    await db.from("notes").update({ sync_status: "failed", sync_error: e instanceof Error ? e.message.slice(0, 300) : "Ascora error" }).eq("id", noteId);
  }
}

export async function dismissRemittance(id: string) {
  const me = await assertManager();
  await createAdminClient().from("remittances").update({ status: "dismissed", status_by: me.id, status_at: new Date().toISOString() }).eq("id", id);
  await audit(me, "remittance.dismissed", id);
  revalidatePath("/");
}
