"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setOnHold } from "./hold-actions";

/** On Hold status from Ascora, with Put on hold / Release for Managers. */
export function HoldControl({
  customerId,
  customerName,
  onHold,
  billingOnHold,
  linked,
  canEdit,
}: {
  customerId: string;
  customerName: string;
  onHold: boolean;
  billingOnHold: boolean;
  linked: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const next = !onHold;

  if (!linked) {
    return <div className="hold-box"><span className="muted small">On Hold status shows once this customer is matched to Ascora.</span></div>;
  }

  function submit() {
    setMsg(null);
    start(async () => {
      const r = await setOnHold({ customerId, onHold: next, reason: reason || undefined });
      if (!r.ok) return setMsg({ ok: false, text: r.error ?? "Couldn't update Ascora" });
      setConfirming(false);
      setReason("");
      setMsg({ ok: !r.warning, text: r.warning ?? (next ? "Put on hold in Ascora." : "Released in Ascora.") });
      router.refresh();
    });
  }

  return (
    <div className={`hold-box${onHold || billingOnHold ? " on" : ""}`}>
      <div className="hold-row">
        <span className={`hold-state${onHold || billingOnHold ? " on" : ""}`}>
          {onHold ? "On hold in Ascora" : billingOnHold ? "Billing customer on hold in Ascora" : "Not on hold"}
        </span>
        {canEdit && !confirming && (
          <button className={`btn sm${next ? " danger" : ""}`} onClick={() => setConfirming(true)} disabled={pending}>
            {next ? "Put on hold" : "Release hold"}
          </button>
        )}
      </div>
      {billingOnHold && !onHold && <span className="hint">Set on the billing customer, so change it there in Ascora.</span>}
      {confirming && (
        <div className="hold-confirm">
          <span className="small">
            {next ? "Put" : "Release"} <b>{customerName}</b> {next ? "on hold" : "from hold"} in Ascora?
          </span>
          <input className="input" placeholder="Reason (optional, saved as a note)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          <div className="hold-row">
            <button className={`btn sm ${next ? "danger" : "primary"}`} onClick={submit} disabled={pending}>
              {pending ? "Updating Ascora…" : next ? "Confirm hold" : "Confirm release"}
            </button>
            <button className="linkbtn" onClick={() => setConfirming(false)} disabled={pending}>Cancel</button>
          </div>
        </div>
      )}
      {msg && <span className={`small ${msg.ok ? "ok" : "err"}`}>{msg.text}</span>}
    </div>
  );
}
