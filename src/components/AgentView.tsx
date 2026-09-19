"use client";

import { useEffect, useState } from "react";
import { IconCheck, IconCopy, IconExternal } from "@/components/icons";
import { Button } from "@/components/ui/button";

function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-xl border border-border bg-sidebar p-4 pr-16 font-mono text-[12.5px] leading-relaxed">{code}</pre>
      <Button
        variant="ghost"
        size="icon-sm"
        className="absolute right-2 top-2"
        aria-label="Copy to clipboard"
        onClick={() => {
          navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
      </Button>
      {label && <span className="absolute left-4 top-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>}
    </div>
  );
}

const TOOLS: Array<{ name: string; desc: string }> = [
  { name: "list_notes", desc: "All notes (titles + folders only — tiny payload)" },
  { name: "search_notes", desc: "Full-text search, returns snippets" },
  { name: "recall", desc: "Token-budgeted semantic and keyword context" },
  { name: "read_note", desc: "Raw markdown of a note by id or title" },
  { name: "get_links", desc: "Outlinks + backlinks for one note" },
  { name: "create_note", desc: "Create a note (content, folder, kind)" },
  { name: "update_note", desc: "Patch title/content/folder/kind; backlinks re-point automatically" },
  { name: "memory_save", desc: "Save a durable observation when write access is granted" },
  { name: "list_observations", desc: "Recent saved decisions and patterns" },
  { name: "get_graph", desc: "Nodes + edges for the whole vault" },
  { name: "embedding_status", desc: "Recall index health without triggering paid indexing" },
  { name: "get_knowledge_schema", desc: "The AGENTS.md brain instructions" },
  { name: "ingest_note", desc: "Compact read: note + links + schema in one token-efficient call" },
];

export function AgentView() {
  const [origin, setOrigin] = useState("https://your-domain.com");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const codexConfig = `[mcp_servers.chibako]
url = "${origin}/mcp"
bearer_token_env_var = "CHIBAKO_API_KEY"`;

  const hermesConfig = `mcp_servers:
  chibako:
    url: "${origin}/mcp"
    headers:
      Authorization: "Bearer \${CHIBAKO_API_KEY}"`;

  const localConfig = `{
  "mcpServers": {
    "chibako": {
      "command": "node",
      "args": ["/path/to/chibako/dist/mcp/server.mjs"],
      "env": {
        "CHIBAKO_DATA_DIR": "/path/to/chibako/data",
        "CHIBAKO_API_KEY": "ck_..."
      }
    }
  }
}`;

  const readExample = `curl ${origin}/api/notes \\
  -H "Authorization: Bearer $CHIBAKO_API_KEY"`;

  const createExample = `curl ${origin}/api/notes \\
  -X POST -H "Authorization: Bearer $CHIBAKO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"Meeting — Acme 2026-09-07","folder":"Clients/Acme","content":"# Meeting\\n- Decided: ship [[v2 plan]] by Friday\\n- [[Acme]] wants usage reporting"}'`;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-xl font-semibold tracking-tight">Agent access</h1>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
        Point Hermes, Claude, or any MCP-capable agent at your vault. Everything an agent can do is scoped to the API key you grant it — no admin session needed.
      </p>

      <section className="mt-10">
        <h2 className="text-sm font-semibold tracking-tight">Remote MCP</h2>
        <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-muted-foreground">
          Create a read-only key first, export it as <code className="font-mono text-xs text-foreground">CHIBAKO_API_KEY</code>, then point your agent at this HTTPS endpoint. Add write or purge scopes only when the agent needs them.
        </p>
        <div className="mt-3 space-y-3">
          <CodeBlock code={codexConfig} label="Codex config.toml" />
          <CodeBlock code={hermesConfig} label="Hermes config.yaml" />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Hermes resolves the variable from its environment or <code className="font-mono">~/.hermes/.env</code>. Inline bearer headers work as a fallback, but can leak through checked-in config or shell history.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold tracking-tight">Advanced: local stdio</h2>
        <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-muted-foreground">
          Use this only when the MCP client runs on the same machine and can access the Chibako data directory. A Docker path on your VPS does not exist on your laptop.
        </p>
        <div className="mt-3">
          <CodeBlock code={localConfig} label="local mcpServers config" />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold tracking-tight">Tools the agent gets</h2>
        <ul className="mt-3 space-y-2">
          {TOOLS.map((t) => (
            <li key={t.name} className="rounded-lg border border-border bg-card px-4 py-3">
              <code className="font-mono text-[13px] font-medium text-foreground">{t.name}</code>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t.desc}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold tracking-tight">Plain REST (no MCP needed)</h2>
        <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-muted-foreground">
          The same operations as HTTP endpoints, bearer-token auth.
        </p>
        <div className="mt-3 space-y-3">
          <CodeBlock code={readExample} label="read notes" />
          <CodeBlock code={createExample} label="create note" />
        </div>
      </section>

      <section className="mt-10 rounded-xl border border-border bg-card p-5">
        <p className="text-sm font-medium">Token efficiency, by design</p>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
          Notes are stored as plain Markdown — no JSON block trees, no metadata bloat.{" "}
          <code className="font-mono text-xs text-foreground">list_notes</code> and{" "}
          <code className="font-mono text-xs text-foreground">get_links</code> return titles/links only, and{" "}
          <code className="font-mono text-xs text-foreground">ingest_note</code> bundles note + links + schema
          into one call so your agent burns fewer tokens to load context. See the{" "}
          <a
            className="inline-flex items-center gap-1 text-foreground underline underline-offset-2 decoration-border hover:text-primary transition-colors"
            href="/app/settings"
            onClick={(e) => {
              e.preventDefault();
              window.location.href = "/app/settings";
            }}
          >
            knowledge schema <IconExternal size={12} />
          </a>{" "}
          to teach your agent the ingestion loop.
        </p>
      </section>
    </div>
  );
}
