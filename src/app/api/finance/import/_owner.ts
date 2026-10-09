import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { FinanceError } from "@/features/finance/types";

export function requireImportOwner(request: NextRequest): void {
  if (request.headers.has("authorization")) throw new FinanceError("Import requires the owner session", 403, "owner_required");
  if (!getSession(request.cookies.get("chibako_session")?.value)) throw new FinanceError("Unauthorized", 401, "unauthorized");
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new FinanceError("Forbidden origin", 403, "forbidden");
  }
}

export async function importJsonBody(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new FinanceError("Choose a JSON request", 415, "invalid_input");
  }
  const maxBytes = 8 * 1024 * 1024;
  if (Number(request.headers.get("content-length")) > maxBytes) throw new FinanceError("Import request exceeds the 8 MB limit", 413, "payload_too_large");
  if (!request.body) throw new FinanceError("Invalid JSON body", 400, "invalid_input");
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new FinanceError("Import request exceeds the 8 MB limit", 413, "payload_too_large");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
  catch { throw new FinanceError("Invalid JSON body", 400, "invalid_input"); }
}

export function importErrorResponse(error: unknown): Response {
  if (error instanceof FinanceError) return Response.json({ error: error.message, code: error.code }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  console.error(error);
  return Response.json({ error: "Could not complete the import request", code: "internal_error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
}
