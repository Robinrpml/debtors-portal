import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth-card";
import { getProfile } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage(props: PageProps<"/login">) {
  const sp = await props.searchParams;
  const p = await getProfile();
  if (p?.active) redirect("/");
  const next = typeof sp.next === "string" ? sp.next : "/";
  const notice =
    sp.error === "inactive" ? "This account is disabled. Ask a manager to re-enable it." : sp.error === "link" ? "That link has expired or was already used. Request a new one." : undefined;
  return (
    <AuthCard title="Sign in">
      <LoginForm next={next} notice={notice} />
    </AuthCard>
  );
}
