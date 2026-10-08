"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { safeEqual } from "@/lib/crypto";
import { audit } from "@/lib/audit";
import type { FormState } from "@/app/(auth)/actions";

export async function createFirstOwner(_: FormState, form: FormData): Promise<FormState> {
  const token = String(form.get("token") ?? "");
  const name = String(form.get("name") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const email = process.env.BOOTSTRAP_OWNER_EMAIL?.trim().toLowerCase();
  if (!email || !safeEqual(token, process.env.BOOTSTRAP_TOKEN)) return { error: "Setup is not available." };
  if (password.length < 12) return { error: "Use at least 12 characters." };
  if (password !== String(form.get("confirm") ?? "")) return { error: "The two passwords don't match." };

  const db = createAdminClient();
  const { count } = await db.from("profiles").select("id", { count: "exact", head: true }).eq("role", "owner");
  if ((count ?? 0) > 0) return { error: "An Owner already exists." };

  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
  if (error || !data.user) return { error: error?.message ?? "Could not create the account." };
  await db.from("profiles").update({ role: "owner", active: true, must_change_password: false, full_name: name, brand_access: "all" }).eq("id", data.user.id);
  await audit({ id: data.user.id, email }, "setup.first_owner");

  const supabase = await createClient();
  await supabase.auth.signInWithPassword({ email, password });
  redirect("/admin/settings");
}
