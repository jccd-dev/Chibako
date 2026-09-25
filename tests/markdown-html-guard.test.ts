import assert from "node:assert/strict";
import { test } from "node:test";
import { findUnsupportedHtml } from "../src/lib/markdown";

test("flags HTML the rich editor would drop", () => {
  assert.deepEqual(findUnsupportedHtml("<div>x</div>"), ["<div>", "</div>"]);
  assert.deepEqual(findUnsupportedHtml("before <!-- hidden --> after"), ["<!-- hidden -->"]);
  assert.deepEqual(findUnsupportedHtml("a <br> b"), ["<br>"]);
  assert.deepEqual(findUnsupportedHtml('<span style="color:red">x</span>'), ['<span style="color:red">', "</span>"]);
});

test("leaves plain Markdown alone", () => {
  assert.deepEqual(findUnsupportedHtml("see <https://example.com> and <me@example.com>"), []);
  assert.deepEqual(findUnsupportedHtml("3 < 5 and 7 > 2"), []);
  assert.deepEqual(findUnsupportedHtml("press <Cmd+S> or <Ctrl+K> to save"), []);
});

test("ignores HTML inside code", () => {
  assert.deepEqual(findUnsupportedHtml("```html\n<div>x</div>\n```"), []);
  assert.deepEqual(findUnsupportedHtml("~~~\n<!-- hidden -->\n~~~"), []);
  assert.deepEqual(findUnsupportedHtml("    <div>x</div>"), []);
  assert.deepEqual(findUnsupportedHtml("use ``<div>`` here"), []);
  assert.deepEqual(findUnsupportedHtml("use `<div>` here"), []);
});

test("caps and deduplicates the reported snippets", () => {
  assert.deepEqual(findUnsupportedHtml("<br>a<br>b<br>c<br>"), ["<br>"]);
  assert.deepEqual(findUnsupportedHtml("<a><b><c><d>"), ["<a>", "<b>", "<c>"]);
});
