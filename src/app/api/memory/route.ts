import { authenticateApiKey } from "@/server/auth/api-key-authorization";
import { readMemory, writeMemory } from "@/features/memory/memory";
import { sessionMemory } from "@/features/memory/session-memory";
import { MemoryError } from "@/features/memory/types";
import type { ApiKeyPrincipal } from "@/server/auth/api-key-authorization";

export const runtime = "nodejs";

async function handle(request: Request, operation: (principal: ApiKeyPrincipal) => Promise<object>): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  try {
    const match = request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/);
    const principal = match ? authenticateApiKey(match[1]) : null;
    if (!principal) throw new MemoryError("Unauthorized", 401, "unauthorized");
    return Response.json(await operation(principal), { headers });
  } catch (error) {
    if (error instanceof MemoryError) return Response.json({ error: error.message, code: error.code }, { status: error.status, headers });
    return Response.json({ error: "Memory operation failed", code: "internal_error" }, { status: 500, headers });
  }
}

export async function POST(request: Request): Promise<Response> {
  return handle(request, async (principal) => {
    // Bound the stream before JSON parsing, including requests without Content-Length.
    const reader = request.body?.getReader();
    if (!reader) throw new MemoryError("Invalid JSON body", 400, "invalid_input");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 300_000) {
          await reader.cancel();
          throw new MemoryError("Checkpoint exceeds request limit", 413, "invalid_input");
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new MemoryError("Invalid JSON body", 400, "invalid_input"); }
    return typeof body === "object" && body !== null && "action" in body
      ? sessionMemory(principal, body)
      : writeMemory(principal, body);
  });
}

export async function GET(request: Request): Promise<Response> {
  return handle(request, async (principal) => readMemory(principal, Object.fromEntries(new URL(request.url).searchParams)));
}
