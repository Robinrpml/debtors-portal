import type { Metadata } from "next";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { UsersAdmin, type UserRow } from "./users-admin";

export const metadata: Metadata = { title: "Users" };
export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const me = await requireManager();
  const db = await createClient();
  const { data } = await db.from("profiles").select("id,email,full_name,role,brand_access,active,must_change_password,last_seen_at,created_at").order("full_name");
  return (
    <div className="wrap" style={{ maxWidth: 1200 }}>
      <div style={{ display: "grid", gap: 6 }}>
        <span className="eyebrow">Administration</span>
        <h1>Users</h1>
        <p className="muted" style={{ margin: 0 }}>
          {me.role === "owner"
            ? "You can add and change anyone. Keep at least one Owner."
            : "You can add and manage Staff. Ask an Owner to add or change Managers."}
        </p>
      </div>
      <UsersAdmin users={(data ?? []) as UserRow[]} me={{ id: me.id, role: me.role }} />
    </div>
  );
}
