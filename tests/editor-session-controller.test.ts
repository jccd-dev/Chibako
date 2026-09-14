import assert from "node:assert/strict";
import { test } from "node:test";
import { createEditorSessionController, type EditorSessionEffects } from "../src/features/notes/editor/editor-session-controller";
import type { Note, UpdateNoteInput } from "../src/lib/notes";

function note(id: string, overrides: Partial<Note> = {}): Note {
  return {
    id,
    title: "Original",
    folder: "",
    content: "original",
    kind: "note",
    created_at: 1,
    updated_at: 1,
    deleted_at: null,
    is_pinned: 0,
    properties: {},
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("editor session serializes saves and keeps edits made during a request", async () => {
  const calls: Array<{ current: Note | null; patch: UpdateNoteInput; full: Record<string, unknown> }> = [];
  const pending = [deferred<Note>(), deferred<Note>()];
  let saved: Array<{ note: Note; created: boolean }> = [];
  const effects: EditorSessionEffects = {
    save: async (current, patch, full) => {
      calls.push({ current, patch, full });
      return pending[calls.length - 1].promise;
    },
    onSaved: (savedNote, created) => { saved = [...saved, { note: savedNote, created }]; },
    onError: () => {},
  };
  const controller = createEditorSessionController(null, effects);

  controller.patch({ title: "Draft", content: "first" });
  const flush = controller.persist();
  assert.equal(controller.getSnapshot().saveState, "saving");
  assert.deepEqual(calls[0], {
    current: null,
    patch: { title: "Draft", content: "first" },
    full: { title: "Draft", folder: "", content: "first", kind: "note" },
  });

  controller.patch({ content: "second" });
  pending[0].resolve(note("created", { title: "Draft", content: "first" }));
  for (let i = 0; i < 10 && calls.length < 2; i += 1) await Promise.resolve();
  assert.equal(calls.length, 2, "the follow-up save starts only after the first completes");
  assert.deepEqual(calls[1], {
    current: note("created", { title: "Draft", content: "first" }),
    patch: { content: "second" },
    full: { title: "Draft", folder: "", content: "second", kind: "note" },
  });
  pending[1].resolve(note("created", { title: "Draft", content: "second" }));
  await flush;

  assert.equal(controller.getSnapshot().saveState, "saved");
  assert.equal(controller.getSnapshot().dirty, false);
  assert.deepEqual(saved.map(({ created }) => created), [true, false]);
});

test("editor session restores failed fields without overwriting newer edits", async () => {
  const first = deferred<Note>();
  const calls: Array<{ patch: UpdateNoteInput }> = [];
  const effects: EditorSessionEffects = {
    save: async (_current, patch) => {
      calls.push({ patch });
      if (calls.length === 1) return first.promise;
      return note("existing", { title: "First", content: "newer" });
    },
    onSaved: () => {},
    onError: () => {},
  };
  const controller = createEditorSessionController(note("existing"), effects);
  controller.patch({ title: "First", content: "first" });
  const failed = controller.persist();
  controller.patch({ content: "newer" });
  first.reject(new Error("offline"));
  await assert.rejects(failed, /offline/);

  assert.deepEqual(controller.getSnapshot().title, "First");
  assert.deepEqual(controller.getSnapshot().content, "newer");
  assert.equal(controller.getSnapshot().saveState, "error");
  assert.equal(controller.getSnapshot().dirty, true);

  await controller.persist();
  assert.deepEqual(calls[1].patch, { title: "First", content: "newer" });
  assert.equal(controller.getSnapshot().saveState, "saved");
});

test("server refresh does not replace fields owned by pending or in-flight edits", async () => {
  const save = deferred<Note>();
  const controller = createEditorSessionController(note("existing"), {
    save: async () => save.promise,
    onSaved: () => {},
    onError: () => {},
  });
  controller.patch({ title: "Local title" });
  const flush = controller.persist();
  controller.refreshFromServer(note("existing", { title: "Server title", folder: "Server", content: "server" }));
  assert.equal(controller.getSnapshot().title, "Local title");
  assert.equal(controller.getSnapshot().folder, "Server");
  assert.equal(controller.getSnapshot().content, "original", "active saves retain the local content view");
  save.resolve(note("existing", { title: "Local title", folder: "Server", content: "server" }));
  await flush;
});

test("document replacement flushes the old session before resetting it", async () => {
  const save = deferred<Note>();
  const controller = createEditorSessionController(note("old"), {
    save: async () => save.promise,
    onSaved: () => {},
    onError: () => {},
  });
  controller.patch({ content: "unsent" });
  const replacement = controller.replaceDocument(note("new", { title: "New" }));
  assert.equal(controller.getSnapshot().note?.id, "old");
  save.resolve(note("old", { content: "unsent" }));
  await replacement;
  assert.equal(controller.getSnapshot().note?.id, "new");
  assert.equal(controller.getSnapshot().content, "original");
  assert.equal(controller.getSnapshot().saveState, "saved");
  assert.equal(controller.shouldBlockUnload(), false);
});

test("document replacement suppresses stale save effects after a failed flush", async () => {
  const save = deferred<Note>();
  let errors = 0;
  let saved = 0;
  const controller = createEditorSessionController(note("old"), {
    save: async () => save.promise,
    onSaved: () => { saved += 1; },
    onError: () => { errors += 1; },
  });
  controller.patch({ content: "unsent" });
  const replacement = controller.replaceDocument(note("new", { title: "New" }));
  save.reject(new Error("offline"));
  await replacement;

  assert.equal(errors, 0, "a failed save from the previous document is not reported for the new one");
  assert.equal(saved, 0);
  assert.equal(controller.getSnapshot().note?.id, "new");
  assert.equal(controller.getSnapshot().saveState, "saved");
  assert.equal(controller.shouldBlockUnload(), false);
});

test("unload blocking follows dirty state and disposal flushes pending edits", async () => {
  let saves = 0;
  const controller = createEditorSessionController(note("existing"), {
    save: async (_current, patch) => {
      saves += 1;
      return note("existing", { content: patch.content as string });
    },
    onSaved: () => {},
    onError: () => {},
  });
  assert.equal(controller.shouldBlockUnload(), false);
  controller.patch({ content: "changed" });
  assert.equal(controller.shouldBlockUnload(), true);
  await controller.dispose();
  assert.equal(saves, 1);
  assert.equal(controller.getSnapshot().saveState, "saved");
});
