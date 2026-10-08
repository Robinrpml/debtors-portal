// Aging rules — keep identical to the original DND Aged Debtors dashboard (Xero "by due date", monthly).
// C  = not yet due (due date after the as-at date)
// L  = overdue by less than one month
// 1/2/3 = overdue by 1, 2, 3 whole months
// O  = older than that

export type BucketKey = "C" | "L" | "1" | "2" | "3" | "O";

export const BUCKETS: { k: BucketKey; label: string; short: string; color: string }[] = [
  { k: "C", label: "Current", short: "Current", color: "var(--t0)" },
  { k: "L", label: "< 1 month", short: "< 1 mth", color: "var(--t1)" },
  { k: "1", label: "1 month", short: "1 mth", color: "var(--t2)" },
  { k: "2", label: "2 months", short: "2 mths", color: "var(--t3)" },
  { k: "3", label: "3 months", short: "3 mths", color: "var(--t4)" },
  { k: "O", label: "Older", short: "Older", color: "var(--t5)" },
];

export const OVERDUE: BucketKey[] = ["L", "1", "2", "3", "O"];

function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/** Bucket for a due date (YYYY-MM-DD) as at asOf (YYYY-MM-DD). */
export function bucketFor(due: string | null, asOf: string): BucketKey {
  if (!due || due > asOf) return "C"; // Xero counts an invoice due today as overdue
  if (addMonths(due, 1) > asOf) return "L";
  if (addMonths(due, 2) > asOf) return "1";
  if (addMonths(due, 3) > asOf) return "2";
  if (addMonths(due, 4) > asOf) return "3";
  return "O";
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 864e5);
}

/** Today's date in Melbourne as YYYY-MM-DD. */
export function melbourneToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
