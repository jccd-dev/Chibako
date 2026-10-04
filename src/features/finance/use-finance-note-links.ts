"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FinanceNoteChoice, FinanceNoteChoices, ActivityNoteLinks } from "./note-link-types";
import type { FinanceTransaction } from "./activity-types";
import type { FinanceActivityController } from "./use-finance-activity";

async function read<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Could not read Notes. Try again.");
  return body;
}

export function useFinanceNotePicker() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState<FinanceNoteChoices | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ title: string; content: string } | null>(null);
  const [previewError, setPreviewError] = useState("");
  const searchSequence = useRef(0), previewSequence = useRef(0);
  useEffect(() => () => { searchSequence.current++; previewSequence.current++; }, []);
  async function search(offset = 0, term = q) {
    const sequence = ++searchSequence.current;
    setLoading(true); setError("");
    try {
      const result = await fetch(`/api/finance/notes?${new URLSearchParams({ q: term, limit: "25", offset: String(offset) })}`).then(read<FinanceNoteChoices>);
      if (sequence === searchSequence.current) setPage(result);
    } catch (error) { if (sequence === searchSequence.current) setError(error instanceof Error ? error.message : "Could not find Notes."); }
    finally { if (sequence === searchSequence.current) setLoading(false); }
  }
  async function inspect(id: string) {
    const sequence = ++previewSequence.current;
    setPreviewId(id); setPreview(null); setPreviewError("");
    try {
      const result = await fetch(`/api/notes/${encodeURIComponent(id)}`).then(read<{ note: { title: string; content: string } }>);
      if (sequence === previewSequence.current) setPreview(result.note);
    } catch (error) { if (sequence === previewSequence.current) setPreviewError(error instanceof Error ? error.message : "Could not inspect Note."); }
  }
  function closePreview() { previewSequence.current++; setPreviewId(null); setPreview(null); setPreviewError(""); }
  return { q, setQ, page, loading, error, search, previewId, preview, previewError, inspect, closePreview };
}

export function useFinanceNoteLinks(record: FinanceTransaction, activity: FinanceActivityController) {
  const [notes, setNotes] = useState<FinanceNoteChoice[]>([]);
  const [originalIds, setOriginalIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const current = ++sequence.current;
    setLoading(true); setError("");
    try {
      const result = await fetch(`/api/finance/activity/${record.id}/notes`).then(read<ActivityNoteLinks>);
      if (current !== sequence.current) return;
      if (result.version !== record.version) throw new Error("Activity changed. Refresh transaction details before changing Note links.");
      setNotes(result.notes); setOriginalIds(result.notes.map(note => note.id).sort());
    } catch (error) { if (current === sequence.current) setError(error instanceof Error ? error.message : "Could not load Note links."); }
    finally { if (current === sequence.current) setLoading(false); }
  }, [record.id, record.version]);
  useEffect(() => { void load(); return () => { sequence.current++; }; }, [load]);
  const changed = JSON.stringify(notes.map(note => note.id).sort()) !== JSON.stringify(originalIds);
  async function save() { return activity.setNoteLinks(record.id, { version: record.version, note_ids: notes.map(note => note.id) }); }
  return { notes, setNotes, loading, error, load, changed, save };
}
