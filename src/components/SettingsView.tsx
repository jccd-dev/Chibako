"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { IconCheck, IconCopy, IconKey, IconTrash, IconX } from "@/components/icons";

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

export function SettingsView() {
  const router = useRouter();
  const [tab, setTab] = useState<"schema" | "keys" | "password">("schema");
  const [schema, setSchema] = useState("");
  const [schemaSaved, setSchemaSaved] = useState(false);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyScopes, setNewKeyScopes] = useState<string[]>(["notes:read", "search:read", "schema:read"]);
  const [revealed, setRevealed] = useState<{ name: string; key: string } | null>(null);
  const [pw, setPw] = useState({ current: "", next: "" });
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [restoreConfirm, setRestoreConfirm] = useState(false);

  useEffect(() => {
    fetch("/api/schema").then((r) => r.json()).then((d) => setSchema(d.schema)).catch(() => {});
    loadKeys();
  }, []);

  async function loadKeys() {
    const res = await fetch("/api/keys");
    if (res.ok) setKeys((await res.json()).keys);
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

  const tabs = [
    { id: "schema" as const, label: "Knowledge schema (AGENTS.md)" },
    { id: "keys" as const, label: "API keys" },
    { id: "password" as const, label: "Password" },
  ];

  return (
    <div className="mx-auto max-w-3xl overflow-y-auto px-6 py-6">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      <div className="mt-4 flex gap-1 rounded-lg border border-border p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
              tab === t.id ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "schema" && (
        <div className="mt-5 space-y-3 fade-in">
          <p className="text-sm text-muted-foreground">
            This is the <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">AGENTS.md</code>-format instructions served to your AI agent. It defines how your agent should read, link, and compile notes — the &ldquo;second brain&rdquo; contract. Edits apply immediately to any agent that fetches it via REST or MCP.
          </p>
          <textarea className="input h-[26rem] font-mono !text-[13px] leading-relaxed" value={schema} onChange={(e) => setSchema(e.target.value)} spellCheck={false} />
          <div className="flex items-center gap-2">
            <button className="btn btn-primary" onClick={saveSchema} disabled={schemaSaved}>
              {schemaSaved ? <><IconCheck size={14} /> Saved</> : "Save schema"}
            </button>
            <button className="btn" onClick={() => setRestoreConfirm(true)}>
              Restore default
            </button>
            <span className="ml-auto text-xs text-muted-foreground">
              {schema.length.toLocaleString()} chars
            </span>
          </div>
        </div>
      )}

      {tab === "keys" && (
        <div className="mt-5 space-y-5 fade-in">
          <div className="card">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><IconKey size={15} /> New agent key</h3>
            <div className="mt-3 space-y-3">
              <input className="input" placeholder="Label, e.g. Hermes" value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} />
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Scopes</p>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_SCOPES.map((s) => (
                    <button
                      key={s}
                      onClick={() =>
                        setNewKeyScopes((prev) =>
                          prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
                        )
                      }
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                        newKeyScopes.includes(s)
                          ? "border-primary bg-primary/12 text-primary"
                          : "border-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <button className="btn btn-primary" onClick={createKey}>Generate key</button>
            </div>
          </div>

          {revealed && (
            <div className="card border-primary/50">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="text-sm font-semibold text-primary">Key created — copy it now</h4>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {revealed.name} · <span className="font-semibold text-red-500">It won't be shown again.</span>
                  </p>
                  <code className="mt-2 block select-all break-all rounded-lg bg-muted px-3 py-2 font-mono text-xs">{revealed.key}</code>
                </div>
                <button className="btn" onClick={() => setRevealed(null)}><IconX size={14} /></button>
              </div>
            </div>
          )}

          <div>
            <h3 className="text-sm font-semibold">Existing keys ({keys.length})</h3>
            {keys.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No keys yet.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {keys.map((k) => (
                  <li key={k.id} className="card flex items-center gap-3 !py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{k.name || "Unnamed"}</p>
                      <p className="text-xs text-muted-foreground">
                        {k.scopes.join(", ")} · created {new Date(k.created_at * 1000).toLocaleDateString()}
                        {k.last_used_at ? ` · last used ${new Date(k.last_used_at * 1000).toLocaleDateString()}` : " · never used"}
                      </p>
                    </div>
                    <button className="btn btn-danger" onClick={() => setRevokeTarget(k.id)}><IconTrash size={14} /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {tab === "password" && (
        <form className="mt-5 max-w-sm space-y-3 fade-in" onSubmit={changePassword}>
          {pwMsg && (
            <p className={`rounded-lg border px-3 py-2 text-sm ${pwMsg.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600" : "border-red-500/30 bg-red-500/10 text-red-600"}`}>
              {pwMsg.text}
            </p>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Current password</label>
            <input className="input" type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">New password</label>
            <input className="input" type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} placeholder="At least 8 characters" required />
          </div>
          <button className="btn btn-primary" type="submit">Update password</button>
        </form>
      )}

      <div className="mt-8 border-t border-border pt-4">
        <button className="btn" onClick={() => { fetch("/api/logout", { method: "POST" }); router.push("/login"); }}>
          Sign out
        </button>
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