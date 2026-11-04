import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sessionMemory } from "../../../src/features/memory/session-memory";
import { getDb } from "../../../src/lib/db";
import { reindexEmbeddings } from "../../../src/lib/embedding-index";
import { createNote } from "../../../src/lib/notes";

export const FIXTURE_QUESTIONS = join(import.meta.dirname, "questions.json");

const NOTES: Array<{ title: string; content: string; kind?: "wiki" }> = [
  { title: "Hosting Decision", content: "The server provider is Hetzner because of price and EU data residency.", kind: "wiki" },
  { title: "Database Choice", content: "SQLite with WAL is the only store for the database. There is no Postgres.", kind: "wiki" },
  { title: "Launch Checklist", content: "The launch sequence begins at dawn with a final systems check." },
  { title: "Release Process", content: "Releases are tagged on main and the plugin workflow publishes them.", kind: "wiki" },
  { title: "Money Handling", content: "Money is exact integer cents. Rounding happens only at display.", kind: "wiki" },
];

/** Builds a fake vault in the OS temp dir (fake Embedding provider, one checkpoint). The caller closes it. */
export async function createFixtureVault(): Promise<{ dir: string; cleanup: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), "chibako-scoreboard-fixture-"));
  process.env.CHIBAKO_DATA_DIR = dir;
  process.env.CHIBAKO_EMBEDDING_PROVIDER = "fake";
  process.env.CHIBAKO_MEMORY_FOLDER = "Agent Memory";
  delete process.env.CHIBAKO_EMBEDDING_API_KEY;
  for (const note of NOTES) createNote(note);
  sessionMemory({ id: "fixture-agent", scopes: ["memory:write", "notes:read"] }, {
    runtime: "claude", session_id: "fixture-session", action: "save", request_id: "fixture-save",
    title: "Billing refactor", project: "demo", content: "Decided cents stay integers; the tax rate question is still open.",
    expected_revision: null, now_line: "Continue billing work",
  });
  await reindexEmbeddings();
  return { dir, cleanup: () => { getDb().close(); rmSync(dir, { recursive: true, force: true }); } };
}
