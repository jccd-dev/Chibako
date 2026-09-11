"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { IconCheck, IconKey, IconTrash, IconX } from "@/components/icons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { IconPlus } from "@/components/icons";
import type { PropertyDef, PropertyType } from "@/lib/property-types";
import { PROPERTY_TYPES } from "@/lib/property-types";

const ALL_SCOPES = [
  "notes:read",
  "notes:write",
  "search:read",
  "schema:read",
  "schema:write",
  "keys:read",
  "keys:write",
];

interface ApiKey {
  id: string;
  name: string;
  scopes: string[];
  created_at: number;
  last_used_at: number | null;
}

interface EmbeddingStatus {
  enabled: boolean;
  provider: string;
  model: string;
  dim: number;
  input_version: number;
  indexed: number;
  stale: number;
  total: number;
  rows: number;
  last_error: string | null;
  last_indexed_at: number | null;
}

export function SettingsView() {
  const router = useRouter();
  const [tab, setTab] = useState<"schema" | "properties" | "keys" | "recall" | "password">("schema");
  const [schema, setSchema] = useState("");
  const [schemaSaved, setSchemaSaved] = useState(false);
  const [propDefs, setPropDefs] = useState<PropertyDef[]>([]);
  const [propsSaved, setPropsSaved] = useState(false);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyScopes, setNewKeyScopes] = useState<string[]>(["notes:read", "search:read", "schema:read"]);
  const [revealed, setRevealed] = useState<{ name: string; key: string } | null>(null);
  const [pw, setPw] = useState({ current: "", next: "" });
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [restoreConfirm, setRestoreConfirm] = useState(false);
  const [embStatus, setEmbStatus] = useState<EmbeddingStatus | null>(null);
  const [reindexing, setReindexing] = useState(false);

  useEffect(() => {
    if (tab === "recall" && !embStatus) void loadEmbeddings();
  }, [tab, embStatus]);

  useEffect(() => {
    fetch("/api/schema").then((r) => r.json()).then((d) => setSchema(d.schema)).catch(() => {});
    fetch("/api/properties").then((r) => r.json()).then((d) => setPropDefs(d.properties ?? [])).catch(() => {});
    loadKeys();
  }, []);

  function updatePropDef(index: number, patch: Partial<PropertyDef>) {
    setPropDefs((defs) => defs.map((d, i) => {
      const next = i === index ? { ...d, ...patch } : d;
      if (next.type !== "select") delete next.options;
      return next;
    }));
  }

  function addPropDef() {
    setPropDefs((defs) => {
      let name = "property";
      for (let i = 2; defs.some((d) => d.name === name); i++) name = `property${i}`;
      return [...defs, { name, type: "string" as PropertyType }];
    });
  }

  async function savePropDefs() {
    const res = await fetch("/api/properties", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ properties: propDefs }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setPropDefs(data.properties ?? propDefs);
      setPropsSaved(true);
      setTimeout(() => setPropsSaved(false), 2000);
    } else {
      toast.error(data.error || "Could not save properties.");
    }
  }

  async function loadKeys() {
    const res = await fetch("/api/keys");
    if (res.ok) setKeys((await res.json()).keys);
  }

  async function loadEmbeddings() {
    const res = await fetch("/api/embeddings");
    if (res.ok) setEmbStatus((await res.json()).status as EmbeddingStatus);
  }

  async function runReindex() {
    setReindexing(true);
    try {
      let remaining = Infinity;
      let guard = 0;
      while (remaining > 0 && guard++ < 50) {
        const res = await fetch("/api/embeddings/reindex", { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(data.error || "Reindex failed.");
          return;
        }
        remaining = data.remaining ?? 0;
        if (data.status) setEmbStatus(data.status as EmbeddingStatus);
      }
      await loadEmbeddings();
      toast.success("Reindex complete.");
    } finally {
      setReindexing(false);
    }
  }

  async function saveSchema() {
    const res = await fetch("/api/schema", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schema }),
    });
    if (res.ok) {
      setSchemaSaved(true);
      setTimeout(() => setSchemaSaved(false), 2000);
    }
  }

  async function restoreDefaultSchema() {
    setRestoreConfirm(false);
    const res = await fetch("/api/schema/default");
    if (res.ok) {
      const data = await res.json();
      setSchema(data.schema);
      toast("Default restored — press Save schema to apply.");
    }
  }
  async function createKey() {
    if (!newKeyName.trim()) {
      toast.error("Name your key first", { description: "e.g. Hermes, Claude, Cursor." });
      return;
    }
    const res = await fetch("/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newKeyName.trim(), scopes: newKeyScopes }),
    });
    if (res.ok) {
      const { name, key } = await res.json();
      setRevealed({ name, key });
      setNewKeyName("");
      await loadKeys();
    }
  }

  async function revoke() {
    if (!revokeTarget) return;
    await fetch(`/api/keys/${revokeTarget}`, { method: "DELETE" });
    setRevokeTarget(null);
    await loadKeys();
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    const res = await fetch("/api/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pw),
    });
    const data = await res.json();
    setPwMsg({ ok: res.ok, text: data.error ?? "Password updated." });
    if (res.ok) setPw({ current: "", next: "" });
  }

  return (
    <div className="mx-auto max-w-3xl overflow-y-auto px-6 py-6">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="mt-4">
        <TabsList className="w-full">
          <TabsTrigger value="schema">Knowledge schema (AGENTS.md)</TabsTrigger>
          <TabsTrigger value="properties">Properties</TabsTrigger>
          <TabsTrigger value="keys">API keys</TabsTrigger>
          <TabsTrigger value="recall">Recall</TabsTrigger>
          <TabsTrigger value="password">Password</TabsTrigger>
        </TabsList>

        <TabsContent value="schema" className="fade-in">
          <div className="flex flex-col gap-3 pt-3">
            <p className="text-sm text-muted-foreground">
              This is the <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">AGENTS.md</code>-format instructions served to your AI agent. It defines how your agent should read, link, and compile notes — the &ldquo;second brain&rdquo; contract. Edits apply immediately to any agent that fetches it via REST or MCP.
            </p>
            <Textarea className="h-[26rem] font-mono !text-[13px] leading-relaxed" value={schema} onChange={(e) => setSchema(e.target.value)} spellCheck={false} />
            <div className="flex items-center gap-2">
              <Button onClick={saveSchema} disabled={schemaSaved}>
                {schemaSaved ? <><IconCheck size={14} data-icon="inline-start" /> Saved</> : "Save schema"}
              </Button>
              <Button variant="outline" onClick={() => setRestoreConfirm(true)}>
                Restore default
              </Button>
              <span className="ml-auto text-xs text-muted-foreground">
                {schema.length.toLocaleString()} chars
              </span>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="properties" className="fade-in">
          <div className="flex flex-col gap-3 pt-3">
            <p className="text-sm text-muted-foreground">
              Define the properties every note can carry (stored as YAML frontmatter, Obsidian-compatible). Typed, consistent
              properties are what keep a vault searchable — the note editor renders them as inputs, and AI agents read this
              dictionary to set and filter by them.
            </p>
            {propDefs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No properties defined yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {propDefs.map((def, i) => (
                  <li key={i} className="flex items-end gap-2 rounded-lg bg-card p-3 ring-1 ring-foreground/10">
                    <Field className="w-44">
                      <FieldLabel>Name</FieldLabel>
                      <Input value={def.name} onChange={(e) => updatePropDef(i, { name: e.target.value })} aria-label="Property name" maxLength={64} />
                    </Field>
                    <Field className="w-36">
                      <FieldLabel>Type</FieldLabel>
                      <Select
                        items={Object.fromEntries(PROPERTY_TYPES.map((t) => [t, t]))}
                        value={def.type}
                        onValueChange={(v) => { if (v !== null) updatePropDef(i, { type: v as PropertyType }); }}
                      >
                        <SelectTrigger aria-label={`Type of ${def.name}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {PROPERTY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Field>
                    {def.type === "select" && (
                      <Field className="min-w-0 flex-1">
                        <FieldLabel>Allowed values</FieldLabel>
                        <Input
                          value={(def.options ?? []).join(", ")}
                          placeholder="comma, separated, values"
                          onChange={(e) => updatePropDef(i, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                          aria-label={`Options for ${def.name}`}
                        />
                      </Field>
                    )}
                    <Button variant="ghost" size="icon" aria-label={`Remove ${def.name}`} className="mb-0.5" onClick={() => setPropDefs((defs) => defs.filter((_, j) => j !== i))}>
                      <IconTrash size={14} />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={addPropDef}>
                <IconPlus size={14} data-icon="inline-start" /> Add property
              </Button>
              <Button onClick={savePropDefs} disabled={propsSaved}>
                {propsSaved ? <><IconCheck size={14} data-icon="inline-start" /> Saved</> : "Save properties"}
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="keys" className="fade-in">
          <div className="flex flex-col gap-5 pt-3">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><IconKey size={15} /> New agent key</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Input placeholder="Label, e.g. Hermes" value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} aria-label="Key label" />
                <Field>
                  <FieldLabel>Scopes</FieldLabel>
                  <ToggleGroup multiple variant="outline" size="sm" className="flex-wrap" value={newKeyScopes}
                    onValueChange={(values) => setNewKeyScopes(values as string[])} aria-label="Key scopes">
                    {ALL_SCOPES.map((s) => (
                      <ToggleGroupItem key={s} value={s}>{s}</ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </Field>
                <div><Button onClick={createKey}>Generate key</Button></div>
              </CardContent>
            </Card>

            {revealed && (
              <Card className="ring-primary/50">
                <CardContent className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="text-primary">Key created — copy it now</CardTitle>
                    <CardDescription className="mt-0.5">
                      {revealed.name} · <span className="font-semibold text-destructive">It won't be shown again.</span>
                    </CardDescription>
                    <code className="mt-2 block select-all break-all rounded-lg bg-muted px-3 py-2 font-mono text-xs">{revealed.key}</code>
                  </div>
                  <Button variant="ghost" size="icon-sm" aria-label="Dismiss" onClick={() => setRevealed(null)}><IconX size={14} /></Button>
                </CardContent>
              </Card>
            )}

            <div>
              <h3 className="text-sm font-semibold">Existing keys ({keys.length})</h3>
              {keys.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">No keys yet.</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-2">
                  {keys.map((k) => (
                    <li key={k.id} className="flex items-center gap-3 rounded-lg bg-card py-2 pl-4 pr-2 ring-1 ring-foreground/10">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{k.name || "Unnamed"}</p>
                        <p className="text-xs text-muted-foreground">
                          {k.scopes.join(", ")} · created {new Date(k.created_at * 1000).toLocaleDateString()}
                          {k.last_used_at ? ` · last used ${new Date(k.last_used_at * 1000).toLocaleDateString()}` : " · never used"}
                        </p>
                      </div>
                      <Button variant="destructive" size="icon-sm" aria-label={`Revoke ${k.name || "Unnamed"}`} onClick={() => setRevokeTarget(k.id)}><IconTrash size={14} /></Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="recall" className="fade-in">
          <div className="flex flex-col gap-4 pt-3">
            <p className="text-sm text-muted-foreground">
              Optional semantic recall. Configure <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">CHIBAKO_EMBEDDING_*</code>{" "}
              to fuse vector search with keyword search. When unset, this stays off and no note content leaves the server.
            </p>
            {!embStatus ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : !embStatus.enabled ? (
              <Alert>
                <AlertDescription>
                  Embeddings are disabled. Set <code>CHIBAKO_EMBEDDING_PROVIDER</code> and{" "}
                  <code>CHIBAKO_EMBEDDING_API_KEY</code> (any OpenAI-compatible <code>/v1/embeddings</code> endpoint), then restart the server.
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <Card>
                  <CardContent className="flex flex-col gap-1 pt-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Provider</span>
                      <span className="text-sm font-medium">
                        {embStatus.provider} · {embStatus.model}
                        {embStatus.dim ? ` (${embStatus.dim}d)` : ""}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Indexed</span>
                      <span className="text-sm font-medium">{embStatus.indexed} / {embStatus.total}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Stale</span>
                      <span className="text-sm font-medium">{embStatus.stale}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Stored vectors</span>
                      <span className="text-sm font-medium">{embStatus.rows}</span>
                    </div>
                    {embStatus.last_indexed_at && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Last indexed</span>
                        <span className="text-sm">{new Date(embStatus.last_indexed_at * 1000).toLocaleString()}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
                {embStatus.last_error && (
                  <Alert variant="destructive">
                    <AlertDescription>Last error: {embStatus.last_error}</AlertDescription>
                  </Alert>
                )}
                <div className="flex items-center gap-2">
                  <Button onClick={runReindex} disabled={reindexing}>
                    {reindexing ? "Reindexing…" : "Reindex now"}
                  </Button>
                  <Button variant="outline" onClick={loadEmbeddings} disabled={reindexing}>
                    Refresh status
                  </Button>
                </div>
              </>
            )}
          </div>
        </TabsContent>

        <TabsContent value="password" className="fade-in">
          <form className="flex max-w-sm flex-col gap-3 pt-3" onSubmit={changePassword}>
            {pwMsg && (
              <Alert variant={pwMsg.ok ? "default" : "destructive"} className={pwMsg.ok ? "border-success/30 bg-success/10 text-success" : undefined}>
                <AlertDescription>{pwMsg.text}</AlertDescription>
              </Alert>
            )}
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="pw-current">Current password</FieldLabel>
                <Input id="pw-current" type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required />
              </Field>
              <Field>
                <FieldLabel htmlFor="pw-next">New password</FieldLabel>
                <Input id="pw-next" type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} placeholder="At least 8 characters" required />
              </Field>
            </FieldGroup>
            <div><Button type="submit">Update password</Button></div>
          </form>
        </TabsContent>
      </Tabs>

      <div className="mt-8 border-t border-border pt-4">
        <Button variant="ghost" onClick={() => { fetch("/api/logout", { method: "POST" }); router.push("/login"); }}>
          Sign out
        </Button>
      </div>
      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(o) => !o && setRevokeTarget(null)}
        title="Revoke this key?"
        description="Agents using it will lose access immediately."
        confirmLabel="Revoke key"
        destructive
        onConfirm={revoke}
      />
      <ConfirmDialog
        open={restoreConfirm}
        onOpenChange={setRestoreConfirm}
        title="Restore default schema?"
        description="Your current knowledge-schema edits will be lost."
        confirmLabel="Restore default"
        onConfirm={restoreDefaultSchema}
      />
    </div>
  );
}
