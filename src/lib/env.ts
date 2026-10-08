import "server-only";

/** Read a required server-side env var, failing loudly when it is missing. */
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

export function optionalEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

/** Public site URL, used for auth email links and the Xero OAuth redirect. */
export function siteUrl(): string {
  return (
    optionalEnv("NEXT_PUBLIC_SITE_URL") ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000")
  ).replace(/\/$/, "");
}

export const TIMEZONE = "Australia/Melbourne";
