import { createHash } from "node:crypto";
import { getDb } from "../../lib/db";
import { getNote } from "../../lib/notes";
import { saveObservation } from "../../lib/recall";
import { normalizeFolder } from "../organization/folders";
import { memoryFolder, persist } from "./memory";
import { z } from "zod";
import { MemoryError, factSaveSchema, memoryWriteSchema } from "./types";

const factWriteSchema = memoryWriteSchema.extend({ content: z.string().min(1) });

/** Idempotency namespace for Fact notes. Authorization (notes:write) is the transport's job, as it was for observations. */
const FACT_ACTOR = "fact-notes";

export interface FactReceipt {
  id: string;
  note_id: string | null;
  created_at: number;
  saved: true;
}

/** First line of the fact, stripped of Markdown and the characters a Wikilink cannot hold. */
function deriveTitle(content: string): string {
  const line = content.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const plain = line.replace(/^(?:[#>*+-]+|\d+[.)])\s*/, "").replace(/[[\]|/\\\x00-\x1f]/g, " ").replace(/\s+/g, " ").trim();
  if (plain.length <= 80) return plain || "Fact";
  const cut = plain.slice(0, 80);
  return (cut.slice(0, cut.lastIndexOf(" ")) || cut).trim();
}

function freeTitle(folder: string, base: string): string {
  const taken = (title: string) => Boolean(getDb().prepare("SELECT 1 FROM notes WHERE folder = ? AND title = ?").get(folder, title));
  if (!taken(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base} (${n})`;
    if (!taken(candidate)) return candidate;
  }
  throw new MemoryError("Could not derive a free title; pass a title", 409, "ineligible_note");
}

/** Saves a fact as a wiki Note under the memory folder; with no memory folder it keeps writing the legacy observation row. */
export function saveFact(raw: unknown): FactReceipt {
  const parsed = factSaveSchema.safeParse(raw);
  if (!parsed.success || !parsed.data.content.trim()) throw new MemoryError("Invalid fact", 400, "invalid_input");
  const input = parsed.data;
  const configured = process.env.CHIBAKO_MEMORY_FOLDER;
  const area = configured ? normalizeFolder(configured) : "";
  if (!area) {
    const obs = saveObservation({ content: input.content, note_id: input.note_id, source: input.source });
    return { id: obs.id, note_id: obs.note_id, created_at: obs.created_at, saved: true };
  }
  const folder = memoryFolder(area, input.project);
  return getDb().transaction((): FactReceipt => {
    // Source is left out so a retry that only changes it is still the same fact.
    const requestId = `fact-${createHash("sha256").update(JSON.stringify([folder, input.content, input.note_id ?? null, input.title ?? null])).digest("hex")}`;
    const previous = getDb().prepare("SELECT note_id FROM memory_requests WHERE actor_id = ? AND request_id = ?").get(FACT_ACTOR, requestId) as { note_id: string } | undefined;
    const saved = previous && getNote(previous.note_id, true);
    if (saved) return { id: saved.id, note_id: input.note_id ?? null, created_at: saved.created_at, saved: true };
    // The owner purged the earlier Note: forget the stale receipt and save the fact again.
    if (previous) getDb().prepare("DELETE FROM memory_requests WHERE actor_id = ? AND request_id = ?").run(FACT_ACTOR, requestId);

    let content = input.content.trim();
    if (input.note_id) {
      const related = getNote(input.note_id);
      if (!related) throw new MemoryError("Related note not found", 404, "not_found");
      const target = `${related.folder ? `${related.folder}/` : ""}${related.title}`;
      // [, ] and | change how a Wikilink resolves, so such a target would link a different Note.
      if (/[[\]|]/.test(target)) throw new MemoryError("Related note cannot be linked: its title or folder contains [, ] or |", 400, "invalid_input");
      content += `\n\nRelated: [[${target}]]`;
    }
    if (input.source) content += `\nSource: ${input.source}`;
    // Fact content keeps the legacy 200k range (factSaveSchema); only the checkpoint 64k cap is relaxed.
    const write = factWriteSchema.safeParse({
      project: input.project, request_id: requestId, role: "wiki", subject: requestId, session_id: "fact",
      title: input.title ?? freeTitle(folder, deriveTitle(input.content)), content, expected_revision: null,
    });
    if (!write.success) throw new MemoryError("Invalid fact", 400, "invalid_input");
    const receipt = persist(FACT_ACTOR, folder, write.data);
    const note = getNote(receipt.note_id)!;
    return { id: note.id, note_id: input.note_id ?? null, created_at: note.created_at, saved: true };
  }).immediate();
}
