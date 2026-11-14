/** A parsed search box query. Client-safe: no database imports. */
export interface SearchQuery {
  text: string;
  /** Limit to this folder and its subfolders. */
  folder?: string;
  /** Match note titles only. */
  titleOnly: boolean;
}

// `name:"quoted value"`, `name:value`, or any other whitespace-free token.
const TOKEN = /([A-Za-z]+):"([^"]*)"|([A-Za-z]+):(\S*)|\S+/g;

/**
 * `note:` searches titles only and `folder:` scopes to a folder; quotes allow
 * spaces and qualifiers combine. Unknown or empty qualifiers stay plain text.
 */
export function parseSearchQuery(input: string): SearchQuery {
  const words: string[] = [];
  let folder: string | undefined;
  let titleOnly = false;
  for (const match of input.matchAll(TOKEN)) {
    const name = (match[1] ?? match[3])?.toLowerCase();
    const value = (match[2] ?? match[4] ?? "").trim();
    if (name === "folder" && value.replace(/^\/+|\/+$/g, "")) folder = value.replace(/^\/+|\/+$/g, "");
    else if (name === "note" && value) { titleOnly = true; words.push(value); }
    else words.push(match[0]);
  }
  return { text: words.join(" "), ...(folder ? { folder } : {}), titleOnly };
}

/** The `folder:` qualifier for a path, quoted when it has spaces. */
export function folderQualifier(path: string): string {
  // shortcut: a path with both spaces and `"` cannot be quoted; add escapes if such folders appear.
  return /\s/.test(path) ? `folder:"${path}"` : `folder:${path}`;
}
