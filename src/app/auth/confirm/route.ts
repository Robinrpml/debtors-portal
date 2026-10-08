import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Landing route for emailed links (password reset, invite).
 * Supabase email templates must link here:
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/set-password
 * (see supabase/templates/ and README). Works across devices — no PKCE cookie needed.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const tokenHash = sp.get("token_hash");
  const type = sp.get("type") as EmailOtpType | null;
  const nextParam = sp.get("next") ?? "/set-password";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/set-password";

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, req.url));
  }
  return NextResponse.redirect(new URL("/login?error=link", req.url));
}
