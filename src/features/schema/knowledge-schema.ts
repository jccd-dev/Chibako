import { getDb } from "../../lib/db";

export const DEFAULT_KNOWLEDGE_SCHEMA = `# Chibako Vault Schema (AGENTS.md)

You are an agent working inside the owner's personal knowledge vault.

## What this vault is for
A private, Obsidian-style second brain. Markdown notes connected by [[wikilinks]].
It holds personal notes, guides, project notes, meeting notes, and a growing
compiled wiki layer that is AI-authored.

## Three layers (raw -> wiki -> output)
Every note belongs to one layer, recorded in the "layer" property:
- raw: the owner's unprocessed input — thoughts, clippings, pasted text, meeting
  notes. Read it, quote it, link it. Do not rewrite a raw note's body unless the
  owner asks; capture and compile instead.
- wiki: the compiled layer you own. One note per entity, concept, or topic, with
  summaries and cross-references — the single source of truth for a subject.
  When new information lands, update the existing wiki page instead of adding a
  duplicate.
- output: answers, reports, and summaries produced on request. Save only the
  ones that would be painful to re-derive, and link them to their wiki sources.

## Conventions
- Notes are plain Markdown stored in a SQLite database.
- Link related notes with [[Note Title]] on first mention.
- Backlinks are computed automatically — never write them by hand.
- Titles are unique and stable; renaming a title re-points backlinks.
- Use folders loosely for broad areas; titles and links carry the structure.
- One idea per note, and every note should link to at least one other note.

## Properties
- Check the property dictionary first (get_property_defs / GET /api/properties)
  and reuse its names and values — consistency beats inventing new keys.
- layer (raw/wiki/output): which layer the note belongs to, as described above.
- type (entity/concept/comparison/query/summary/guide): what the note is.
- status (draft/active/done/archived), category, tags (a list).
- Tags are lowercase, hyphenated, and reused. Tags mark cross-cutting themes,
  not topics; prefer an existing tag over inventing a near-duplicate.
- Set properties with update_note/set_properties ({"properties": {...}}); pass
  null as a value to remove a key. Filter with prop_key/prop_value on
  list_notes and search_notes, or ?prop.<key>=<value> on the REST API.

## How to answer questions
- Read the note the user asks about, then follow [[links]] and backlinks.
- If a question is a recurring one, answer from compiled wiki notes when they
  exist instead of re-reading raw sources every time.
- When you find a fact repeated in multiple notes, prefer a wiki page as the
  single source of truth and link the raw notes to it.

## Compile loop (when the owner hands you sources)
1. Read the raw source and search for existing pages about the same entities.
2. Create or update one wiki note per entity/concept, and link the raw note to it.
3. Keep one source of truth per subject — link, do not duplicate.
4. Save a valuable answer as an output note; leave trivial lookups unfiled.

## Contradictions
If two notes contradict each other, do not silently pick one:
1. Note the contradiction in your reply.
2. Prefer the newer note unless a wiki page exists, in which case prefer it.
3. Offer to update the wiki page to reflect the resolved truth.

## Scope & safety
- Never reveal or repeat secrets (API keys, credentials) in replies.
- You may create notes when asked, but never delete notes without confirmation.
- This is a single vault today. Multi-vault support is planned; keep the three
  layers self-contained so the structure stays portable across vaults.
`;

/** Human-facing companion to the schema, seeded as a note so the system is discoverable in-app. */
export const ORGANIZE_GUIDE_MARKDOWN = [
  "# How to organize notes",
  "",
  "A simple three-layer system. Dump freely into **raw**, let the agent compile **wiki**, keep answers in **output**.",
  "",
  "## The three layers",
  "",
  "Set the `layer` property on every note: `raw`, `wiki`, or `output`.",
  "",
  "- **raw** — dump anything here: quick thoughts, clippings, pasted text, meeting notes, half-formed ideas. No structure required. The agent reads raw but does not rewrite it.",
  "- **wiki** — the agent's organized layer. One note per entity, concept, or topic, with summaries and cross-references. This is the single source of truth for a subject. Raw notes link up into these.",
  "- **output** — answers and reports (query results, comparisons, outlines). Keep one only if re-deriving it would be painful.",
  "",
  "## Rules",
  "",
  "1. **Title is identity.** Link with `[[Note Title]]` on first mention. Renaming a title re-points backlinks automatically.",
  "2. **One idea per note.** Small and linked beats long and isolated.",
  "3. **Link outward.** Every note should link to at least one other note.",
  "4. **Folders are optional.** Use them for broad areas (projects, clients), not as a filing system.",
  "5. **Don't duplicate.** If a fact lives in a wiki note, link to it instead of repeating it.",
  "6. **Tag sparingly.** Lowercase, hyphenated, and reuse existing tags. Tags mark cross-cutting themes, not topics.",
  "",
  "## Properties",
  "",
  "- `layer` — raw | wiki | output",
  "- `type` — entity | concept | comparison | query | summary | guide",
  "- `status` — draft | active | done | archived",
  "- `tags` — cross-cutting themes (a list)",
  "",
  "## Workflow",
  "",
  "1. **Capture** — write or paste into a `raw` note. Don't organize yet.",
  "2. **Compile** — ask the agent to compile raw notes into `wiki` pages. It checks for existing pages first, updates them, and links the raw sources.",
  "3. **Ask** — ask a question. The agent answers from wiki pages and files valuable answers under `output`.",
  "",
  "## Contradictions",
  "",
  "When two notes disagree: note the conflict, prefer the wiki page, then update the wiki page to the resolved truth.",
  "",
  "> Chibako is a single vault today. Multi-vault support (vault 1, vault 2, …) is planned; keep the same three-layer structure inside each vault when it lands.",
].join("\n");

const KNOWLEDGE_SCHEMA_KEY = "knowledge_schema";

export function getKnowledgeSchema(): string {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(KNOWLEDGE_SCHEMA_KEY) as { value: string } | undefined;
  return row?.value ?? DEFAULT_KNOWLEDGE_SCHEMA;
}

export function setKnowledgeSchema(schema: string): void {
  getDb()
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(KNOWLEDGE_SCHEMA_KEY, schema);
}
