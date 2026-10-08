import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { getProfile } from "@/lib/auth";
import { xeroAuthorizeUrl } from "@/lib/xero";

export const dynamic = "force-dynamic";

/** Owner-only: start the Xero OAuth flow. */
export async function GET() {
  const p = await getProfile();
  if (!p || !p.active || p.role !== "owner") return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const state = randomBytes(24).toString("base64url");
  (await cookies()).set("xero_oauth_state", state, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/xero", maxAge: 600 });
  return NextResponse.redirect(xeroAuthorizeUrl(state));
}
