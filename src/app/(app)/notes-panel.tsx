"use client";

import { useEffect, useState, useTransition } from "react";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { addNote, listNotes, retryNoteSync, completeFollowUp, type NoteView } from "./notes-actions";

const TAGS = ["Called", "Emailed", "Promised to pay", "Disputed"] as const;

export function NotesPanel({ customerId, customerName, ascoraLinked }: { customerId: string; customerName: string; ascoraLinked: boolean }) {
  const [notes, setNotes] = useState<NoteView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [followUp, setFollowUp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const refresh = () =>
    listNotes(customerId)
      .then(setNotes)
      .catch((e) => setLoadError(String(e?.message ?? e)));

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await addNote({ customerId, body, tag: tag as never, followUp: followUp || null });
      if (!res.ok) return setError(res.error ?? "Could not save the note");
      setBody("");
      setTag(null);
      setFollowUp("");
      await refresh();
    });
  }

  return (
    <aside className="notes" aria-label={`Notes for ${customerName}`}>
      <div className="notes-head">
        <h3 style={{ fontSize: 15 }}>Notes</h3>
        <span className="small muted">{ascoraLinked ? "Saved here and to Ascora" : "Saved here · not yet matched to Ascora"}</span>
      </div>

      <form className="note-form" onSubmit={submit}>
        <div className="tags" role="group" aria-label="Note type">
          {TAGS.map((t) => (
            <button type="button" key={t} aria-pressed={tag === t} onClick={() => setTag(tag === t ? null : t)}>
              {t}
            </button>
          ))}
        </div>
        <textarea className="input" placeholder="What happened? e.g. Spoke to Leigh, paying i5311 Friday." value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} aria-label="Note" />
        <div className="note-row">
          <label className="small muted" htmlFor={`fu-${customerId}`}>Follow up</label>
          <input id={`fu-${customerId}`} type="date" className="input" style={{ width: "auto" }} value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
          <span style={{ flex: 1 }} />
          <button className="btn primary sm" disabled={pending || !body.trim()} type="submit">
            {pending ? "Saving…" : "Add note"}
          </button>
        </div>
        {error && <p className="err small" style={{ margin: 0 }}>{error}</p>}
      </form>

      <div className="note-list">
        {loadError && <p className="err small">{loadError}</p>}
        {notes === null && !loadError && <p className="muted small">Loading notes…</p>}
        {notes?.length === 0 && <p className="muted small" style={{ margin: 0 }}>No notes yet.</p>}
        {notes?.map((n) => (
          <div key={n.id} className={`note${n.source === "ascora" ? " ascora" : ""}`}>
            <div className="meta">
              <b>{n.author}</b>
              <span>{fmtDateTime(n.at)}</span>
              {n.tag && <span className="badge">{n.tag}</span>}
              {n.source === "ascora" ? (
                <span className="sync synced">from Ascora</span>
              ) : (
                <span className={`sync ${n.sync === "synced" ? "synced" : n.sync === "failed" ? "failed" : "pending"}`} title={n.syncError ?? undefined}>
                  {n.sync === "synced" ? "✓ in Ascora" : n.sync === "failed" ? "Ascora sync failed" : n.sync === "skipped" ? "Not in Ascora" : "Sending to Ascora…"}
                </span>
              )}
              {(n.sync === "failed" || n.sync === "skipped") && n.source === "portal" && (
                <button className="linkbtn" onClick={() => start(async () => { await retryNoteSync(n.id); await refresh(); })}>Retry</button>
              )}
            </div>
            <div className="text">{n.body}</div>
            {n.followUp && (
              <div className="meta">
                <span className={n.followUpDone ? "" : "err"}>{n.followUpDone ? "Followed up" : "Follow up"} {fmtDate(n.followUp)}</span>
                {!n.followUpDone && (
                  <button className="linkbtn" onClick={() => start(async () => { await completeFollowUp(n.id); await refresh(); })}>Mark done</button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}
