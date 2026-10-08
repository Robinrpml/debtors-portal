import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export async function audit(
  actor: { id?: string | null; email?: string | null } | null,
  action: string,
  target?: string | null,
  detail?: Record<string, unknown>,
) {
  try {
    await createAdminClient()
      .from("audit_log")
      .insert({ user_id: actor?.id ?? null, user_email: actor?.email ?? null, action, target: target ?? null, detail: detail ?? null });
  } catch (e) {
    console.error("audit log failed", e);
  }
}
