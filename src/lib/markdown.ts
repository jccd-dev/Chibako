export const WIKILINK_RE = /\[\[([^\[\]]+)\]\]/g;

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