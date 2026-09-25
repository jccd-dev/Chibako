"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  createEditorSessionController,
  type EditorSessionController,
  type EditorSessionEffects,
} from "./editor-session-controller";
import type { Note } from "../../../lib/notes";
import type { EditorDocument } from "./editor-session-controller";

export interface NoteEditorSessionEffects extends EditorSessionEffects {
  onOrganized?(): void;
  onOrganizationError?(): void;
}

export function useNoteEditorSession(
  initial: Note | null,
  effects: NoteEditorSessionEffects,
  initialDraft?: Partial<Omit<EditorDocument, "note">>,
): ReturnType<EditorSessionController["getSnapshot"]> & Pick<EditorSessionController, "patch" | "persist" | "refreshFromServer" | "shouldBlockUnload"> {
  const effectsRef = useRef(effects);
  effectsRef.current = effects;
  const controllerRef = useRef<EditorSessionController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createEditorSessionController(initial, {
      save: (...args) => effectsRef.current.save(...args),
      onSaved: (...args) => effectsRef.current.onSaved(...args),
      onError: (error) => effectsRef.current.onError(error),
    }, initialDraft);
  }
  const controller = controllerRef.current;
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const previousInitialIdRef = useRef<string | null>(initial?.id ?? null);

  useEffect(() => {
    const initialId = initial?.id ?? null;
    const currentId = controller.getSnapshot().note?.id ?? null;
    if (initialId === currentId) {
      previousInitialIdRef.current = initialId;
      return;
    }
    // A newly created note is saved before the App Router sends the new
    // server props. Do not erase that local document while the URL is still
    // transitioning from /new to the created note.
    if (initialId === null && currentId !== null && previousInitialIdRef.current === null) return;
    previousInitialIdRef.current = initialId;
    void controller.replaceDocument(initial);
  }, [controller, initial]);

  useEffect(() => {
    if (!snapshot.dirty) return;
    const timer = window.setTimeout(() => {
      void controller.persist().catch(() => {});
    }, 700);
    return () => window.clearTimeout(timer);
  }, [controller, snapshot.dirty, snapshot.title, snapshot.folder, snapshot.content, snapshot.kind, snapshot.pinned]);

  useEffect(() => {
    const onUnload = (event: BeforeUnloadEvent) => {
      if (controller.shouldBlockUnload()) event.preventDefault();
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [controller]);

  useEffect(() => {
    const beforeOrganize = (event: Event) => {
      if (event instanceof CustomEvent && Array.isArray(event.detail)) {
        event.detail.push(controller.persist());
      }
    };
    const organized = async () => {
      const id = controller.getSnapshot().note?.id;
      if (!id) return;
      try {
        const response = await fetch(`/api/notes/${id}`);
        if (!response.ok || controller.getSnapshot().note?.id !== id) return;
        const { note } = await response.json() as { note: Note };
        controller.refreshFromServer(note);
        effectsRef.current.onOrganized?.();
      } catch {
        effectsRef.current.onOrganizationError?.();
      }
    };
    window.addEventListener("chibako:before-organize", beforeOrganize);
    window.addEventListener("chibako:organized", organized);
    return () => {
      window.removeEventListener("chibako:before-organize", beforeOrganize);
      window.removeEventListener("chibako:organized", organized);
    };
  }, [controller]);

  const lifecycleRef = useRef(0);
  useEffect(() => {
    const generation = ++lifecycleRef.current;
    return () => {
      // React Strict Mode rehearses an effect cleanup/setup pair in
      // development. Delay disposal so that rehearsal does not permanently
      // disable the controller used by the real mount.
      queueMicrotask(() => {
        if (lifecycleRef.current === generation) void controller.dispose().catch(() => {});
      });
    };
  }, [controller]);

  return {
    ...snapshot,
    patch: controller.patch,
    persist: controller.persist,
    refreshFromServer: controller.refreshFromServer,
    shouldBlockUnload: controller.shouldBlockUnload,
  };
}
