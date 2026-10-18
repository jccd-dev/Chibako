"use client";

import { useMemo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { defaultSchema } from "rehype-sanitize";
import { WIKILINK_RE, stripFrontmatter } from "@/lib/markdown";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Convert [[target|alias]] into a safe <span class="wiki-link"> element. */
function preprocess(content: string): string {
  return content.replace(WIKILINK_RE, (full, inner) => {
    const [target, ...rest] = inner.split("|");
    const alias = rest.join("|").trim() || target.trim();
    const cleanTarget = esc(target.trim());
    return `<span class="wiki-link" data-wiki-target="${cleanTarget}">${esc(alias)}</span>`;
  });
}

const baseAttributes = defaultSchema.attributes ?? {};
const baseTagNames = defaultSchema.tagNames ?? [];
const baseStar = Array.isArray(baseAttributes["*"]) ? (baseAttributes["*"] as Array<string | string[]>) : [];
const schema = {
  ...defaultSchema,
  tagNames: [...baseTagNames, "span"],
  attributes: {
    ...baseAttributes,
    "*": [...baseStar, "className"],
    span: [["className"], ["dataWikiTarget"]],
    input: ["type", "checked", "disabled"],
  },
};

interface MarkdownPreviewProps {
  content: string;
  onNavigate: (target: string) => void;
  className?: string;
}

export function MarkdownPreview({ content, onNavigate, className }: MarkdownPreviewProps) {
  // Frontmatter is metadata, not prose — never render it in reading view.
  const processed = useMemo(() => preprocess(stripFrontmatter(content)), [content]);

  const components = useMemo(
    () => ({
      a: ({ href, children }: { href?: string; children?: ReactNode }) => (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      ),
    }),
    []
  );

  function handleClick(e: React.MouseEvent) {
    const el = (e.target as HTMLElement).closest?.(".wiki-link");
    if (!el) return;
    const target = el.getAttribute("data-wiki-target");
    if (target) onNavigate(target);
  }

  return (
    <div className={`md ${className ?? ""}`} onClick={handleClick}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeRaw], [rehypeSanitize, schema]]} components={components}>
        {processed}
      </ReactMarkdown>
    </div>
  );
}