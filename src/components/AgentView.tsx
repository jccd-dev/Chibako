"use client";

import { useEffect, useState } from "react";
import { IconCheck, IconCopy } from "@/components/icons";
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

const TOOL_GROUPS = [
  {
    label: "Find context",
    tools: [
      { name: "get_knowledge_schema", desc: "Read the vault's instructions for organizing and linking notes.", when: "starting a session (once)." },
      { name: "list_observations", desc: "List recent saved decisions and patterns.", when: "checking what earlier sessions learned." },
      { name: "list_notes", desc: "List note IDs, titles, folders, kinds, and non-empty properties; no note bodies.", when: "browsing or filtering the vault by folder, kind, or property." },
      { name: "search_notes", desc: "Search note titles and content; returns matches with snippets and supports property filters.", when: "a phrase or exact term should locate a note." },
      { name: "recall", desc: "Return BM25-ranked snippets within a token budget; also fuses vector similarity when embeddings are enabled.", when: "gathering relevant context across notes." },
      { name: "get_property_defs", desc: "Read the vault's typed property names, types, and allowed options.", when: "filtering or writing canonical property values." },
    ],
  },
  {
    label: "Read notes and inspect the vault",
    tools: [
      { name: "ingest_note", desc: "Return one note's full Markdown, links, backlinks, and the knowledge schema.", when: "you need full context for an identified note." },
      { name: "read_note", desc: "Read a note's full Markdown and metadata by ID or exact title.", when: "you need the note body alone; use ingest_note for links too." },
      { name: "get_links", desc: "List a note's outbound wikilinks and backlinks as titles and IDs.", when: "you need note relationships without reading its body." },
      { name: "get_graph", desc: "Return vault note nodes and resolved wikilink edges, with optional folder filtering.", when: "inspecting the vault's overall link structure." },
      { name: "get_stats", desc: "Summarize note counts by kind and folder, plus resolved and unresolved links.", when: "checking vault size and link health." },
      { name: "embedding_status", desc: "Show embedding provider and index health without starting indexing.", when: "diagnosing semantic recall setup or stale vectors." },
    ],
  },
  {
    label: "Write and recover",
    tools: [
      { name: "create_note", desc: "Create a Markdown note with optional title, folder, kind, and properties.", when: "the user asks to add a note." },
      { name: "update_note", desc: "Patch note fields; renaming a note also repoints its backlinks.", when: "the user asks to edit or move a note." },
      { name: "set_properties", desc: "Merge property values into a note's frontmatter; null removes a property.", when: "the user asks to change note metadata." },
      { name: "memory_save", desc: "Save a durable observation or decision, optionally linked to a note.", when: "the user asks you to remember a pattern or decision." },
      { name: "delete_observation", desc: "Remove an observation from the saved log by ID.", when: "the user asks to remove a specific saved observation." },
      { name: "delete_note", desc: "Move a note to Trash, where it can be restored for 30 days.", when: "the user explicitly confirms deletion." },
      { name: "restore_note", desc: "Restore a trashed note by ID.", when: "the user asks to recover a trashed note." },
      { name: "purge_note", desc: "Permanently delete a trashed note; this cannot be undone.", when: "the user explicitly confirms permanent deletion." },
    ],
  },
  {
    label: "Local maintenance",
    tools: [
      { name: "index_embeddings", desc: "Refresh the vector index in capped batches; local stdio only, with embeddings configured.", when: "the user requests an embedding backfill or refresh; repeat while results remain." },
    ],
  },
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
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <h1 className="text-xl font-semibold tracking-tight">Agent access</h1>
      <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-muted-foreground">
        Connect an MCP-capable agent to your vault with a scoped API key. Start with remote HTTPS, which works without giving the agent access to the Chibako data directory.
      </p>

      <section className="mt-7">
        <h2 className="text-sm font-semibold tracking-tight">Remote MCP over HTTPS</h2>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground marker:text-foreground">
          <li>
            In{" "}
            <a
              className="text-foreground underline underline-offset-2 decoration-border hover:text-primary transition-colors"
              href="/app/settings"
            >
              Settings
            </a>{" "}
            → API keys, create a read-only key with <code className="font-mono text-xs text-foreground">notes:read</code> and <code className="font-mono text-xs text-foreground">schema:read</code>. Add write scopes only when needed.
          </li>
          <li>Choose the config for your client and set the key as <code className="font-mono text-xs text-foreground">CHIBAKO_API_KEY</code>.</li>
        </ol>
        <div className="mt-3 space-y-3">
          <CodeBlock code={codexConfig} label="Codex config.toml" />
          <CodeBlock code={hermesConfig} label="Hermes config.yaml" />
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          The endpoint uses this app's origin at <code className="font-mono text-foreground">/mcp</code>. Keep the bearer token in environment or secret storage; never commit it or paste a literal value into remote config. Hermes can read <code className="font-mono">~/.hermes/.env</code>.
        </p>
      </section>

      <section className="mt-7">
        <h2 className="text-sm font-semibold tracking-tight">Local stdio</h2>
        <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-muted-foreground">
          Use this when the MCP client runs on the same machine as Chibako and can access its data directory. Pass a scoped API key and keep this config private: without a key, local stdio exposes all tools. A Docker path on your VPS is not available on your laptop.
        </p>
        <div className="mt-3">
          <CodeBlock code={localConfig} label="local mcpServers config" />
        </div>
      </section>

      <section className="mt-7">
        <h2 className="text-sm font-semibold tracking-tight">Recommended agent workflow</h2>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground marker:text-foreground">
          <li>Read <code className="font-mono text-xs text-foreground">get_knowledge_schema</code> once at the start of the session.</li>
          <li>Check <code className="font-mono text-xs text-foreground">list_observations</code>; use <code className="font-mono text-xs text-foreground">recall</code> for relevant context or <code className="font-mono text-xs text-foreground">search_notes</code> for literal terms.</li>
          <li>After finding a note, use <code className="font-mono text-xs text-foreground">ingest_note</code> when you need its full content, links, and schema.</li>
          <li>Use write or reindex tools only when the user asks; require explicit confirmation before deleting, especially permanent purge.</li>
        </ol>
      </section>

      <section className="mt-7">
        <h2 className="text-sm font-semibold tracking-tight">MCP tools</h2>
        <div className="mt-3 space-y-5">
          {TOOL_GROUPS.map((group) => (
            <section key={group.label}>
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{group.label}</h3>
              <ul className="divide-y divide-border rounded-lg border border-border bg-card px-3 sm:px-4">
                {group.tools.map((tool) => (
                  <li key={tool.name} className="grid gap-x-4 gap-y-1 py-2.5 sm:grid-cols-[9rem_minmax(0,1fr)]">
                    <code className="break-all font-mono text-[13px] font-medium text-foreground sm:break-normal">{tool.name}</code>
                    <div className="text-sm leading-relaxed text-muted-foreground">
                      <p>{tool.desc}</p>
                      <p><span className="font-medium text-foreground">Use when:</span> {tool.when}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <p className="mt-3 max-w-prose text-xs leading-relaxed text-muted-foreground">
          Tools appear according to key scopes. <code className="font-mono">notes:read</code> covers note reads and search; <code className="font-mono">search:read</code> allows search without full note access. <code className="font-mono">notes:write</code> allows changes, and <code className="font-mono">notes:purge</code> allows permanent deletion. <code className="font-mono">index_embeddings</code> is local-only and requires configured embeddings plus <code className="font-mono">notes:write</code> or <code className="font-mono">schema:write</code>.
        </p>
      </section>

      <section className="mt-7 pb-8">
        <h2 className="text-sm font-semibold tracking-tight">Plain REST (optional)</h2>
        <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-muted-foreground">
          Use the HTTP API directly with the same bearer-token authentication.
        </p>
        <div className="mt-3 space-y-3">
          <CodeBlock code={readExample} label="read notes" />
          <CodeBlock code={createExample} label="create note" />
        </div>
      </section>
    </div>
  );
}
