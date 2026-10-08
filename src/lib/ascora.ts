import "server-only";
import { optionalEnv, requireEnv } from "@/lib/env";

// Ascora API v1.6 — see docs/ascora-api.pdf.
// The Auth Key from Ascora's Administration menu is sent in a request header.
const BASE = () => (optionalEnv("ASCORA_API_BASE") ?? "https://api.ascora.com.au").replace(/\/$/, "");
const AUTH_HEADER = () => optionalEnv("ASCORA_AUTH_HEADER") ?? "Auth";

export const ascoraConfigured = () => !!optionalEnv("ASCORA_API_KEY");

async function ascora<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE()}${path}`, {
    ...init,
    headers: { [AUTH_HEADER()]: requireEnv("ASCORA_API_KEY"), "Content-Type": "application/json", Accept: "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) throw new Error(`Ascora ${path.split("?")[0]} ${res.status}: ${text.slice(0, 200)}`);
  return json as T;
}

export type AscoraCustomer = {
  customerId: string;
  customerName: string;
  companyName?: string;
  contactFirstName?: string;
  contactLastName?: string;
  emailAddress?: string;
  onHold?: boolean;
  billingCustomerOnHold?: boolean;
};

/** GET /Customers/Customer/{id} — the full customer record as Ascora returns it. */
export async function getCustomer(id: string): Promise<(AscoraCustomer & Record<string, unknown>) | null> {
  const json = await ascora<{ success: boolean; customer: (AscoraCustomer & Record<string, unknown>) | null; message?: string }>(
    `/Customers/Customer/${encodeURIComponent(id)}`,
  );
  return json?.success ? json.customer : null;
}

/** Writing On Hold is off until ASCORA_HOLD_WRITE_ENABLED=true (after testing on a dummy customer). */
export const holdWriteEnabled = () => optionalEnv("ASCORA_HOLD_WRITE_ENABLED") === "true";

/**
 * Set On Hold via POST /Customers/Customer. Ascora's docs don't say whether omitted fields are kept,
 * so we read the full record, change only onHold, and send everything back.
 * Afterwards we re-read and compare, so a side effect is reported rather than silently accepted.
 */
export async function setCustomerOnHold(id: string, onHold: boolean): Promise<{ onHold: boolean; billingCustomerOnHold: boolean; changedFields: string[] }> {
  const before = await getCustomer(id);
  if (!before) throw new Error("Ascora customer not found");
  const body = { ...before, customerId: id, onHold };
  const json = await ascora<{ success: boolean; message?: string; customer?: AscoraCustomer }>(`/Customers/Customer`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!json?.success) throw new Error(json?.message || "Ascora rejected the update");

  const after = await getCustomer(id);
  if (!after) throw new Error("Couldn't re-read the customer from Ascora");
  const changedFields = Object.keys(before).filter(
    (k) => k !== "onHold" && JSON.stringify(before[k]) !== JSON.stringify((after as Record<string, unknown>)[k]),
  );
  return { onHold: !!after.onHold, billingCustomerOnHold: !!after.billingCustomerOnHold, changedFields };
}

export async function searchCustomers(filterText: string): Promise<AscoraCustomer[]> {
  const q = new URLSearchParams({ FilterText: filterText, SiteBillingType: "All", PageSize: "20", Page: "1" });
  const json = await ascora<{ success: boolean; results?: AscoraCustomer[] }>(`/Customers/Customers?${q}`);
  return json.results ?? [];
}

/** POST /Notes/Note — returns the new Ascora note ID. */
export async function createCustomerNote(ascoraCustomerId: string, content: string, createdByName: string): Promise<string | null> {
  const json = await ascora<{ entityId?: string; success: boolean; message?: string }>(`/Notes/Note`, {
    method: "POST",
    body: JSON.stringify({ entityId: ascoraCustomerId, entityType: "Customer", noteContent: content, createdByName }),
  });
  if (!json?.success) throw new Error(json?.message || "Ascora rejected the note");
  return json.entityId ?? null;
}

// ---------------------------------------------------------------------------
// Deep links. Ascora's web URL patterns are configured, not guessed:
//   ASCORA_CUSTOMER_URL  e.g. https://app.ascora.com.au/Customers/Details/{id}
//   ASCORA_INVOICE_URL   e.g. https://app.ascora.com.au/Invoices/Details/{id}   ({number} also supported)
// Copy one real URL of each from Ascora and replace the ID part with {id}.
// ---------------------------------------------------------------------------
export function linkTemplates() {
  return {
    customer: optionalEnv("ASCORA_CUSTOMER_URL") ?? null,
    invoice: optionalEnv("ASCORA_INVOICE_URL") ?? null,
  };
}

const norm = (s: string | undefined | null) => (s ?? "").toLowerCase().replace(/&/g, "and").replace(/\b(pty|ltd|limited|the)\b/g, "").replace(/[^a-z0-9]/g, "");

/** Choose an Ascora customer for a Xero contact. Returns confidence: auto (safe), review, or none. */
export async function matchCustomer(name: string, email: string | null): Promise<{ match: "auto" | "review" | "none"; best?: AscoraCustomer; candidates: AscoraCustomer[] }> {
  const seen = new Map<string, AscoraCustomer>();
  const add = (list: AscoraCustomer[]) => list.forEach((c) => seen.set(c.customerId, c));
  if (email) add(await searchCustomers(email));
  add(await searchCustomers(name));
  const candidates = [...seen.values()];
  const n = norm(name);
  const e = email?.toLowerCase();
  const byName = candidates.filter((c) => norm(c.customerName) === n || norm(c.companyName) === n || norm(`${c.contactFirstName ?? ""} ${c.contactLastName ?? ""}`) === n);
  const byEmail = e ? candidates.filter((c) => c.emailAddress?.toLowerCase() === e) : [];
  const both = byName.filter((c) => byEmail.includes(c));
  if (both.length === 1) return { match: "auto", best: both[0], candidates };
  if (byName.length === 1) return { match: "auto", best: byName[0], candidates };
  if (byEmail.length === 1) return { match: "review", best: byEmail[0], candidates };
  if (candidates.length) return { match: "review", best: candidates[0], candidates: candidates.slice(0, 8) };
  return { match: "none", candidates: [] };
}
