import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("vault stats summarize visible notes and the materialized link index", async () => {
  const vault = mkdtempSync(join(tmpdir(), "chibako-vault-stats-test-"));
  process.env.CHIBAKO_DATA_DIR = vault;
  const notes = await import("../src/lib/notes");
  const { getVaultStats } = await import("../src/features/graph/vault-stats");
  const { getDb } = await import("../src/lib/db");
  try {
    notes.createNote({ title: "Target", kind: "wiki", folder: "Guides", content: "target" });
    notes.createNote({ title: "Source", folder: "Guides", content: "[[Target]] [[Missing]]" });
    notes.createNote({ title: "Home", kind: "index", content: "home" });

    assert.deepEqual(getVaultStats(), {
      notes: 3,
      by_kind: { wiki: 1, note: 1, index: 1 },
      folders: 2,
      links: 2,
      unresolved_links: 1,
    });

    const trashed = notes.createNote({ title: "Trashed", content: "[[Missing too]]" });
    notes.deleteNote(trashed.id);
    assert.equal(getVaultStats().notes, 3);
    assert.equal(getVaultStats().links, 2, "links from deleted Notes are excluded from visible-vault stats");
    assert.equal(getVaultStats().unresolved_links, 1);
    assert.equal((getDb().prepare("SELECT COUNT(*) AS count FROM notes WHERE deleted_at IS NOT NULL").get() as { count: number }).count, 1);
  } finally {
    getDb().close();
    rmSync(vault, { recursive: true, force: true });
  }
});
