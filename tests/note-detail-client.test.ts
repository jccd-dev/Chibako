import assert from "node:assert/strict";
import { test } from "node:test";
import { createNoteDetailClient, type NoteDetailData } from "../src/features/notes/note-detail-client";

interface FakeRequest {
  url: string;
  release(): void;
}

function fakeFetch(noteId: string, extra: Partial<NoteDetailData> = {}) {
  const requests: FakeRequest[] = [];
  const fetcher = async (url: string): Promise<unknown> => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    requests.push({ url, release });
    await gate;
    if (url.endsWith("/links")) return { outlinks: [], backlinks: [], ...extra.links };
    if (url.endsWith("/mentions")) return { mentions: [], ...extra.mentions };
    throw new Error(`unexpected request: ${url}`);
  };
  return { fetcher, requests };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

test("a note detail load issues its two requests without waiting for the first", async () => {
  const { fetcher, requests } = fakeFetch("n1");
  const client = createNoteDetailClient(fetcher);

  const pending = client.load("n1");
  await settle();
  assert.equal(requests.length, 2, "both requests are in flight, not issued one after the other");
  assert.deepEqual(requests.map((r) => r.url).sort(), ["/api/notes/n1/links", "/api/notes/n1/mentions"]);

  for (const request of requests) request.release();
  const data = await pending;
  assert.deepEqual(data, { links: { outlinks: [], backlinks: [] }, mentions: [] });
});

test("an already-loaded note renders without issuing a request", async () => {
  const { fetcher, requests } = fakeFetch("n1");
  const client = createNoteDetailClient(fetcher);

  const first = client.load("n1");
  await settle();
  for (const request of requests) request.release();
  await first;

  const cached = await client.load("n1");
  assert.equal(requests.length, 2, "the second visit is served from the cache");
  assert.deepEqual(cached, { links: { outlinks: [], backlinks: [] }, mentions: [] });
});

test("switching back to a visited note still renders from the cache", async () => {
  const { fetcher, requests } = fakeFetch("n1");
  const client = createNoteDetailClient(fetcher);

  const first = client.load("n1");
  await settle();
  for (const request of requests) request.release();
  await first;

  const other = client.load("other");
  await settle();
  for (const request of requests.slice(2)) request.release();
  await other;

  await client.load("n1");
  assert.equal(requests.filter((r) => r.url.endsWith("/n1/links")).length, 1, "n1 was not re-fetched");
});

test("an invalidated note reloads on the next visit", async () => {
  const { fetcher, requests } = fakeFetch("n1");
  const client = createNoteDetailClient(fetcher);

  const first = client.load("n1");
  await settle();
  for (const request of requests) request.release();
  await first;

  client.invalidate("n1");
  const reloaded = client.load("n1");
  await settle();
  assert.equal(requests.length, 4);
  for (const request of requests.slice(2)) request.release();
  await reloaded;
});

test("invalidating every note clears the cache", async () => {
  const { fetcher, requests } = fakeFetch("n1");
  const client = createNoteDetailClient(fetcher);

  const first = client.load("n1");
  await settle();
  for (const request of requests) request.release();
  await first;

  client.invalidate();
  const reloaded = client.load("n1");
  await settle();
  assert.equal(requests.length, 4);
  for (const request of requests.slice(2)) request.release();
  await reloaded;
});

test("a slow load for a note the user left does not surface", async () => {
  const { fetcher, requests } = fakeFetch("slow");
  const client = createNoteDetailClient(fetcher);

  const abandoned = client.load("slow");
  const current = client.load("current");
  await settle();
  for (const request of requests) request.release();
  await Promise.all([abandoned, current]);

  assert.ok((await client.load("current")).links, "the note still open resolves");
});

test("an in-flight load cannot re-seed the cache after an invalidation", async () => {
  const { fetcher, requests } = fakeFetch("n1");
  const client = createNoteDetailClient(fetcher);

  const stale = client.load("n1");
  await settle();
  client.invalidate("n1");
  for (const request of requests) request.release();
  await stale;

  const fresh = client.load("n1");
  await settle();
  assert.equal(requests.length, 4, "the invalidated note is fetched again");
  for (const request of requests.slice(2)) request.release();
  await fresh;
});

test("one failing endpoint still yields the other's data", async () => {
  const fetcher = async (url: string): Promise<unknown> => {
    if (url.endsWith("/links")) throw new Error("offline");
    return { mentions: [{ id: "m1", title: "Other", folder: "", snippet: "x" }] };
  };
  const client = createNoteDetailClient(fetcher);

  const data = await client.load("n1");
  assert.deepEqual(data.mentions, [{ id: "m1", title: "Other", folder: "", snippet: "x" }]);
  assert.deepEqual(data.links, { outlinks: [], backlinks: [] });
});

test("a failed load is not cached as an empty result", async () => {
  let failLinks = true;
  const fetcher = async (url: string): Promise<unknown> => {
    if (url.endsWith("/links")) {
      if (failLinks) {
        failLinks = false;
        throw new Error("offline");
      }
      return { outlinks: [{ target: "T", target_id: "1", resolved: true }], backlinks: [] };
    }
    return { mentions: [] };
  };
  const client = createNoteDetailClient(fetcher);

  const first = await client.load("n1");
  assert.equal(first.links.outlinks.length, 0, "the failed endpoint reads as empty");
  const second = await client.load("n1");
  assert.equal(second.links.outlinks.length, 1, "the retry fetched the links again");
});
