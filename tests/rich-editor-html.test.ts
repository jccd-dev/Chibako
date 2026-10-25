import assert from "node:assert/strict";
import test from "node:test";
import StarterKit from "@tiptap/starter-kit";
import { MarkdownManager } from "@tiptap/markdown";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { htmlFormattingExtensions, RawHtmlBlock, RawHtmlInline } from "../src/features/notes/components/editor/HtmlExtensions";
import { WikiLink } from "../src/features/notes/components/editor/WikiLinkExtension";

const manager = new MarkdownManager({
  extensions: [StarterKit.configure({ underline: false }), ...htmlFormattingExtensions, RawHtmlInline, RawHtmlBlock, Table, TableRow, TableHeader, TableCell, WikiLink],
});

function roundTrip(md: string): string {
  return manager.serialize(manager.parse(md));
}

test("raw HTML round-trips through the rich editor unchanged", () => {
  for (const md of [
    "Folder `Projects/<area>/<project>` and Projects/<area>/<project>",
    'Text with <span style="color:red">red</span> and <kbd>K</kbd> and a <br> break',
    "before <!-- hidden --> after",
    '<div class="callout">\n  inside\n</div>',
    "<details>\n<summary>More</summary>\n\nBody\n\n</details>",
    "<u>under <b>bold</b></u> and <mark class=\"x\">hi</mark> and an unclosed <u> tag",
    "Link [[Note]] then <sup>",
    "inline <?php echo 1 ?> and <!DOCTYPE html> forms",
  ]) {
    assert.equal(roundTrip(md), md);
  }
});

test("raw HTML in table cells survives the table's own reformatting", () => {
  assert.match(roundTrip("| a | b |\n| --- | --- |\n| x<br>y | <span>z</span> |"), /\| x<br>y \| <span>z<\/span> \|/);
});

test("plain formatting tags become marks and save as HTML", () => {
  const doc = manager.parse("a <u>**b**</u> <mark>c</mark> H<sub>2</sub>O x<sup>2</sup>");
  const marks = doc.content?.[0]?.content?.flatMap((n) => n.marks?.map((m) => m.type) ?? []);
  assert.deepEqual(marks, ["bold", "underline", "highlight", "subscript", "superscript"]);
  assert.equal(manager.serialize(doc), "a **<u>b</u>** <mark>c</mark> H<sub>2</sub>O x<sup>2</sup>");
});

test("Markdown-looking text is not rewritten into HTML marks", () => {
  assert.equal(roundTrip("keep ==this== and ++that++"), "keep ==this== and ++that++");
});
