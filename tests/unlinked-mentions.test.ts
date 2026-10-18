import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("unlinked mentions report plain-text mentions, skip linked notes, and stop at twenty", async () => {
  const vault = mkdtempSync(join(tmpdir(), "chibako-mentions-test-"));
  process.env.CHIBAKO_DATA_DIR = vault;
  const notes = await import("../src/lib/notes");
  const { getDb } = await import("../src/lib/db");
  try {
    const target = notes.createNote({ title: "Budget", content: "the budget body" });
    const plain = notes.createNote({ title: "Meeting", content: "we reviewed the Budget and the budget again" });
    // A [[wikilink]] to the target: the plain-text word must not make it a mention.
    const wikilinked = notes.createNote({ title: "Linked", content: "see [[Budget]] also the budget" });
    const unrelated = notes.createNote({ title: "Other", content: "nothing relevant here" });
    // Mentions the title in frontmatter only, so the body never does.
    const frontmatterOnly = notes.createNote({
      title: "Meta",
      content: "---\nrelated: Budget\n---\nbody without the word",
    });

    const found = notes.unlinkedMentions(target.id);
    assert.deepEqual(found.map((m) => m.id), [plain.id], "frontmatter alone is not a mention");
    assert.equal(found.some((m) => m.id === wikilinked.id), false, "a [[wikilink]] is never an unlinked mention");
    assert.equal(found.some((m) => m.id === frontmatterOnly.id), false);
    assert.equal(found.some((m) => m.id === unrelated.id), false);
    assert.equal(found.some((m) => m.id === target.id), false, "the note never mentions itself");
    assert.match(found[0].snippet, /[Bb]udget/);

    // A trashed note drops out of the scan.
    notes.updateNote(unrelated.id, { content: "mentions the Budget" });
    notes.deleteNote(unrelated.id);
    assert.equal(notes.unlinkedMentions(target.id).some((m) => m.id === unrelated.id), false);

    // The scan is capped so a widely-referenced note cannot stall the panel.
    const anchor = notes.createNote({ title: "Anchor", content: "body" });
    for (let i = 0; i < 30; i += 1) {
      notes.createNote({ title: `Note ${String(i).padStart(2, "0")}`, content: "the Anchor appears here" });
    }
    assert.equal(notes.unlinkedMentions(anchor.id).length, 20);

    assert.equal(notes.unlinkedMentions("missing-id").length, 0, "an unknown note yields nothing");
  } finally {
    getDb().close();
    rmSync(vault, { recursive: true, force: true });
  }
});
