import type { Metadata } from "next";
import { requireUser, isManagerRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadDashboard } from "@/lib/data";
import { linkTemplates } from "@/lib/ascora";
import { melbourneToday } from "@/lib/aging";
import { Dashboard } from "./dashboard";

export const metadata: Metadata = { title: "Aged debtors" };
export const dynamic = "force-dynamic";

export default async function DebtorsPage() {
  const me = await requireUser();
  const db = await createClient();
  const data = await loadDashboard(db, melbourneToday(), linkTemplates());
  return (
    <Dashboard
      data={data}
      me={{ id: me.id, name: me.full_name || me.email, manager: isManagerRole(me.role), brandAccess: me.brand_access }}
    />
  );
}
