import "server-only";
import { requireEnv, optionalEnv } from "@/lib/env";

// Missive public API — https://missiveapp.com/help/api-documentation/rest-endpoints
const BASE = "https://public.missiveapp.com/v1";

export const missiveConfigured = () => !!optionalEnv("MISSIVE_API_TOKEN");

/** The accounts inboxes checked for payment advice (comma-separated env override). */
export const accountsAddresses = () =>
  (optionalEnv("MISSIVE_ACCOUNT_ADDRESSES") ?? "accounts@dndinsulation.com.au,accounts@gippslandinsulation.com.au")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

async function missive<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${requireEnv("MISSIVE_API_TOKEN")}` }, cache: "no-store" });
  if (!res.ok) throw new Error(`Missive ${path.split("?")[0]} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

type Addr = { address?: string; name?: string };
export type MissiveConversation = { id: string; subject?: string; latest_message_subject?: string; last_activity_at: number; web_url?: string; app_url?: string };
export type MissiveMessage = {
  id: string;
  subject?: string;
  preview?: string;
  body?: string;
  delivered_at?: number;
  from_field?: Addr;
  to_fields?: Addr[];
  cc_fields?: Addr[];
  attachments?: { id: string; filename: string; media_type?: string; extension?: string; size?: number; url?: string }[];
};

/** Conversations with activity newer than `sinceEpoch` (seconds), newest first, capped. */
export async function recentConversations(sinceEpoch: number, cap = 150): Promise<MissiveConversation[]> {
  const out: MissiveConversation[] = [];
  let until: number | undefined;
  while (out.length < cap) {
    const q = new URLSearchParams({ all: "true", limit: "50" });
    if (until) q.set("until", String(until));
    const { conversations } = await missive<{ conversations: MissiveConversation[] }>(`/conversations?${q}`);
    if (!conversations?.length) break;
    for (const c of conversations) if (c.last_activity_at > sinceEpoch) out.push(c);
    const oldest = conversations[conversations.length - 1].last_activity_at;
    if (oldest <= sinceEpoch || conversations.length < 50 || oldest === until) break;
    until = oldest;
  }
  return out.slice(0, cap);
}

export async function conversationMessages(conversationId: string): Promise<MissiveMessage[]> {
  const { messages } = await missive<{ messages: MissiveMessage[] }>(`/conversations/${conversationId}/messages?limit=10`);
  return messages ?? [];
}

export async function getMessage(id: string): Promise<MissiveMessage> {
  const { messages } = await missive<{ messages: MissiveMessage | MissiveMessage[] }>(`/messages/${id}`);
  return Array.isArray(messages) ? messages[0] : messages;
}

export function conversationUrl(c: MissiveConversation): string {
  return c.web_url ?? c.app_url ?? `https://mail.missiveapp.com/#inbox/conversations/${c.id}`;
}

/** Which accounts inbox (if any) a message was sent to. */
export function accountsInboxFor(m: MissiveMessage): string | null {
  const wanted = accountsAddresses();
  const to = [...(m.to_fields ?? []), ...(m.cc_fields ?? [])].map((a) => a.address?.toLowerCase() ?? "");
  return wanted.find((w) => to.includes(w)) ?? null;
}

export async function downloadAttachment(url: string, maxBytes = 4_500_000): Promise<Buffer | null> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length <= maxBytes ? buf : null;
}
