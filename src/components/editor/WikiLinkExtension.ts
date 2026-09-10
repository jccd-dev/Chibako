"use client";

import { mergeAttributes, Node, type JSONContent, type MarkdownParseHelpers, type MarkdownRendererHelpers, type MarkdownToken, type RenderContext } from "@tiptap/core";

export const WIKILINK_TOKEN_NAME = "wikilink";
const WIKILINK_NODE_NAME = "wikilink";

const WIKILINK_PATTERN = /^\[\[([^\[\]\n]+?)\]\]/;

export const WikiLink = Node.create({
  name: WIKILINK_NODE_NAME,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      target: { default: null },
      alias: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-wiki-target]",
        getAttrs: (dom) => {
          const el = dom as HTMLElement;
          return { target: el.getAttribute("data-wiki-target"), alias: el.getAttribute("data-wiki-alias") };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const { target, alias } = HTMLAttributes as { target?: string; alias?: string | null };
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        class: "wiki-link",
        "data-wiki-target": target ?? "",
        "data-wiki-alias": alias ?? "",
      }),
      alias ?? target ?? "",
    ];
  },

  // --- bidirectional markdown: [[target]] / [[target|alias]] ---
  markdownTokenizer: {
    name: WIKILINK_TOKEN_NAME,
    level: "inline" as const,
    start: (src: string) => src.match(WIKILINK_PATTERN)?.index ?? -1,
    tokenize: (src: string): MarkdownToken | undefined => {
      const match = src.match(WIKILINK_PATTERN);
      if (!match) return undefined;
      const [targetPart, ...rest] = match[1].split("|");
      return {
        type: WIKILINK_TOKEN_NAME,
        raw: match[0],
        text: match[0],
        target: targetPart.trim(),
        alias: rest.join("|").trim() || null,
      } as MarkdownToken;
    },
  },

  parseMarkdown(token: MarkdownToken, helpers: MarkdownParseHelpers) {
    return {
      type: WIKILINK_NODE_NAME,
      attrs: { target: token.target ?? "", alias: token.alias ?? null },
    };
  },

  renderMarkdown(node: JSONContent, helpers: MarkdownRendererHelpers, ctx: RenderContext) {
    const attrs = (node.attrs ?? {}) as { target?: string; alias?: string | null };
    const target = attrs.target ?? "";
    return attrs.alias ? `[[${target}|${attrs.alias}]]` : `[[${target}]]`;
  },
});
