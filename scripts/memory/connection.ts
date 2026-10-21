import { MemoryClientError } from "./client-error";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import type { MemoryCall } from "./runtime";

export const requiredScopes = ["notes:read", "schema:read", "memory:write"];
export const memoryStatusSchema = z.object({
  contract_version: z.literal(1), principal_id: z.string().min(1), scopes: z.array(z.string()),
  enabled: z.boolean(), area: z.string().nullable(),
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

export function connectMemory(endpoint: string, key: string, expectedPrincipal?: string, expectedArea?: string): {
  call: MemoryCall; readonly calls: number; close: () => Promise<void>;
} {
  let client: Client | undefined;
  let verified = false;
  let calls = 0;
  const invoke: MemoryCall = async (name, args) => {
    if (!key) throw new MemoryClientError("A restricted Chibako API key is required.");
    if (!client) {
      const connecting = new Client({ name: "chibako-memory-plugin", version: "1" });
      try {
        await connecting.connect(new StreamableHTTPClientTransport(new URL(validateEndpoint(endpoint)), {
          requestInit: { headers: { Authorization: `Bearer ${key}` }, redirect: "error" },
          fetch: (input, init) => fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(2000) }),
        }));
        client = connecting;
      } catch {
        await connecting.close().catch(() => {});
        throw new MemoryClientError("Chibako connection or authentication failed. Check the URL, network and key; no credentials were logged.");
      }
    }
    calls++;
    let result;
    try { result = await client.callTool({ name, arguments: args }, undefined, { timeout: 2000 }); }
    catch { throw new MemoryClientError("Memory request failed. Check the connection and server status; pending checkpoints are retained."); }
    if (result.isError || !result.structuredContent) throw new MemoryClientError("Memory tool unavailable or denied. Check server version and required scopes.");
    return z.record(z.string(), z.unknown()).parse(result.structuredContent);
  };
  return {
    get calls() { return calls; },
    call: async (name, args) => {
      if (expectedPrincipal && !verified) {
        const status = validateMemoryStatus(await invoke("memory_status", {}));
        if (status.principal_id !== expectedPrincipal || (expectedArea && status.area !== expectedArea)) throw new MemoryClientError("Connection identity changed. Keep pending work with its original profile and run setup again.");
        verified = true;
      }
      return invoke(name, args);
    },
    close: async () => { await client?.close(); },
  };
}
