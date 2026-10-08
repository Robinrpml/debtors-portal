"use client";

import { useTransition } from "react";
import { completeFollowUp } from "../notes-actions";

export function FollowUpDone({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button className="btn sm" disabled={pending} onClick={() => start(() => completeFollowUp(id))}>
      {pending ? "…" : "Done"}
    </button>
  );
}
