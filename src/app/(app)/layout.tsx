/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { requireUser, isManagerRole } from "@/lib/auth";
import { signOut } from "@/app/(auth)/actions";
import { Nav } from "@/components/nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await requireUser();
  const manager = isManagerRole(me.role);
  const links = [
    { href: "/", label: "Debtors" },
    { href: "/follow-ups", label: "Follow-ups" },
    ...(manager
      ? [
          { href: "/admin/users", label: "Users" },
          { href: "/admin/mappings", label: "Ascora mapping" },
          { href: "/admin/settings", label: "Settings" },
        ]
      : []),
  ];
  return (
    <>
      <header className="topbar">
        <div className="topbar-in">
          <Link href="/" className="logo" aria-label="Debtors home">
            <img className="logo-light" src="/brand/precision-thermal.png" alt="Precision Thermal" width={149} height={26} />
            <img className="logo-dark" src="/brand/precision-thermal-reversed.png" alt="Precision Thermal" width={149} height={26} />
            <span className="app">Debtors</span>
          </Link>
          <Nav links={links} />
          <div className="who">
            <span>
              <b>{me.full_name || me.email}</b> · {me.role}
              {me.brand_access !== "all" ? ` · ${me.brand_access}` : ""}
            </span>
            <Link href="/set-password" className="linkbtn">Password</Link>
            <form action={signOut}>
              <button className="btn sm" type="submit">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      {children}
    </>
  );
}
