import assert from "node:assert/strict";
import { test } from "node:test";
import { rrf } from "../src/lib/recall";

test("weighted rrf keeps semantic hits above keyword-only hits and boosts notes in both", () => {
  const keyword = [{ id: "keyword-only" }, { id: "both" }];
  const vector = [{ id: "both" }, ...Array.from({ length: 40 }, (_, i) => ({ id: `v${i}` })), { id: "vector-late" }];
  const order = rrf([keyword, vector], [0.5, 1]).map((r) => r.id);
  assert.equal(order[0], "both");
  assert(order.indexOf("vector-late") < order.indexOf("keyword-only"));
  // Keyword-only recall (no embeddings) still ranks normally.
  assert.deepEqual(rrf([keyword], [0.5, 1]).map((r) => r.id), ["keyword-only", "both"]);
});
