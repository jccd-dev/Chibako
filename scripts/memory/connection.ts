import { MemoryClientError } from "./client-error";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { MemoryFailure } from "./client-error";
import { z } from "zod";
import type { MemoryCall } from "./runtime";

const MEMORY_REQUEST_TIMEOUT_MS = 5000;

export const requiredScopes = ["notes:read", "schema:read", "memory:write"];
export const memoryStatusSchema = z.object({
  contract_version: z.literal(1), principal_id: z.string().min(1), scopes: z.array(z.string()),
  enabled: z.boolean(), area: z.string().nullable(),
  session_lifecycle: z.literal(1).optional(),
  projects: z.literal(1).optional(),
});
export type MemoryStatus = z.infer<typeof memoryStatusSchema>;
export function validateEndpoint(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new MemoryClientError("Use HTTPS, or HTTP only on loopback.");
  if (url.username || url.password || url.search || url.hash) throw new MemoryClientError("Use an MCP URL without credentials, query or fragment.");
  return url.href;
}
export function validateMemoryStatus(raw: unknown): MemoryStatus {
  const parsed = memoryStatusSchema.safeParse(raw);
  if (!parsed.success) throw new MemoryClientError("Server memory contract is incompatible. Deploy the current memory capability first.");
  const status = parsed.data;
  if (requiredScopes.some((scope) => !status.scopes.includes(scope))) throw new MemoryClientError("Key is missing required memory/read scopes. Add notes:read, schema:read and memory:write to the key.");
  if (!status.enabled || !status.area) throw new MemoryClientError("Server memory is disabled. Ask the owner to configure a non-root memory area.");
  return status;
}

// Only allowlisted categories and an HTTP status leave here; raw messages may carry URLs or upstream detail.
function classify(error: unknown, phase: "connect" | "call", started: number): MemoryFailure {
  const elapsed_ms = Date.now() - started;
  if (error instanceof UnauthorizedError) return { category: "authentication", phase, elapsed_ms };
  if (error instanceof StreamableHTTPError && error.code && error.code > 0) {
    return { category: [401, 403].includes(error.code) ? "authentication" : "http", phase, http_status: error.code, elapsed_ms };
  }
  if ((error instanceof McpError && error.code === ErrorCode.RequestTimeout) || (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name))) {
    return { category: "timeout", phase, elapsed_ms };
  }
  if (error instanceof TypeError) return { category: "connection", phase, elapsed_ms };
  return { category: "unknown", phase, elapsed_ms };
}

// Fixed wording plus at most a validated revision: upstream detail never reaches agent or user output.
export function conflictMessage(detail: string): string {
  const revision = /\brevision ([a-f0-9]{64})\b/.exec(detail)?.[1];
  if (revision) return `Session memory conflict: the checkpoint is at revision ${revision}.`;
  if (detail.includes("No session checkpoint exists yet")) return "Session memory conflict: no session checkpoint exists yet; use expected_revision null to create it.";
  return "Session memory conflict: a revision changed (session or retained note).";
}

export function connectMemory(endpoint: string, key: string, expectedPrincipal?: string, expectedArea?: string): {
  call: MemoryCall; readonly calls: number; close: () => Promise<void>;
} {
  let client: Client | undefined;
  let verified = false;
  let status: MemoryStatus | undefined;
  let calls = 0;
  const invoke: MemoryCall = async (name, args) => {
    if (!key) throw new MemoryClientError("A restricted Chibako API key is required.", { category: "authentication", phase: "connect" });
    const started = Date.now();
    if (!client) {
      const connecting = new Client({ name: "chibako-memory-plugin", version: "1" });
      try {
        await connecting.connect(new StreamableHTTPClientTransport(new URL(validateEndpoint(endpoint)), {
          requestInit: { headers: { Authorization: `Bearer ${key}` }, redirect: "error" },
          fetch: (input, init) => fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(MEMORY_REQUEST_TIMEOUT_MS) }),
        }));
        client = connecting;
      } catch (error) {
        await connecting.close().catch(() => {});
        throw new MemoryClientError("Chibako connection or authentication failed before any write was sent. Check the URL, network and key; no credentials were logged.", classify(error, "connect", started));
      }
    }
    calls++;
    let result;
    try { result = await client.callTool({ name, arguments: args }, undefined, { timeout: MEMORY_REQUEST_TIMEOUT_MS }); }
    catch (error) {
      const failure = classify(error, "call", started);
      throw new MemoryClientError(`Memory request failed (${failure.category}${failure.http_status ? ` ${failure.http_status}` : ""} after ${failure.elapsed_ms} ms); the outcome is unverified and a write may have committed. Pending checkpoints are retained and retried with the same request.`, failure);
    }
    if (result.isError && name === "memory_session") {
      const content = z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()).safeParse(result.content);
      const message = content.success ? content.data.find(item => item.type === "text")?.text : undefined;
      if (typeof message === "string" && message.startsWith("error: ineligible_note:")) throw new MemoryClientError("Registered session memory is trashed, moved or missing. Read its current state; explicitly finish a trashed checkpoint or restore owner-relocated data. Pending content remains private.", { category: "ineligible", phase: "call" });
      if (typeof message === "string" && message.startsWith("error: request_conflict:")) throw new MemoryClientError("This request_id was already used with different content. Restage without a request_id so a fresh one is generated.", { category: "request_conflict", phase: "call" });
      if (typeof message === "string" && message.startsWith("error: revision_conflict:")) throw new MemoryClientError(`${conflictMessage(message)} Read and merge the current checkpoint, then restage with replaces_request_id identifying the pending request.`, { category: "conflict", phase: "call" });
    }
    if (result.isError || !result.structuredContent) throw new MemoryClientError("Memory tool unavailable or denied. Check server version and required scopes.", { category: "denied", phase: "call" });
    return z.record(z.string(), z.unknown()).parse(result.structuredContent);
  };
  return {
    get calls() { return calls; },
    call: async (name, args) => {
      if (expectedPrincipal && !verified) {
        status = validateMemoryStatus(await invoke("memory_status", {}));
        if (status.principal_id !== expectedPrincipal || (expectedArea && status.area !== expectedArea)) throw new MemoryClientError("Connection identity changed. Keep pending work with its original profile and run setup again.", { category: "authentication", phase: "connect" });
        verified = true;
      }
      if (name === "memory_session") {
        status ??= validateMemoryStatus(await invoke("memory_status", {}));
        if (status.session_lifecycle !== 1) throw new MemoryClientError("Server does not support session memory. Upgrade the Chibako server before plugin 0.3.0; pending memory is retained.", { category: "unsupported", phase: "connect" });
      }
      if ("project" in args) {
        status ??= validateMemoryStatus(await invoke("memory_status", {}));
        // Older servers reject the field; their memory stays in the area root.
        if (status.projects !== 1) return invoke(name, Object.fromEntries(Object.entries(args).filter(([key]) => key !== "project")));
      }
      return invoke(name, args);
    },
    close: async () => { await client?.close(); },
  };
}
