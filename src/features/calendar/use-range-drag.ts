"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { rescheduleRange, type DatedNote, type DragMode, type NoteDateRange } from "./note-dates";

/** Touch and pen wait this long before a drag starts, so a swipe still scrolls. */
const LONG_PRESS_MS = 250;
const MOVE_SLOP_PX = 6;

export interface RangeDrag {
  note: DatedNote;
  mode: DragMode;
  from: string;
  over: string;
}

/** Day under a point, from the `data-note-date` on calendar day cells. */
function dayAt(x: number, y: number): string | null {
  for (const element of document.elementsFromPoint(x, y)) {
    const day = element.getAttribute("data-note-date");
    if (day) return day;
  }
  return null;
}

/**
 * Pointer-event drag for calendar ranges: mouse, touch and pen share one path.
 * Mouse starts after a small move; touch and pen after a long press. Escape cancels.
 */
export function useRangeDrag(onDrop: (id: string, range: NoteDateRange) => void) {
  const [drag, setDrag] = useState<RangeDrag | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const suppressClickUntil = useRef(0);
  useEffect(() => () => cleanup.current?.(), []);

  function start(event: ReactPointerEvent, note: DatedNote, mode: DragMode) {
    if (event.button !== 0 || !event.isPrimary) return;
    event.stopPropagation();
    const from = dayAt(event.clientX, event.clientY);
    if (!from) return;
    cleanup.current?.();
    const { pointerId, pointerType, clientX: startX, clientY: startY } = event;
    let active: RangeDrag | null = null;
    const activate = () => {
      active = { note, mode, from, over: from };
      setDrag(active);
    };
    const timer = pointerType === "mouse" ? undefined : window.setTimeout(activate, LONG_PRESS_MS);

    const finish = (commit: boolean) => {
      cleanup.current?.();
      if (!active) return;
      // The click that follows a drag must not open the Note.
      suppressClickUntil.current = Date.now() + 400;
      setDrag(null);
      if (!commit) return;
      const next = rescheduleRange(note, mode, active.from, active.over);
      if (next.date !== note.date || (next.end_date ?? next.date) !== note.endDate) onDrop(note.id, next);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      if (!active) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < MOVE_SLOP_PX) return;
        // Touch moved before the long press: it is a scroll, not a drag.
        if (pointerType !== "mouse") return finish(false);
        activate();
      }
      const over = dayAt(e.clientX, e.clientY);
      if (active && over && over !== active.over) {
        active = { ...active, over };
        setDrag(active);
      }
    };
    const onUp = (e: PointerEvent) => { if (e.pointerId === pointerId) finish(true); };
    const onCancel = (e: PointerEvent) => { if (e.pointerId === pointerId) finish(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") finish(false); };
    // Pills set `touch-action: none` so the browser never pans away an active touch drag.
    const onContextMenu = (e: Event) => { if (active) e.preventDefault(); };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    window.addEventListener("contextmenu", onContextMenu);
    cleanup.current = () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("contextmenu", onContextMenu);
      cleanup.current = null;
    };
  }

  return {
    drag,
    start,
    /** True when a click is the tail of a drag and should be ignored. */
    isDragClick: () => Date.now() < suppressClickUntil.current,
  };
}
