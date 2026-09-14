import assert from "node:assert/strict";
import { test } from "node:test";
import { graphLayoutFor } from "../src/lib/graph-layout";

test("larger graphs use tighter spacing without weakening orphan centering", () => {
  const small = graphLayoutFor(16);
  const large = graphLayoutFor(128);

  assert(large.linkDistance < small.linkDistance);
  assert(Math.abs(large.chargeStrength) < Math.abs(small.chargeStrength));
  assert(large.centerStrength > small.centerStrength);
  assert.equal(large.orphanStrength, small.orphanStrength);
});
