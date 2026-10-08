"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertManager, type Profile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import { siteUrl } from "@/lib/env";

type Result = { ok: boolean; error?: string; message?: string };

const Role = z.enum(["owner", "manager", "staff"]);
const Brand = z.enum(["all", "DND", "Gippsland"]);

/** Managers manage Staff; only Owners create or change Managers/Owners. */
function canAssign(me: Profile, role: z.infer<typeof Role>) {
  return me.role === "owner" || role === "staff";
}

async function target(id: string) {
  const { data } = await createAdminClient().from("profiles").select("id,email,role,active").eq("id", id).single();
  if (!data) throw new Error("User not found");
  return data as { id: string; email: string; role: Profile["role"]; active: boolean };
}

async function ownerCount() {
  const { count } = await createAdminClient().from("profiles").select("id", { count: "exact", head: true }).eq("role", "owner").eq("active", true);
  return count ?? 0;
}

const CreateInput = z.object({
  name: z.string().trim().min(1, "Enter a name").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  role: Role,
  brand: Brand,
  mode: z.enum(["password", "invite"]),
  password: z.string().optional(),
});

export async function createUser(input: z.input<typeof CreateInput>): Promise<Result> {
  const me = await assertManager();
  const p = CreateInput.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message };
  const { name, email, role, brand, mode, password } = p.data;
  if (!canAssign(me, role)) return { ok: false, error: "Only an Owner can create Managers or Owners." };
  const db = createAdminClient();

  let userId: string | undefined;
  if (mode === "password") {
    if (!password || password.length < 12) return { ok: false, error: "Initial password needs at least 12 characters." };
    const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
    if (error) return { ok: false, error: error.message };
    userId = data.user?.id;
  } else {
    const { data, error } = await db.auth.admin.inviteUserByEmail(email, {
      data: { full_name: name },
      redirectTo: `${siteUrl()}/auth/confirm?next=/set-password`,
    });
    if (error) return { ok: false, error: error.message };
    userId = data.user?.id;
  }
  if (!userId) return { ok: false, error: "Account wasn't created" };
  await db.from("profiles").update({ full_name: name, role, brand_access: brand, active: true, must_change_password: true }).eq("id", userId);
  await audit(me, "user.created", email, { role, brand, mode });
  revalidatePath("/admin/users");
  return { ok: true, message: mode === "invite" ? `Invite sent to ${email}.` : `${name} can sign in now and will be asked to choose their own password.` };
}

const UpdateInput = z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(120), role: Role, brand: Brand });

export async function updateUser(input: z.input<typeof UpdateInput>): Promise<Result> {
  const me = await assertManager();
  const p = UpdateInput.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message };
  const t = await target(p.data.id);
  if (!canAssign(me, t.role) || !canAssign(me, p.data.role)) return { ok: false, error: "Only an Owner can change Managers or Owners." };
  if (t.role === "owner" && p.data.role !== "owner" && (await ownerCount()) <= 1) return { ok: false, error: "There must always be at least one Owner." };
  await createAdminClient().from("profiles").update({ full_name: p.data.name, role: p.data.role, brand_access: p.data.brand }).eq("id", t.id);
  await audit(me, "user.updated", t.email, { role: p.data.role, brand: p.data.brand });
  revalidatePath("/admin/users");
  return { ok: true, message: "Saved." };
}

export async function setUserPassword(id: string, password: string, requireChange: boolean): Promise<Result> {
  const me = await assertManager();
  const t = await target(id);
  if (!canAssign(me, t.role)) return { ok: false, error: "Only an Owner can change a Manager's password." };
  if (password.length < 12) return { ok: false, error: "Use at least 12 characters." };
  const db = createAdminClient();
  const { error } = await db.auth.admin.updateUserById(id, { password });
  if (error) return { ok: false, error: error.message };
  await db.from("profiles").update({ must_change_password: requireChange }).eq("id", id);
  await audit(me, "user.password_set", t.email, { requireChange });
  revalidatePath("/admin/users");
  return { ok: true, message: requireChange ? "Password set. They'll choose their own at next sign-in." : "Password set." };
}

export async function sendResetLink(id: string): Promise<Result> {
  const me = await assertManager();
  const t = await target(id);
  if (!canAssign(me, t.role)) return { ok: false, error: "Only an Owner can reset a Manager." };
  const { error } = await createAdminClient().auth.resetPasswordForEmail(t.email, { redirectTo: `${siteUrl()}/auth/confirm?next=/set-password` });
  if (error) return { ok: false, error: error.message };
  await audit(me, "user.reset_sent", t.email);
  return { ok: true, message: `Reset link sent to ${t.email}.` };
}

export async function setActive(id: string, active: boolean): Promise<Result> {
  const me = await assertManager();
  if (id === me.id) return { ok: false, error: "You can't disable your own account." };
  const t = await target(id);
  if (!canAssign(me, t.role)) return { ok: false, error: "Only an Owner can disable a Manager or Owner." };
  if (!active && t.role === "owner" && (await ownerCount()) <= 1) return { ok: false, error: "There must always be at least one Owner." };
  const db = createAdminClient();
  // Ban blocks sign-in and token refresh; existing sessions end at their next refresh (≤1 hour) and RLS already hides all data.
  const { error } = await db.auth.admin.updateUserById(id, { ban_duration: active ? "none" : "876000h" });
  if (error) return { ok: false, error: error.message };
  await db.from("profiles").update({ active }).eq("id", id);
  await audit(me, active ? "user.enabled" : "user.disabled", t.email);
  revalidatePath("/admin/users");
  return { ok: true, message: active ? "Account enabled." : "Account disabled." };
}
