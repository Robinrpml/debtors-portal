"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import { siteUrl } from "@/lib/env";

export type FormState = { error?: string; message?: string } | undefined;

const PASSWORD_MIN = 12;

function safeNext(next: FormDataEntryValue | null): string {
  const n = typeof next === "string" ? next : "/";
  return n.startsWith("/") && !n.startsWith("//") ? n : "/";
}

export async function signIn(_: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    await audit({ email }, "auth.sign_in_failed", null, { ip: (await headers()).get("x-forwarded-for") });
    return { error: "That email and password don't match an account." };
  }
  const { data: profile } = await supabase.from("profiles").select("active,must_change_password").eq("id", data.user.id).single();
  if (!profile?.active) {
    await supabase.auth.signOut();
    return { error: "This account is disabled. Ask a manager to re-enable it." };
  }
  await createAdminClient().from("profiles").update({ last_seen_at: new Date().toISOString() }).eq("id", data.user.id);
  await audit({ id: data.user.id, email }, "auth.sign_in");
  redirect(profile.must_change_password ? "/set-password" : safeNext(form.get("next")));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function requestReset(_: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!email) return { error: "Enter your email." };
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${siteUrl()}/auth/confirm?next=/set-password` });
  await audit({ email }, "auth.reset_requested");
  // Same answer whether or not the account exists.
  return { message: "If that email has an account, a reset link is on its way. It expires in one hour." };
}

export async function setPassword(_: FormState, form: FormData): Promise<FormState> {
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  if (password.length < PASSWORD_MIN) return { error: `Use at least ${PASSWORD_MIN} characters.` };
  if (password !== confirm) return { error: "The two passwords don't match." };

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const uid = claims?.claims?.sub;
  if (!uid) redirect("/login");
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message.includes("weak") || error.message.includes("pwned") ? "That password appears in known data breaches or is too weak. Pick another." : error.message };
  await createAdminClient().from("profiles").update({ must_change_password: false }).eq("id", uid);
  await audit({ id: uid, email: String(claims?.claims?.email ?? "") }, "auth.password_set");
  redirect("/");
}
