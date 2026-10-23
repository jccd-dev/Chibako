"use client";

import { useState } from "react";
import { IconCircleArrowUp } from "@tabler/icons-react";
import { useUpdates } from "../use-updates";
import { UpdateStatusDialog, updateNotesSummary } from "./UpdateNotice";

/** Compact rail indicator for an available release; opens the same confirmation surface as the notice. */
export function UpdateRailButton() {
  const { view, submitting, startUpdate } = useUpdates();
  const [open, setOpen] = useState(false);
  const latest = view?.latest;
  if (view?.state !== "available" || !latest || view.operation?.phase === "needs_attention") return null;

  const label = `Update available: v${latest.version}`;
  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={() => setOpen(true)}
        className="relative grid size-8 place-items-center rounded-md text-primary hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <IconCircleArrowUp size={16} aria-hidden="true" />
        <span aria-hidden="true" className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-primary" />
      </button>
      <UpdateStatusDialog
        open={open}
        onOpenChange={setOpen}
        view={view}
        submitting={submitting}
        notes={latest.notes ? updateNotesSummary(latest.notes) : null}
        onConfirm={() => {
          setOpen(false);
          void startUpdate();
        }}
      />
    </>
  );
}
