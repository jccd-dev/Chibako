import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAppearancePreferences,
  DEFAULT_APPEARANCE,
  parseAppearancePreferences,
  readAppearancePreferences,
  writeAppearancePreferences,
} from "../src/lib/appearance";

test("appearance preferences default invalid or missing font choices to DM Sans", () => {
  assert.deepEqual(parseAppearancePreferences(null), DEFAULT_APPEARANCE);
  assert.deepEqual(parseAppearancePreferences("not json"), DEFAULT_APPEARANCE);
  assert.deepEqual(
    parseAppearancePreferences(JSON.stringify({ interfaceFont: "unknown", noteFont: "questrial" })),
    { interfaceFont: "dm-sans", noteFont: "questrial" }
  );
});

test("appearance preferences survive storage round-trips and apply both document roles", () => {
  let stored: string | null = JSON.stringify({ interfaceFont: "existing", noteFont: "quicksand" });
  const storage = {
    getItem: () => stored,
    setItem: (_key: string, value: string) => { stored = value; },
  };
  const root = { dataset: {} as DOMStringMap };

  const preferences = readAppearancePreferences(storage);
  applyAppearancePreferences(preferences, root);
  writeAppearancePreferences(preferences, storage);

  assert.deepEqual(preferences, { interfaceFont: "existing", noteFont: "quicksand" });
  assert.equal(root.dataset.interfaceFont, "existing");
  assert.equal(root.dataset.noteFont, "quicksand");
  assert.equal(stored, JSON.stringify(preferences));
});

test("storage failures keep appearance at the safe default", () => {
  const storage = {
    getItem: () => { throw new Error("storage unavailable"); },
    setItem: () => { throw new Error("storage unavailable"); },
  };

  assert.deepEqual(readAppearancePreferences(storage), DEFAULT_APPEARANCE);
  assert.doesNotThrow(() => writeAppearancePreferences(DEFAULT_APPEARANCE, storage));
});
