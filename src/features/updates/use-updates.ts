"use client";

import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { TERMINAL_PHASES, compareVersions, versionSchema, type UpdateView } from "./protocol";

const IDLE_POLL_MS = 5 * 60_000;
const WATCH_POLL_MS = 15_000;
const ACTIVE_POLL_MS = 2_000;
const REQUEST_PICKUP_MS = 60_000;

async function fetchView(signal: AbortSignal): Promise<UpdateView> {
  const response = await fetch("/api/updates", { cache: "no-store", signal });
  if (!response.ok) throw new Error(`status ${response.status}`);
  return (await response.json()) as UpdateView;
}

/** Only managed releases are versions; null, "dev" and other placeholders are not. */
function managedVersion(value: string | null): string | null {
  const parsed = versionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * The running version this tab should reload to. Only a version newer than the
 * bundle this tab loaded counts; without a known bundle version a locally
 * requested version is the only safe answer.
 */
function reloadVersionFor(candidates: (string | null)[], bundle: string | null): string | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (!bundle || compareVersions(candidate, bundle) > 0) return candidate;
  }
  return null;
}

/**
 * Update workflow policy: poll while idle, switch to fast polling once an
 * update is requested, treat failed fetches during the restart as
 * "reconnecting", and hold the finished update on screen until the owner
 * asks for the reload.
 *
 * A missing or stale status is not evidence that an update failed: the
 * updater may still be running the install. Only a fresh status that shows
 * no operation for this request ends the request, and any tab whose bundle
 * is older than the running version offers the reload.
 */
function useUpdateController() {
  const [view, setView] = useState<UpdateView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Version the owner asked for; polling stays fast until it resolves.
  const [target, setTarget] = useState<string | null>(null);
  // Version that is running while this tab still holds the previous bundle.
  const [pendingReload, setPendingReload] = useState<string | null>(null);
  // Operation id seen when the owner clicked, so an older finished attempt is not mistaken for this one.
  const previousOperation = useRef<string | null>(null);
  // Set once an operation for this request was seen: a later status without
  // an operation is then a gap, not proof that the updater never picked it up.
  const witnessedOperation = useRef(false);
  // Version of the bundle this tab was served; the running version can move ahead of it.
  const bundleVersion = useRef<string | null>(null);
  const requestedAt = useRef(0);
  const sequence = useRef(0);

  const refresh = useCallback(async (signal: AbortSignal) => {
    const id = ++sequence.current;
    try {
      const next = await fetchView(signal);
      if (id !== sequence.current) return; // a newer poll already answered
      setView(next);

      const serverVersion = managedVersion(next.currentVersion);
      if (serverVersion && !bundleVersion.current) bundleVersion.current = serverVersion;

      let reloadVersion: string | null = null;
      let failure: string | null = null;
      let settled = false;

      if (target) {
        if (next.state === "updating") {
          witnessedOperation.current = true; // the updater picked the request up
        } else if (next.currentVersion === target) {
          // The new version is running, but this tab still runs the previous
          // bundle. Hold the page instead of reloading it, so unsaved work
          // survives until the owner asks for the reload.
          reloadVersion = reloadVersionFor([target], bundleVersion.current);
          settled = true;
        } else {
          const ours = next.operation && next.operation.id !== previousOperation.current ? next.operation : null;
          if (ours) {
            witnessedOperation.current = true;
            if (ours.phase === "succeeded") {
              reloadVersion = reloadVersionFor([serverVersion, ours.to], bundleVersion.current);
              settled = true;
            } else if (TERMINAL_PHASES.includes(ours.phase)) {
              // Finished without reaching the target: surface the updater's reason.
              failure = ours.error ?? "The update did not complete. Your data is unchanged.";
              settled = true;
            }
          } else if (
            next.state !== "unavailable" &&
            !witnessedOperation.current &&
            Date.now() - requestedAt.current > REQUEST_PICKUP_MS
          ) {
            // A fresh status without any operation: the updater never picked the request up.
            failure = "The updater did not start the update. Check that its container is running.";
            settled = true;
          }
        }
      }

      // A tab that did not start the update is left behind too: the running
      // version is newer than the bundle this tab loaded.
      if (!reloadVersion && serverVersion && bundleVersion.current && compareVersions(serverVersion, bundleVersion.current) > 0) {
        reloadVersion = serverVersion;
      }

      if (settled) setTarget(null);
      if (reloadVersion) setPendingReload(reloadVersion);
      if (failure) setError(failure);
      // A stale or missing status leaves the update undecided, so keep following it.
      setReconnecting(target !== null && !settled && next.state === "unavailable");
    } catch (e) {
      if (signal.aborted || id !== sequence.current) return;
      if (target) setReconnecting(true); // expected while the container restarts
      else if (e instanceof Error) setError("Could not check for updates.");
    }
  }, [target]);

  // Another tab can start an update at any time, so an available update is
  // watched more closely than an idle vault.
  const pollMs =
    target !== null || view?.state === "updating" ? ACTIVE_POLL_MS : view?.state === "available" ? WATCH_POLL_MS : IDLE_POLL_MS;

  useEffect(() => {
    const controller = new AbortController();
    const first = setTimeout(() => void refresh(controller.signal), 0);
    const timer = setInterval(() => void refresh(controller.signal), pollMs);
    return () => {
      controller.abort();
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [refresh, pollMs]);

  const startUpdate = useCallback(async () => {
    const version = view?.latest?.version;
    if (!version || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Could not start the update.");
      }
      previousOperation.current = view.operation?.id ?? null;
      witnessedOperation.current = false;
      requestedAt.current = Date.now();
      setTarget(version);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the update.");
    } finally {
      setSubmitting(false);
    }
  }, [view, submitting]);

  const dismissError = useCallback(() => setError(null), []);
  /** Loads the installed version; the owner decides when to discard unsaved work. */
  const reload = useCallback(() => window.location.reload(), []);
  const updating = target !== null || view?.state === "updating";
  return { view, error, reconnecting, submitting, updating, target, pendingReload, startUpdate, dismissError, reload };
}

const UpdatesContext = createContext<ReturnType<typeof useUpdateController> | null>(null);

export function UpdatesProvider({ children }: { children: ReactNode }) {
  const updates = useUpdateController();
  return createElement(UpdatesContext.Provider, { value: updates }, children);
}

export function useUpdates() {
  const updates = useContext(UpdatesContext);
  if (!updates) throw new Error("useUpdates requires UpdatesProvider.");
  return updates;
}
