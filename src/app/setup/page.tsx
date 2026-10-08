import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AuthCard } from "@/components/auth-card";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeEqual } from "@/lib/crypto";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = { title: "First-time setup" };
export const dynamic = "force-dynamic";

/**
 * One-time bootstrap for the first Owner. Only works when:
 *  - ?token= matches BOOTSTRAP_TOKEN, and
 *  - no Owner exists yet.
 * After the first Owner is created it 404s forever. Remove BOOTSTRAP_TOKEN afterwards.
 */
export default async function SetupPage(props: PageProps<"/setup">) {
  const { token } = await props.searchParams;
  if (typeof token !== "string" || !safeEqual(token, process.env.BOOTSTRAP_TOKEN)) notFound();
  const { count } = await createAdminClient().from("profiles").select("id", { count: "exact", head: true }).eq("role", "owner");
  if ((count ?? 0) > 0) notFound();
  return (
    <AuthCard title="Create the first Owner">
      <p className="muted" style={{ margin: 0 }}>
        Account email: <b style={{ color: "var(--ink)" }}>{process.env.BOOTSTRAP_OWNER_EMAIL}</b>. This page disappears once the Owner exists.
      </p>
      <SetupForm token={token} />
    </AuthCard>
  );
}
