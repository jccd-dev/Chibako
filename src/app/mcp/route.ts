import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { getAuthClientId } from "@/lib/auth-rate-limit";
import { createFixedWindowRateLimiter } from "@/lib/fixed-window-rate-limit";
import { createMcpServer } from "@/mcp/create-server";
import { authenticateApiKey } from "@/server/auth/api-key-authorization";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 1024 * 1024;
const authenticatedLimiter = createFixedWindowRateLimiter(120, 60_000);
const failedAuthLimiter = createFixedWindowRateLimiter(20, 60_000);

function jsonError(status: number, error: string, headers?: HeadersInit) {
  return Response.json({ error }, { status, headers });
}

function rateLimited(retryAfterSeconds: number) {
  return jsonError(429, "Too many requests", { "Retry-After": String(retryAfterSeconds) });
}

function unauthorized() {
  return jsonError(401, "Unauthorized", { "WWW-Authenticate": "Bearer" });
}

async function readJson(request: Request) {
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new RangeError("Request body exceeds 1 MiB");
    }
    chunks.push(value);
  }
  return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return jsonError(403, "Forbidden origin");

  const clientId = getAuthClientId(request);
  const failedStatus = failedAuthLimiter.blocked(clientId);
  if (!failedStatus.allowed) return rateLimited(failedStatus.retryAfterSeconds);

  const match = /^Bearer ([^\s]+)$/.exec(request.headers.get("authorization") ?? "");
  const principal = match ? authenticateApiKey(match[1]) : null;
  if (!principal) {
    const status = failedAuthLimiter.consume(clientId);
    return status.allowed ? unauthorized() : rateLimited(status.retryAfterSeconds);
  }

  const authenticatedStatus = authenticatedLimiter.consume(principal.id);
  if (!authenticatedStatus.allowed) return rateLimited(authenticatedStatus.retryAfterSeconds);

  let parsedBody: unknown;
  try {
    parsedBody = await readJson(request);
  } catch (error) {
    if (error instanceof RangeError) return jsonError(413, error.message);
    return jsonError(400, "Invalid JSON body");
  }

  const server = createMcpServer({ scopes: principal.scopes, exposure: "remote" });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    return await transport.handleRequest(request, { parsedBody });
  } finally {
    await server.close();
  }
}

function methodNotAllowed() {
  return jsonError(405, "Method not allowed", { Allow: "POST" });
}

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const OPTIONS = methodNotAllowed;
