import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { getDb } from "../../src/lib/db";
import * as index from "../../src/lib/embedding-index";
import * as repair from "../../src/lib/embedding-repair";
import * as notes from "../../src/lib/notes";
import { ok, refuse, withProvider, type Handler } from "./provider-fixture";

const vault = mkdtempSync(join(tmpdir(), "chibako-volume-limit-"));
process.env.CHIBAKO_DATA_DIR = vault;
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });

test("a Provider volume limit keeps the requests that passed, and repair ticks go from 51 of 163 Notes to all 163", async () => {
  for (let i = 0; i < 163; i++) notes.createNote({ title: `Volume ${i}`, content: `Volume body number ${i} SECRET-NOTE-TEXT` });
  assert.equal(index.embeddingStatus().total, 163);
  let used = 0;
  const limit = 51; // Notes the Provider takes per window; a request that would pass it is refused whole
  const handler: Handler = (res, inputs, texts) => {
    if (used + inputs > limit) return refuse(res, inputs, texts);
    used += inputs;
    ok(res, inputs, texts);
  };
  await withProvider(handler, async () => {
    await repair.runEmbeddingRepair({ batch: 51 });
    assert.equal(used, 51);
    assert.equal(index.embeddingStatus().rows, 51, "every request that passed was kept");
    assert.equal(index.embeddingStatus().indexed, 51);
    const status = index.embeddingStatus();
    assert.equal(status.repair_indexed, 51);
    assert.equal(status.repair_remaining, 112);
    assert.match(status.last_error ?? "", /^\[retry-after=12 x-ratelimit-remaining-requests=0\] embedding request failed \(429\)/);
    assert.doesNotMatch(status.last_error ?? "", /TEST-secret-key|SECRET-NOTE-TEXT/);

    let ticks = 1;
    while (index.embeddingStatus().stale > 0 && ticks < 6) {
      used = 0; // a new window
      await repair.runEmbeddingRepair({ batch: 51 });
      ticks++;
    }
    assert.equal(index.embeddingStatus().indexed, 163, `all 163 Notes indexed after ${ticks} ticks`);
    assert.equal(index.embeddingStatus().repair_remaining, 0);
    assert.equal(index.embeddingStatus().repair_indexed, 163);
    assert.equal(ticks, 4);
  }, { CHIBAKO_EMBEDDING_BATCH: "3" });
});
