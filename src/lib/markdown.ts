export const WIKILINK_RE = /\[\[([^\[\]]+)\]\]/g;

// ---------- YAML frontmatter ----------
//
// Notes are plain Markdown; properties live in an Obsidian-style `---` fenced
// YAML block at the very top of the content. The block is the source of truth —
// everything else (FTS, preview, snippets, plaintext) works off the body.

export type PropValue = string | number | boolean | string[];
export type NoteProperties = Record<string, PropValue>;

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** Parse a leading `---` YAML block into props + body. No block -> empty props, content unchanged. */
export function parseFrontmatter(content: string): { props: NoteProperties; body: string } {
  const m = content.match(FRONTMATTER_RE);
  if (!m) return { props: {}, body: content };
  return { props: parseYamlSubset(m[1]), body: content.slice(m[0].length) };
}

/** Strip the frontmatter block, returning the Markdown body only. */
export function stripFrontmatter(content: string): string {
  const m = content.match(FRONTMATTER_RE);
  return m ? content.slice(m[0].length) : content;
}

/** Serialize props into a `---` block. Empty props produce no block. */
export function serializeFrontmatter(props: NoteProperties): string {
  const lines = serializeYamlSubset(props);
  return lines.length ? `---\n${lines.join("\n")}\n---\n` : "";
}

/** Merge a partial prop map into a note's content, returning the new content. `null` removes a key. */
export function applyFrontmatter(content: string, patch: Record<string, PropValue | null>): string {
  const { props, body } = parseFrontmatter(content);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete props[key];
    else props[key] = value;
  }
  return serializeFrontmatter(props) + body;
}

// -- minimal YAML subset (scalars, quoted strings, `- item` lists, comments) --

function parseYamlSubset(raw: string): NoteProperties {
  const props: NoteProperties = {};
  let currentKey: string | null = null;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const listItem = line.match(/^\s+-\s*(.*)$/);
    if (listItem && currentKey) {
      const item = unquote(listItem[1].trim());
      const current = props[currentKey];
      if (current === "") props[currentKey] = [item];
      else if (Array.isArray(current)) current.push(item);
      continue;
    }
    const kv = line.match(/^([^\s:#][^:]*?)\s*:\s*(.*)$/);
    if (!kv) continue;
    currentKey = kv[1].trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    if (!currentKey) { currentKey = null; continue; }
    const value = kv[2].trim();
    if (value === "") { props[currentKey] = ""; continue; } // may become a list
    props[currentKey] = coerceScalar(value);
  }
  return props;
}

function coerceScalar(value: string): PropValue {
  if (/^".*"$/s.test(value) || /^'.*'$/s.test(value)) return value.slice(1, -1);
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return "";
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

const unquote = (value: string): string =>
  /^".*"$/s.test(value) || /^'.*'$/s.test(value) ? value.slice(1, -1) : value;

function serializeYamlSubset(props: NoteProperties): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      lines.push(`${yamlKey(key)}:`);
      for (const item of value) lines.push(`  - ${yamlScalar(String(item))}`);
    } else if (typeof value === "object" && value !== null) {
      lines.push(`${yamlKey(key)}: ${yamlScalar(JSON.stringify(value))}`);
    } else if (typeof value === "boolean" || typeof value === "number") {
      lines.push(`${yamlKey(key)}: ${String(value)}`);
    } else {
      lines.push(`${yamlKey(key)}: ${yamlScalar(String(value))}`);
    }
  }
  return lines;
}

const yamlKey = (key: string): string =>
  /^[\w.$-]+$/.test(key) ? key : yamlQuote(key);

function yamlScalar(value: string): string {
  return yamlNeedsQuote(value) ? yamlQuote(value) : value;
}

function yamlNeedsQuote(value: string): boolean {
  if (value === "") return true;
  if (/^[\s]|[\s]$/.test(value)) return true;
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(value)) return true;
  if (/[:#]\s/.test(value) || /\s:#/.test(value)) return true;
  if (/^-?(\d+\.?\d*|\.\d+)$/i.test(value)) return true;
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(value)) return true;
  return false;
}

function yamlQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Split a [[target|alias]] token into { target, alias }. */
export function parseWikiToken(raw: string): { target: string; alias: string } {
  const [target, ...rest] = raw.split("|");
  const alias = rest.join("|");
  return { target: target.trim(), alias: alias.trim() };
}

/** Extract all wikilink targets from a markdown string (deduplicated, ordered). */
export function extractWikiLinks(content: string): string[] {
  const targets = new Set<string>();
  for (const m of content.matchAll(WIKILINK_RE)) {
    targets.add(parseWikiToken(m[1]).target);
  }
  return [...targets];
}

/** Resolve a wikilink to a note id by exact title match, else by title case-insensitive / path suffix. */
export function resolveWikiTarget(
  target: string,
  notes: Array<{ id: string; title: string; folder: string }>
): { id: string; title: string } | null {
  const exact = notes.find((n) => n.title === target);
  if (exact) return { id: exact.id, title: exact.title };
  const ci = notes.find((n) => n.title.toLowerCase() === target.toLowerCase());
  if (ci) return { id: ci.id, title: ci.title };
  const pathMatch = notes.find((n) => `${n.folder}/${n.title}` === target);
  if (pathMatch) return { id: pathMatch.id, title: pathMatch.title };
  return null;
}

/** Build a map from wikilink target string -> resolved note (or null). */
export function buildLinkResolver(
  notes: Array<{ id: string; title: string; folder: string }>
): (target: string) => { id: string; title: string } | null {
  const byTitle = new Map<string, string>();
  const byTitleCI = new Map<string, string>();
  const byPath = new Map<string, string>();
  for (const n of notes) {
    if (!byTitle.has(n.title)) byTitle.set(n.title, n.id);
    if (!byTitleCI.has(n.title.toLowerCase())) byTitleCI.set(n.title.toLowerCase(), n.id);
    byPath.set(`${n.folder}/${n.title}`, n.id);
  }
  return (target: string) => {
    const id = byTitle.get(target) ?? byTitleCI.get(target.toLowerCase()) ?? byPath.get(target);
    if (!id) return null;
    const n = notes.find((x) => x.id === id)!;
    return { id: n.id, title: n.title };
  };
}

/**
 * Replace wikilinks in content with a placeholder-safe tokenised form,
 * so remark-gfm won't mangle them. We swap each link for a zero-width safe
 * marker, render, then restore as HTML anchors afterwards in the component.
 */
export function tokenizeWikiLinks(content: string): {
  text: string;
  tokens: Array<{ marker: string; target: string; alias: string; resolved: { id: string; title: string } | null }>;
} {
  const tokens: Array<{ marker: string; target: string; alias: string; resolved: { id: string; title: string } | null }> = [];
  let out = content;
  let i = 0;
  for (const m of content.matchAll(WIKILINK_RE)) {
    const marker = `\u0000WIKI${i}\u0000`;
    tokens.push({ marker, ...parseWikiToken(m[1]), resolved: null });
    out = out.replace(m[0], marker);
    i++;
  }
  return { text: out, tokens };
}