import type { Metadata } from "next";
import { AuthCard } from "@/components/auth-card";
import { requireUser } from "@/lib/auth";
import { SetPasswordForm } from "./set-password-form";

export const metadata: Metadata = { title: "Choose a password" };

export default async function SetPasswordPage() {
  const p = await requireUser({ allowPasswordChange: true });
  return (
    <AuthCard title={p.must_change_password ? "Choose your password" : "Change your password"}>
      <p className="muted" style={{ margin: 0 }}>
        Signed in as <b style={{ color: "var(--ink)" }}>{p.email}</b>. Use at least 12 characters — a short phrase is easiest to remember.
      </p>
      <SetPasswordForm />
    </AuthCard>
  );
}
