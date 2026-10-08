import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Role = "owner" | "manager" | "staff";
export type BrandAccess = "all" | "DND" | "Gippsland";

export type Profile = {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  brand_access: BrandAccess;
  active: boolean;
  must_change_password: boolean;
};

/** Current signed-in, active user's profile, or null. */
export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const uid = claims?.claims?.sub;
  if (!uid) return null;
  const { data } = await supabase
    .from("profiles")
    .select("id,email,full_name,role,brand_access,active,must_change_password")
    .eq("id", uid)
    .single();
  return (data as Profile) ?? null;
}

/** For pages: redirect away unless signed in and active. */
export async function requireUser(opts: { allowPasswordChange?: boolean } = {}): Promise<Profile> {
  const p = await getProfile();
  if (!p) redirect("/login");
  if (!p.active) redirect("/login?error=inactive");
  if (p.must_change_password && !opts.allowPasswordChange) redirect("/set-password");
  return p;
}

export async function requireManager(): Promise<Profile> {
  const p = await requireUser();
  if (p.role !== "owner" && p.role !== "manager") redirect("/");
  return p;
}

export async function requireOwner(): Promise<Profile> {
  const p = await requireUser();
  if (p.role !== "owner") redirect("/");
  return p;
}

/** For server actions: throw instead of redirecting. */
export async function assertUser(): Promise<Profile> {
  const p = await getProfile();
  if (!p || !p.active) throw new Error("Not signed in");
  return p;
}

export async function assertManager(): Promise<Profile> {
  const p = await assertUser();
  if (p.role !== "owner" && p.role !== "manager") throw new Error("Managers only");
  return p;
}

export async function assertOwner(): Promise<Profile> {
  const p = await assertUser();
  if (p.role !== "owner") throw new Error("Owner only");
  return p;
}

export const isManagerRole = (r: Role) => r === "owner" || r === "manager";
