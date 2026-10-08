import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt, decrypt } from "@/lib/crypto";
import { requireEnv, optionalEnv, siteUrl } from "@/lib/env";

// Xero OAuth 2.0 (authorization-code flow, one Xero organisation).
// Apps created after 2 March 2026 must use Xero's granular scopes; override with XERO_SCOPES if Xero rejects these.
const DEFAULT_SCOPES = "offline_access accounting.invoices.read accounting.payments.read accounting.contacts.read";
const AUTH_URL = "https://login.xero.com/identity/connect/authorize";
const TOKEN_URL = "https://identity.xero.com/connect/token";
const API = "https://api.xero.com/api.xro/2.0";

const SECRET_KEY = "xero_tokens";

type Tokens = { access_token: string; refresh_token: string; expires_at: number; tenant_id?: string; tenant_name?: string };

export const xeroScopes = () => optionalEnv("XERO_SCOPES") ?? DEFAULT_SCOPES;
export const xeroRedirectUri = () => `${siteUrl()}/api/xero/callback`;

export function xeroAuthorizeUrl(state: string): string {
  const u = new URL(AUTH_URL);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", requireEnv("XERO_CLIENT_ID"));
  u.searchParams.set("redirect_uri", xeroRedirectUri());
  u.searchParams.set("scope", xeroScopes());
  u.searchParams.set("state", state);
  return u.toString();
}

async function tokenRequest(body: Record<string, string>): Promise<Omit<Tokens, "tenant_id" | "tenant_name">> {
  const basic = Buffer.from(`${requireEnv("XERO_CLIENT_ID")}:${requireEnv("XERO_CLIENT_SECRET")}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Xero token error ${res.status}: ${json.error ?? "unknown"}`);
  return { access_token: json.access_token, refresh_token: json.refresh_token, expires_at: Date.now() + (json.expires_in - 60) * 1000 };
}

async function saveTokens(t: Tokens) {
  const db = createAdminClient();
  const { error } = await db.from("integration_secrets").upsert({ key: SECRET_KEY, value: encrypt(JSON.stringify(t)), updated_at: new Date().toISOString() });
  if (error) throw error;
  await db.from("app_state").upsert({
    key: "xero_connection",
    value: { tenant_name: t.tenant_name ?? null, connected: true, refreshed_at: new Date().toISOString() },
    updated_at: new Date().toISOString(),
  });
}

async function loadTokens(): Promise<Tokens | null> {
  const { data } = await createAdminClient().from("integration_secrets").select("value").eq("key", SECRET_KEY).maybeSingle();
  return data ? (JSON.parse(decrypt(data.value)) as Tokens) : null;
}

/** Exchange the OAuth code, pick the organisation and store tokens encrypted. */
export async function completeXeroConnection(code: string): Promise<string> {
  const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: xeroRedirectUri() });
  const conns = await fetch("https://api.xero.com/connections", { headers: { Authorization: `Bearer ${t.access_token}` }, cache: "no-store" }).then((r) => r.json());
  const want = optionalEnv("XERO_TENANT_NAME")?.toLowerCase();
  const org = (conns as { tenantId: string; tenantName: string; tenantType: string }[]).find(
    (c) => c.tenantType === "ORGANISATION" && (!want || c.tenantName.toLowerCase() === want),
  );
  if (!org) throw new Error("No matching Xero organisation was authorised");
  await saveTokens({ ...t, tenant_id: org.tenantId, tenant_name: org.tenantName });
  return org.tenantName;
}

async function validTokens(): Promise<Tokens> {
  const t = await loadTokens();
  if (!t) throw new Error("Xero is not connected. An Owner needs to connect it in Settings.");
  if (Date.now() < t.expires_at) return t;
  try {
    const fresh = await tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh_token });
    const next = { ...t, ...fresh };
    await saveTokens(next);
    return next;
  } catch (e) {
    await createAdminClient().from("app_state").upsert({ key: "xero_connection", value: { tenant_name: t.tenant_name, connected: false, error: String(e) } });
    throw e;
  }
}

/** GET a Xero Accounting API path (e.g. "/Invoices?page=1"). Retries once on 429. */
export async function xeroGet<T = unknown>(path: string): Promise<T> {
  const t = await validTokens();
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${t.access_token}`, "xero-tenant-id": t.tenant_id!, Accept: "application/json" },
      cache: "no-store",
    });
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after") ?? "5");
      await new Promise((r) => setTimeout(r, Math.min(wait, 30) * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`Xero ${path.split("?")[0]} ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as T;
  }
  throw new Error("Xero rate limit — try again shortly");
}

/** Page through a Xero collection (100 per page by default, pageSize up to 1000). */
export async function xeroGetAll<T>(path: string, key: string): Promise<T[]> {
  const out: T[] = [];
  const sep = path.includes("?") ? "&" : "?";
  for (let page = 1; page < 200; page++) {
    const json = await xeroGet<Record<string, T[]>>(`${path}${sep}page=${page}&pageSize=1000`);
    const items = json[key] ?? [];
    out.push(...items);
    if (items.length < 1000) break;
  }
  return out;
}

export async function disconnectXero() {
  const db = createAdminClient();
  await db.from("integration_secrets").delete().eq("key", SECRET_KEY);
  await db.from("app_state").upsert({ key: "xero_connection", value: { connected: false } });
}

// --- Xero shapes (only the fields we use) ---
export type XeroTracking = { Name: string; Option: string };
export type XeroInvoice = {
  InvoiceID: string;
  InvoiceNumber: string;
  Type: "ACCREC" | "ACCPAY";
  Status: string;
  Reference?: string;
  Contact: { ContactID: string; Name: string; EmailAddress?: string };
  DateString?: string;
  DueDateString?: string;
  Total: number;
  AmountDue: number;
  LineItems?: { Tracking?: XeroTracking[] }[];
};
export type XeroCreditNote = {
  CreditNoteID: string;
  CreditNoteNumber: string;
  Type: string;
  Status: string;
  Reference?: string;
  Contact: { ContactID: string; Name: string };
  DateString?: string;
  Total: number;
  RemainingCredit: number;
  LineItems?: { Tracking?: XeroTracking[] }[];
};
export type XeroPayment = {
  PaymentID: string;
  Date: string;
  Amount: number;
  Status: string;
  PaymentType: string;
  Invoice?: { InvoiceNumber?: string; Contact?: { ContactID: string; Name: string } };
};
export type XeroContact = { ContactID: string; Name: string; EmailAddress?: string };

/** Parse Xero's "/Date(1696118400000+0000)/" or ISO strings into YYYY-MM-DD. */
export function xeroDate(v: string | undefined | null): string | null {
  if (!v) return null;
  const m = /\/Date\((\d+)/.exec(v);
  if (m) return new Date(Number(m[1])).toISOString().slice(0, 10);
  return v.slice(0, 10);
}

/** Brand from the "Brand" tracking category on line items (the most common option wins). */
export function brandFromLines(lines: { Tracking?: XeroTracking[] }[] | undefined): "DND" | "Gippsland" | null {
  const cat = (optionalEnv("XERO_BRAND_CATEGORY") ?? "Brand").toLowerCase();
  const counts = new Map<string, number>();
  for (const l of lines ?? [])
    for (const t of l.Tracking ?? []) if (t.Name?.toLowerCase() === cat) counts.set(t.Option, (counts.get(t.Option) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [k, v] of counts) if (v > n) [best, n] = [k, v];
  if (!best) return null;
  if (/gipps/i.test(best)) return "Gippsland";
  if (/dnd/i.test(best)) return "DND";
  return null;
}
