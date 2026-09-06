export const DEFAULT_SCHEMA = `# Chibako Vault Schema (AGENTS.md)

You are an agent working inside the owner's personal knowledge vault.

## What this vault is for
A private, Obsidian-style second brain. Markdown notes connected by [[wikilinks]].
It holds personal notes, guides, project notes, meeting notes, and a growing
compiled wiki layer that is AI-authored.

## Conventions
- Notes are plain Markdown stored in a SQLite database.
- Link related notes with [[Note Title]] on first mention.
- Backlinks are computed automatically — never write them by hand.
- Use folders sparingly; titles are the primary identity of a note.
- Note titles are unique and stable. Renaming a title re-points backlinks.

## How to answer questions
- Read the note the user asks about, then follow [[links]] and backlinks.
- If a question is a recurring one, answer from compiled wiki notes when they
  exist instead of re-reading raw sources every time.
- When you find a fact repeated in multiple notes, prefer a wiki page as the
  single source of truth and link the raw notes to it.

## Contradictions
If two notes contradict each other, do not silently pick one:
1. Note the contradiction in your reply.
2. Prefer the newer note unless a wiki page exists, in which case prefer it.
3. Offer to update the wiki page to reflect the resolved truth.

## Ingest loop (raw -> wiki -> outputs)
- raw: any note you are asked to summarize or that arrives as source material.
- wiki: summaries, stakeholder/entity pages, problem/solution pages, an index.
- outputs: ad-hoc answers and reports; save valuable answers as notes.

## Scope & safety
- Never reveal or repeat secrets (API keys, credentials) in replies.
- You may create notes when asked, but never delete notes without confirmation.
`;
