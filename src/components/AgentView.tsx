"use client";

import { useEffect, useState } from "react";
import { IconCheck, IconCopy, IconExternal } from "@/components/icons";

function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-xl border border-border bg-sidebar p-4 pr-16 font-mono text-[12.5px] leading-relaxed">{code}</pre>
      <button
        className="btn absolute right-2 top-2 !px-2 !py-1 text-xs"
        onClick={() => {
          navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
      </button>
      {label && <span className="absolute left-4 top-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>}
    </div>
  );
}

const TOOLS: Array<{ name: string; desc: string }> = [
  { name: "list_notes", desc: "All notes (titles + folders only — tiny payload)" },
  { name: "search_notes", desc: "Full-text search, returns snippets" },
  { name: "read_note", desc: "Raw markdown of a note by id or title" },
  { name: "get_links", desc: "Outlinks + backlinks for one note" },
  { name: "create_note", desc: "Create a note (content, folder, kind)" },
  { name: "update_note", desc: "Patch title/content/folder/kind; backlinks re-point automatically" },
  { name: "get_graph", desc: "Nodes + edges for the whole vault" },
  { name: "get_knowledge_schema", desc: "The AGENTS.md brain instructions" },
  { name: "ingest_note", desc: "Compact read: note + links + schema in one token-efficient call" },
];

export function AgentView() {
  const [origin, setOrigin] = useState("https://your-domain.com");
  const [token, setToken] = useState("ck_…");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const mcpConfig = JSON.stringify(
    {
      mcpServers: {
        chibako: {
          command: "node",
          args: ["/opt/chibako/dist/mcp/server.js"],
          env: {
            CHIBAKO_DATA_DIR: "/opt/chibako/data",
            CHIBAKO_API_KEY: token,
          },
        },
      },
    },
    null,
    2
  );

  const readExample = `curl ${origin}/api/notes \\
  -H "Authorization: Bearer ${token}"`;

  const createExample = `curl ${origin}/api/notes \\
  -X POST -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"Meeting — Acme 2026-09-07","folder":"Clients/Acme","content":"# Meeting\\n- Decided: ship [[v2 plan]] by Friday\\n- [[Acme]] wants usage reporting"}'`;

  return (
    <div className="mx-auto max-w-3xl overflow-y-auto px-6 py-6">
      <h1 className="text-xl font-semibold tracking-tight">Agent access</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Point Hermes, Claude, or any MCP-capable agent at your vault. Everything an agent can do is scoped to the API key you grant it — no admin session needed.
      </p>

      <h2 className="mt-6 text-sm font-semibold">MCP server</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Add this to your MCP client config (Claude Desktop, Cursor, etc.). The server reads the same SQLite vault directly and speaks the agent's key.
      </p>
      <div className="mt-2">
        <CodeBlock code={mcpConfig} label="mcpServers config" />
      </div>

      <h2 className="mt-6 text-sm font-semibold">Tools the agent gets</h2>
      <ul className="mt-2 space-y-1.5">
        {TOOLS.map((t) => (
          <li key={t.name} className="card !py-2">
            <code className="font-mono text-[13px] font-medium text-primary">{t.name}</code>
            <p className="mt-0.5 text-sm text-muted-foreground">{t.desc}</p>
          </li>
        ))}
      </ul>

      <h2 className="mt-6 text-sm font-semibold">Plain REST (no MCP needed)</h2>
      <p className="mt-1 text-sm text-muted-foreground">The same operations as HTTP endpoints, bearer-token auth.</p>
      <div className="mt-2 space-y-3">
        <CodeBlock code={readExample} label="read notes" />
        <CodeBlock code={createExample} label="create note" />
      </div>

      <div className="mt-6 rounded-xl border border-primary/40 bg-primary/6 p-4 text-sm">
        <p className="font-medium">Token efficiency, by design</p>
        <p className="mt-1 text-muted-foreground">
          Notes are stored as plain Markdown — no JSON block trees, no metadata bloat. <code className="font-mono text-xs">list_notes</code> and <code className="font-mono text-xs">get_links</code> return titles/links only, and <code className="font-mono text-xs">ingest_note</code> bundles note + links + schema into one call so your agent burns fewer tokens to load context. See the <a className="inline-flex items-center gap-1 text-primary" href="/app/settings" onClick={(e) => { e.preventDefault(); window.location.href = "/app/settings"; }}>
            knowledge schema <IconExternal size={12} />
          </a> to teach your agent the ingestion loop.
        </p>
      </div>
    </div>
  );
}