import type {
  CreateNoteInput,
  Note,
  NoteKind,
  UpdateNoteInput,
} from "../../../lib/notes";

export type SaveState = "saved" | "saving" | "unsaved" | "error";

export interface EditorDocument {
  note: Note | null;
  title: string;
  folder: string;
  content: string;
  kind: NoteKind;
  pinned: boolean;
}

export interface EditorSessionSnapshot extends EditorDocument {
  saveState: SaveState;
  dirty: boolean;
}

export interface EditorSessionEffects {
  save(
    note: Note | null,
    patch: UpdateNoteInput,
    full: Omit<CreateNoteInput, "properties">,
  ): Promise<Note>;
  onSaved(note: Note, created: boolean): void;
  onError(error: unknown): void;
}

export interface EditorSessionController {
  getSnapshot(): EditorSessionSnapshot;
  subscribe(listener: () => void): () => void;
  patch(patch: UpdateNoteInput): void;
  persist(): Promise<void>;
  replaceDocument(note: Note | null): Promise<void>;
  refreshFromServer(note: Note): void;
  shouldBlockUnload(): boolean;
  dispose(): Promise<void>;
}

function documentFor(note: Note | null): EditorDocument {
  return {
    note,
    title: note?.title ?? "",
    folder: note?.folder ?? "",
    content: note?.content ?? "",
    kind: note?.kind ?? "note",
    pinned: note?.is_pinned === 1,
  };
}

function hasField(patch: UpdateNoteInput, field: keyof UpdateNoteInput): boolean {
  return patch[field] !== undefined;
}

function applyPatch(document: EditorDocument, patch: UpdateNoteInput): EditorDocument {
  const next = { ...document };
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.folder !== undefined) next.folder = patch.folder;
  if (patch.content !== undefined) next.content = patch.content;
  if (patch.kind !== undefined) next.kind = patch.kind;
  if (patch.is_pinned !== undefined) next.pinned = patch.is_pinned === 1;
  return next;
}

export function createEditorSessionController(
  initial: Note | null,
  effects: EditorSessionEffects,
): EditorSessionController {
  let document = documentFor(initial);
  let saveState: SaveState = initial ? "saved" : "unsaved";
  let dirty = false;
  let pending: UpdateNoteInput = {};
  let inFlightPatch: UpdateNoteInput | null = null;
  let version = 0;
  let persistPromise: Promise<void> | null = null;
  let replacing = false;
  let disposed = false;
  const listeners = new Set<() => void>();
  let snapshot: EditorSessionSnapshot = {
    ...document,
    saveState,
    dirty,
  };

  function publish(): void {
    snapshot = { ...document, saveState, dirty };
    for (const listener of listeners) listener();
  }

  function setSaveState(next: SaveState): void {
    if (saveState === next) return;
    saveState = next;
    publish();
  }

  function fieldIsOwned(field: keyof UpdateNoteInput): boolean {
    return hasField(pending, field) || (inFlightPatch !== null && hasField(inFlightPatch, field));
  }

  async function savePending(): Promise<void> {
    while (dirty) {
      const patch = { ...pending };
      pending = {};
      const saveVersion = version;
      const current = document.note;
      const full: Omit<CreateNoteInput, "properties"> = {
        title: document.title,
        folder: document.folder,
        content: document.content,
        kind: document.kind,
      };
      inFlightPatch = patch;
      setSaveState("saving");

      let updated: Note;
      try {
        updated = await effects.save(current, patch, full);
      } catch (error) {
        if (saveVersion === version) {
          pending = { ...patch, ...pending };
          dirty = true;
          setSaveState("error");
          if (!replacing) try {
            effects.onError(error);
          } catch {
            // Error reporting must not hide the original save failure.
          }
        }
        throw error;
      } finally {
        if (inFlightPatch === patch) inFlightPatch = null;
      }

      if (saveVersion !== version) continue;
      document = { ...document, note: updated };
      dirty = Object.keys(pending).length > 0;
      setSaveState(dirty ? "unsaved" : "saved");
      if (!replacing) try {
        effects.onSaved(updated, current === null);
      } catch {
        // Navigation/toast side effects cannot invalidate a successful save.
      }
    }
  }

  function persist(): Promise<void> {
    if (persistPromise) return persistPromise;
    if (!dirty) return Promise.resolve();
    const operation = savePending();
    persistPromise = operation;
    void operation.then(
      () => {
        if (persistPromise === operation) persistPromise = null;
      },
      () => {
        if (persistPromise === operation) persistPromise = null;
      },
    );
    return operation;
  }

  return {
    getSnapshot(): EditorSessionSnapshot {
      return snapshot;
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    patch(nextPatch: UpdateNoteInput): void {
      if (disposed) return;
      pending = { ...pending, ...nextPatch };
      document = applyPatch(document, nextPatch);
      dirty = true;
      setSaveState("unsaved");
      publish();
    },

    persist,

    async replaceDocument(nextNote: Note | null): Promise<void> {
      if (disposed) return;
      replacing = true;
      try {
        try {
          await persist();
        } catch {
          // The old session has been attempted; replacement must not carry its
          // failed patch into the newly selected Note.
        }
      } finally {
        version += 1;
        pending = {};
        inFlightPatch = null;
        dirty = false;
        document = documentFor(nextNote);
        saveState = nextNote ? "saved" : "unsaved";
        replacing = false;
        publish();
      }
    },

    refreshFromServer(serverNote: Note): void {
      if (disposed) return;
      const next = { ...document, note: serverNote };
      if (!fieldIsOwned("title")) next.title = serverNote.title;
      if (!fieldIsOwned("folder")) next.folder = serverNote.folder;
      if (!fieldIsOwned("kind")) next.kind = serverNote.kind;
      if (!fieldIsOwned("is_pinned")) next.pinned = serverNote.is_pinned === 1;
      // A server organization refresh must not replace content while any save
      // is active, even when that save only changes metadata.
      if (!fieldIsOwned("content") && !persistPromise) next.content = serverNote.content;
      document = next;
      publish();
    },

    shouldBlockUnload(): boolean {
      return dirty;
    },

    async dispose(): Promise<void> {
      if (disposed) return;
      try {
        await persist();
      } finally {
        disposed = true;
        listeners.clear();
      }
    },
  };
}
