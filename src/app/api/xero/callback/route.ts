import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getProfile } from "@/lib/auth";
import { completeXeroConnection } from "@/lib/xero";
import { safeEqual } from "@/lib/crypto";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const p = await getProfile();
  if (!p || !p.active || p.role !== "owner") return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const jar = await cookies();
  const expected = jar.get("xero_oauth_state")?.value;
  jar.delete({ name: "xero_oauth_state", path: "/api/xero" });

  const back = new URL("/admin/settings", req.url);
  const state = req.nextUrl.searchParams.get("state");
  const code = req.nextUrl.searchParams.get("code");
  if (!code || !safeEqual(state, expected)) {
    back.searchParams.set("xero", "error");
    return NextResponse.redirect(back);
  }
  try {
    const org = await completeXeroConnection(code);
    await audit(p, "xero.connected", org);
    back.searchParams.set("xero", "connected");
  } catch (e) {
    console.error(e);
    back.searchParams.set("xero", "error");
  }
  return NextResponse.redirect(back);
}
