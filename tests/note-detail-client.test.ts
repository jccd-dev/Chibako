import assert from "node:assert/strict";
import { test } from "node:test";
import { createNoteDetailClient } from "../src/features/notes/note-detail-client";

const empty = { outlinks: [], backlinks: [], mentions: [] };
const expected = { links: { outlinks: [], backlinks: [] }, mentions: [] };

function fakeFetch() {
  const requests: Array<{ url: string; release(): void }> = [];
  const fetcher = async (url: string): Promise<unknown> => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    requests.push({ url, release });
    await gate;
    return empty;
  };
  return { fetcher, requests };
}

test("a cold note loads links and mentions in one combined request", async () => {
  const { fetcher, requests } = fakeFetch();
  const client = createNoteDetailClient(fetcher);
  const pending = client.load("n1");
  assert.deepEqual(requests.map((r) => r.url), ["/api/notes/n1/links?include=mentions"]);
  requests[0].release();
  assert.deepEqual(await pending, expected);
});

test("concurrent readers share the same request and revisits issue none", async () => {
  const { fetcher, requests } = fakeFetch();
  const client = createNoteDetailClient(fetcher);
  const first = client.load("n1");
  assert.equal(client.load("n1"), first);
  requests[0].release();
  await first;
  assert.deepEqual(await client.load("n1"), expected);
  assert.equal(requests.length, 1);
});

test("switching back to a visited note uses the cache", async () => {
  const { fetcher, requests } = fakeFetch();
  const client = createNoteDetailClient(fetcher);
  for (const id of ["n1", "other"]) {
    const pending = client.load(id);
    requests.at(-1)!.release();
    await pending;
  }
  await client.load("n1");
  assert.equal(requests.length, 2);
});

for (const scope of ["n1", undefined]) {
  test(`invalidation (${scope ?? "all"}) reloads and prevents stale in-flight caching`, async () => {
    const { fetcher, requests } = fakeFetch();
    const client = createNoteDetailClient(fetcher);
    const stale = client.load("n1");
    client.invalidate(scope);
    const fresh = client.load("n1");
    requests[0].release();
    await stale;
    requests[1].release();
    await fresh;
    await client.load("n1");
    assert.equal(requests.length, 2, "old completion cannot evict or overwrite fresh load");
    client.invalidate(scope);
    const reload = client.load("n1");
    requests[2].release();
    await reload;
    assert.equal(requests.length, 3);
  });
}

test("partial responses preserve available data but are never cached", async () => {
  let requests = 0;
  const mentions = [{ id: "m1", title: "Other", folder: "", snippet: "x" }];
  const client = createNoteDetailClient(async () => {
    requests += 1;
    return requests === 1 ? { mentions } : { ...empty, mentions };
  });
  assert.deepEqual((await client.load("n1")).mentions, mentions);
  await client.load("n1");
  await client.load("n1");
  assert.equal(requests, 2);
});

for (const failure of [null, { ok: false }, "throw"]) {
  test(`a failed combined load (${JSON.stringify(failure)}) remains retryable`, async () => {
    let requests = 0;
    const client = createNoteDetailClient(async () => {
      requests += 1;
      if (requests === 1) {
        if (failure === "throw") throw new Error("offline");
        return failure;
      }
      return { ...empty, outlinks: [{ target: "T", target_id: "1", resolved: true }] };
    });
    assert.deepEqual(await client.load("n1"), expected);
    assert.equal((await client.load("n1")).links.outlinks.length, 1);
    assert.equal(requests, 2);
  });
}
