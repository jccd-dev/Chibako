import assert from "node:assert/strict";
import { test } from "node:test";
import { createNoteTreeCache, type NoteTreeData } from "../src/features/notes/note-tree-cache";

interface FakeRequest {
  release(): void;
}

function fakeTreeFetcher(tree: NoteTreeData) {
  const requests: FakeRequest[] = [];
  const fetcher = async (): Promise<unknown> => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    requests.push({ release });
    await gate;
    return tree;
  };
  return { fetcher, requests };
}

const TREE: NoteTreeData = { notes: [{ id: "n1", title: "One", folder: "", kind: "note", created_at: 1, updated_at: 1, deleted_at: null, is_pinned: 0, properties: {} }], folders: [] };

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

test("the first read fetches the tree", async () => {
  const { fetcher, requests } = fakeTreeFetcher(TREE);
  const cache = createNoteTreeCache(fetcher);
  const pending = cache.read();
  await settle();
  assert.equal(requests.length, 1);
  for (const request of requests) request.release();
  assert.deepEqual(await pending, TREE);
});

test("navigation re-reads the tree without a second request", async () => {
  const { fetcher, requests } = fakeTreeFetcher(TREE);
  const cache = createNoteTreeCache(fetcher);
  const first = cache.read();
  await settle();
  for (const request of requests) request.release();
  await first;

  assert.deepEqual(await cache.read(), TREE, "the cached tree answers immediately");
  assert.equal(requests.length, 1, "switching notes did not refetch the whole tree");
});

test("concurrent readers share one request", async () => {
  const { fetcher, requests } = fakeTreeFetcher(TREE);
  const cache = createNoteTreeCache(fetcher);
  const a = cache.read();
  const b = cache.read();
  await settle();
  assert.equal(requests.length, 1, "the sidebar and the editor share the in-flight fetch");
  for (const request of requests) request.release();
  await Promise.all([a, b]);
});

test("a change signal forces the next read to refetch", async () => {
  const { fetcher, requests } = fakeTreeFetcher(TREE);
  const cache = createNoteTreeCache(fetcher);
  const first = cache.read();
  await settle();
  for (const request of requests) request.release();
  await first;

  cache.invalidate();
  const refreshed = cache.read();
  await settle();
  assert.equal(requests.length, 2);
  for (const request of requests.slice(1)) request.release();
  assert.deepEqual(await refreshed, TREE);
});

test("a forced refresh serves the new tree to later readers", async () => {
  const updated: NoteTreeData = { notes: [], folders: [{ name: "f" }] };
  let current = TREE;
  const requests: FakeRequest[] = [];
  const fetcher = async (): Promise<unknown> => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    requests.push({ release });
    await gate;
    return current;
  };
  const cache = createNoteTreeCache(fetcher);
  const first = cache.read();
  await settle();
  for (const request of requests) request.release();
  await first;

  current = updated;
  cache.invalidate();
  const refreshed = cache.read();
  await settle();
  for (const request of requests.slice(1)) request.release();
  await refreshed;

  assert.deepEqual(await cache.read(), updated, "the new tree replaced the old one");
});

test("a failed fetch keeps the previous tree and allows a retry", async () => {
  let failNext = true;
  const requests: FakeRequest[] = [];
  const fetcher = async (): Promise<unknown> => {
    if (failNext) {
      failNext = false;
      throw new Error("offline");
    }
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    requests.push({ release });
    await gate;
    return TREE;
  };
  const cache = createNoteTreeCache(fetcher);

  assert.deepEqual(await cache.read(), { notes: [], folders: [] }, "a failed first read starts empty");
  const retry = cache.read();
  await settle();
  for (const request of requests) request.release();
  assert.deepEqual(await retry, TREE, "the retry fetched for real");
});
