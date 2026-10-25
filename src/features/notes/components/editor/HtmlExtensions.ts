"use client";

import { Node, type JSONContent, type MarkdownParseHelpers, type MarkdownRendererHelpers, type MarkdownToken, type MarkdownLexerConfiguration } from "@tiptap/core";
import Highlight from "@tiptap/extension-highlight";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import Underline from "@tiptap/extension-underline";

// Raw HTML is kept as opaque source: shown as text, saved back byte-for-byte,
// never parsed into the page. The Preview pane renders it through rehype-sanitize.

const INLINE_HTML_RE = /^(?:<!--[\s\S]*?-->|<\/?[a-zA-Z][\w-]*(?:\s[^<>]*)?\/?>|<![a-zA-Z][^<>]*>|<\?[^<>]*>)/;
// Bare formatting tags around tag-free text become real marks; anything richer
// (attributes, nested tags) stays raw so nothing is lost.
const FORMAT_TAG_RE = /^<(u|mark|sub|sup)>([^<\n]+)<\/\1>/;

function htmlAttr(node: JSONContent): string {
  return String(node.attrs?.html ?? "");
}

export const RawHtmlInline = Node.create({
  name: "rawHtmlInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return { html: { default: "" } };
  },

  parseHTML() {
    return [{ tag: "span[data-raw-html]", getAttrs: (dom) => ({ html: (dom as HTMLElement).getAttribute("data-raw-html") ?? "" }) }];
  },

  renderHTML({ node }) {
    const html = String(node.attrs.html);
    return ["span", { "data-raw-html": html, class: "raw-html", title: "Raw HTML (double-click to edit)" }, html];
  },

  markdownTokenizer: {
    name: "rawHtmlInline",
    level: "inline" as const,
    start: (src: string) => src.indexOf("<"),
    tokenize: (src: string): MarkdownToken | undefined => {
      if (FORMAT_TAG_RE.test(src)) return undefined;
      const match = src.match(INLINE_HTML_RE);
      if (!match) return undefined;
      return { type: "rawHtmlInline", raw: match[0], text: match[0] } as MarkdownToken;
    },
  },

  parseMarkdown(token: MarkdownToken) {
    return { type: "rawHtmlInline", attrs: { html: token.raw ?? "" } };
  },

  renderMarkdown: htmlAttr,
});

export const RawHtmlBlock = Node.create({
  name: "rawHtmlBlock",
  group: "block",
  atom: true,
  selectable: true,

  addAttributes() {
    return { html: { default: "" } };
  },

  parseHTML() {
    return [{ tag: "div[data-raw-html]", getAttrs: (dom) => ({ html: (dom as HTMLElement).getAttribute("data-raw-html") ?? "" }) }];
  },

  renderHTML({ node }) {
    const html = String(node.attrs.html);
    return ["div", { "data-raw-html": html, class: "raw-html raw-html-block", title: "Raw HTML (edit in the source view)" }, html];
  },

  // marked emits block-level HTML as "html" tokens; inline ones never reach here.
  markdownTokenName: "html",

  parseMarkdown(token: MarkdownToken) {
    return { type: "rawHtmlBlock", attrs: { html: (token.raw ?? "").replace(/\s+$/, "") } };
  },

  renderMarkdown: htmlAttr,
});

// Read and save formatting marks as the HTML the Preview renders. Replacing the
// tokenizer also leaves `==x==` / `++x++` as plain text instead of rewriting it.
function htmlMark(tag: string, mark: string) {
  return {
    markdownTokenizer: {
      name: mark,
      level: "inline" as const,
      start: (src: string) => src.indexOf(`<${tag}>`),
      tokenize: (src: string, _tokens: MarkdownToken[], helpers: MarkdownLexerConfiguration): MarkdownToken | undefined => {
        const match = src.match(FORMAT_TAG_RE);
        if (match?.[1] !== tag) return undefined;
        return { type: mark, raw: match[0], text: match[2], tokens: helpers.inlineTokens(match[2]) } as MarkdownToken;
      },
    },
    parseMarkdown: (token: MarkdownToken, h: MarkdownParseHelpers) => h.applyMark(mark, h.parseInline(token.tokens ?? [])),
    renderMarkdown: (node: JSONContent, h: MarkdownRendererHelpers) => `<${tag}>${h.renderChildren(node)}</${tag}>`,
  };
}

export const htmlFormattingExtensions = [
  Underline.extend(htmlMark("u", "underline")),
  Highlight.extend(htmlMark("mark", "highlight")),
  Subscript.extend(htmlMark("sub", "subscript")),
  Superscript.extend(htmlMark("sup", "superscript")),
];
