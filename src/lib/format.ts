export const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money0 = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "Australia/Melbourne" });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Australia/Melbourne" });
}

/** Build an Ascora deep link from a template like https://…/{id}. */
export function fillTemplate(tpl: string | null, vars: Record<string, string | null | undefined>): string | null {
  if (!tpl) return null;
  let missing = false;
  const out = tpl.replace(/\{(\w+)\}/g, (_, k) => {
    const v = vars[k];
    if (!v) missing = true;
    return encodeURIComponent(v ?? "");
  });
  return missing ? null : out;
}
