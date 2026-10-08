/* eslint-disable @next/next/no-img-element */
export function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="auth">
      <div className="auth-card">
        <div className="logo">
          <img className="logo-light" src="/brand/precision-thermal.png" alt="Precision Thermal" width={194} height={34} />
          <img className="logo-dark" src="/brand/precision-thermal-reversed.png" alt="Precision Thermal" width={194} height={34} />
        </div>
        <div style={{ display: "grid", gap: 4 }}>
          <span className="eyebrow">Debtors portal</span>
          <h1 style={{ fontSize: 22 }}>{title}</h1>
        </div>
        {children}
        <div className="auth-foot">
          <img src="/brand/dnd-insulation.png" alt="DND Insulation" height={16} />
          <img src="/brand/gippsland-insulation.png" alt="Gippsland Insulation" height={16} />
        </div>
      </div>
    </main>
  );
}
