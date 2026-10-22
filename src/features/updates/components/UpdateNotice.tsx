"use client";

import { useId, useState } from "react";
import { IconCircleArrowUp, IconChevronRight, IconExternalLink, IconLoader2, IconRefresh } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { UpdateView } from "../protocol";
import { useUpdates } from "../use-updates";

/** Phase wording shared by the shell notice and the settings panel. */
export const UPDATE_PHASE_LABEL: Record<string, string> = {
  pulling: "Downloading the new version",
  quiescing: "Pausing Chibako",
  snapshotting: "Backing up your vault",
  switching: "Switching versions",
  starting: "Starting the new version",
  validating: "Checking the new version",
  rolling_back: "Restoring the previous version",
};

/** What starting an update means for the vault. */
export const UPDATE_RESTART_NOTICE =
  "Chibako restarts briefly to install the new version. A backup of your vault is attempted before the install starts; if an update fails, recovery may need an operator.";

/**
 * A paused updater is recovered on the host, not from the app: the procedure
 * restores the previous version and reopens the vault only after it is healthy.
 */
export const UPDATES_RECOVERY_DOCS_URL =
  "https://github.com/jccd-dev/chibako/blob/main/docs/UPDATES.md#when-something-goes-wrong";

/** Shared wording for a paused updater. */
export const UPDATES_RECOVERY_NOTICE =
  "Updates stay paused until an operator recovers the updater. Follow the documented recovery steps, then check for updates again.";

export function updateNotesSummary(notes: string): string {
  return notes.replace(/\s+/g, " ").trim().slice(0, 400);
}

/** Status and confirmation surface for a pending update. */
export function UpdateStatusDialog({
  open,
  onOpenChange,
  view,
  submitting,
  notes,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  view: UpdateView;
  submitting: boolean;
  notes?: string | null;
  onConfirm: () => void;
}) {
  const latest = view.latest;
  const installed = view.currentVersion ? `v${view.currentVersion}` : "Unknown";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Update available</DialogTitle>
          <DialogDescription>
            Chibako can install {latest ? `version ${latest.version}` : "a new version"} over the running version.
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-md border border-border bg-muted/40 p-2 text-xs">
          <dt className="text-muted-foreground">Installed</dt>
          <dd className="text-right font-medium">{installed}</dd>
          <dt className="text-muted-foreground">Available</dt>
          <dd className="text-right font-medium">{latest ? `v${latest.version}` : "—"}</dd>
        </dl>
        {notes ? (
          <div className="rounded-md border border-border p-2 text-xs">
            <p className="mb-1 font-medium text-muted-foreground">Release notes</p>
            <p className="max-h-28 overflow-y-auto">{notes}</p>
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">{UPDATE_RESTART_NOTICE}</p>
        {latest?.url ? (
          <a
            href={latest.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 self-start text-xs text-primary underline underline-offset-4 hover:text-foreground"
          >
            View release notes
            <IconExternalLink className="size-3" aria-hidden />
          </a>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onConfirm} disabled={submitting}>
            {submitting ? "Starting…" : "Update now"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Explicit reload step after a finished update: the page keeps running until
 * the owner asks for it, and the confirmation names what the reload discards.
 */
function UpdateReloadButton({ version }: { version: string }) {
  const { reload } = useUpdates();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <IconRefresh data-icon="inline-start" aria-hidden="true" />
        Reload Chibako
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reload Chibako?</DialogTitle>
            <DialogDescription>
              Chibako {version} is installed and running. Reloading loads the new version, but anything you
              have not saved yet — including open settings and note edits — will be lost. Save your work
              first, then reload.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => {
              setOpen(false);
              reload();
            }}>Reload now</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Shell row for the update channel: it opens the update surface, never starts an update. */
export function UpdateNotice() {
  const { view, error, reconnecting, submitting, updating, target, pendingReload, startUpdate, dismissError } = useUpdates();
  const [open, setOpen] = useState(false);
  const descriptionId = useId();

  if (updating) {
    const phase = view?.operation?.phase;
    const label = reconnecting ? "Restarting Chibako" : (phase && UPDATE_PHASE_LABEL[phase]) || "Starting the update";
    return (
      <div role="status" className="flex items-center gap-2 border-b border-border bg-muted px-4 py-2 text-sm">
        <IconLoader2 className="size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />
        <span className="font-medium">Updating{target ? ` to v${target}` : ""}</span>
        <span className="text-muted-foreground">{label}… Chibako restarts briefly while the new version starts.</span>
      </div>
    );
  }

  if (pendingReload) {
    return (
      <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-primary/10 px-4 py-2 text-sm">
        <IconCircleArrowUp className="size-5 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <p>
            <span className="font-medium">Chibako {pendingReload} is installed.</span>{" "}
            <span className="text-muted-foreground">Save any pending edits, then reload to start using it.</span>
          </p>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <UpdateReloadButton version={pendingReload} />
      </div>
    );
  }

  if (error) {
    const phase = view?.operation?.phase;
    const summary = phase === "rolled_back"
      ? "The update was rolled back and the previous version was restored."
      : phase === "failed"
        ? "The update did not complete."
        : null;
    return (
      <div role="alert" className="flex items-start justify-between gap-3 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
        <p className="min-w-0">
          {summary ? <span className="font-medium">{summary} </span> : null}
          <span>{error}</span>
        </p>
        <Button size="sm" variant="ghost" onClick={dismissError}>Dismiss</Button>
      </div>
    );
  }

  if (view?.operation?.phase === "needs_attention") {
    // The updater refuses further updates until it is recovered, so no action is offered here.
    return (
      <div role="alert" className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
        <p className="font-medium">The last update needs attention</p>
        <p>{view.operation.error ?? "The updater paused the update."}</p>
        <p className="text-destructive/90">{UPDATES_RECOVERY_NOTICE}</p>
        <a
          href={UPDATES_RECOVERY_DOCS_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-flex items-center gap-1 text-xs underline underline-offset-4 hover:text-foreground"
        >
          Recovery steps in the update documentation
          <IconExternalLink className="size-3" aria-hidden />
        </a>
      </div>
    );
  }

  if (view?.state !== "available" || !view.latest) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Update"
        aria-describedby={descriptionId}
        className="group flex w-full items-center gap-3 border-b border-border bg-primary/10 px-4 py-2 text-left transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"
      >
        <IconCircleArrowUp className="size-5 shrink-0 text-primary" aria-hidden />
        <span className="flex min-w-0 flex-col">
          <span className="text-sm font-medium leading-tight">Update available</span>
          <span className="truncate text-xs text-muted-foreground">v{view.latest.version}</span>
        </span>
        <IconChevronRight
          className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transform-none motion-reduce:transition-none"
          aria-hidden
        />
      </button>
      <p id={descriptionId} className="sr-only">
        Chibako {view.latest.version} is ready to install. Opens the update details.
      </p>
      <UpdateStatusDialog
        open={open}
        onOpenChange={setOpen}
        view={view}
        submitting={submitting}
        notes={view.latest.notes ? updateNotesSummary(view.latest.notes) : null}
        onConfirm={() => {
          setOpen(false);
          void startUpdate();
        }}
      />
    </>
  );
}
