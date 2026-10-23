"use client";

import { useState } from "react";
import { IconExternalLink } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { useUpdates } from "../use-updates";
import { UPDATE_PHASE_LABEL, UPDATE_RESTART_NOTICE, UPDATES_RECOVERY_DOCS_URL, UPDATES_RECOVERY_NOTICE, UpdateStatusDialog, updateNotesSummary } from "./UpdateNotice";

const STATE_TEXT = {
  unmanaged: "Updates are managed outside this installation.",
  unavailable: "The Chibako updater is not responding.",
  current: "You are on the latest version.",
  available: "A new version is available.",
  updating: "An update is in progress.",
} as const;

/** Settings view of the update channel, including the unmanaged and unavailable states. */
export function UpdatesPanel() {
  const {
    view, error, reconnecting, submitting, updating, pendingReload, startUpdate,
    checkForUpdates, checking, checkMessage, checkError,
  } = useUpdates();
  const [open, setOpen] = useState(false);
  if (!view) return <p className="pt-3 text-sm text-muted-foreground">Checking…</p>;

  const phase = view.operation?.phase;
  const needsAttention = phase === "needs_attention";
  const busy = updating || view.state === "updating";
  const latest = view.latest;
  const phaseLabel = phase ? UPDATE_PHASE_LABEL[phase] : undefined;
  const canCheck = !checking && !submitting && !busy && !needsAttention
    && view.state !== "unmanaged" && view.state !== "unavailable";

  return (
    <div className="flex max-w-lg flex-col gap-3 pt-3 text-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">Installed version</dt>
        <dd className="text-right font-medium">{view.currentVersion ? `v${view.currentVersion}` : "Unknown"}</dd>
        <dt className="text-muted-foreground">Available version</dt>
        <dd className="text-right font-medium">
          {latest ? `v${latest.version}` : view.state === "current" ? "Up to date" : "—"}
        </dd>
      </dl>

      <p className="text-muted-foreground">{view.message ?? STATE_TEXT[view.state]}</p>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => void checkForUpdates()} disabled={!canCheck}>
          {checking ? "Checking…" : "Check for updates"}
        </Button>
        {checking && <span role="status" className="text-xs text-muted-foreground">Asking the updater for the latest release…</span>}
      </div>
      {checkMessage && <p role="status" className="text-muted-foreground">{checkMessage}</p>}
      {checkError && <p role="alert" className="text-destructive">{checkError}</p>}

      {pendingReload && (
        <div role="status" className="rounded-md border border-border bg-muted/40 p-3">
          <p className="font-medium">Chibako {pendingReload} is installed and running.</p>
          <p className="mt-1 text-muted-foreground">
            Save any pending changes first — unsaved schema and property edits, and open note drafts, are
            lost on reload. Then use the Reload Chibako button to finish.
          </p>
        </div>
      )}

      {busy && (
        <p role="status" className="text-muted-foreground">
          {reconnecting ? "Restarting Chibako…" : `Update in progress — ${phaseLabel ?? "starting"}…`}
        </p>
      )}

      {needsAttention && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-destructive">
          <p className="font-medium">The last update needs attention</p>
          {view.operation?.error && <p>{view.operation.error}</p>}
          <p>{UPDATES_RECOVERY_NOTICE}</p>
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
      )}

      {view.operation && (phase === "rolled_back" || phase === "failed") && (
        <p className="text-muted-foreground">
          {phase === "rolled_back"
            ? `The update to v${view.operation.to} was rolled back and the previous version was restored.`
            : `The update to v${view.operation.to} did not complete.`}
          {view.operation.error ? ` ${view.operation.error}` : ""}
        </p>
      )}

      {latest && (
        <>
          {!open && (
            <div className="rounded-md border border-border bg-muted/40 p-3">
              <p className="mb-1 text-xs font-medium text-muted-foreground">Release notes</p>
              {latest.notes && <p className="max-h-40 overflow-y-auto whitespace-pre-line text-xs">{latest.notes}</p>}
              {latest.url && (
                <a
                  href={latest.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs text-primary underline underline-offset-4 hover:text-foreground"
                >
                  View release notes
                  <IconExternalLink className="size-3" aria-hidden />
                </a>
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground">{UPDATE_RESTART_NOTICE}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setOpen(true)} disabled={submitting || busy || needsAttention}>
              Update to v{latest.version}
            </Button>
            {needsAttention && (
              <span className="text-xs text-muted-foreground">Updates are paused until the updater is recovered.</span>
            )}
          </div>
        </>
      )}

      {error && <p role="alert" className="text-destructive">{error}</p>}

      {latest && (
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
      )}
    </div>
  );
}
