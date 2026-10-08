import { getCookieToken, getSession } from "@/lib/auth";
import { inspectTarsiBackup } from "@/features/finance/import-inspection";
import { TARSI_BACKUP_MAX_BYTES } from "@/features/finance/import-inspection-types";
import { FinanceError } from "@/features/finance/types";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  try {
    // Reject agent credentials before authentication can record API-key use.
    if (request.headers.has("authorization")) throw new FinanceError("Backup inspection requires the owner session", 403, "owner_required");
    if (!getSession(await getCookieToken())) throw new FinanceError("Unauthorized", 401, "unauthorized");
    const origin = request.headers.get("origin");
    if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") {
      throw new FinanceError("Forbidden origin", 403, "forbidden");
    }
    if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
      throw new FinanceError("Choose a JSON backup", 415, "invalid_input");
    }
    if (Number(request.headers.get("content-length")) > TARSI_BACKUP_MAX_BYTES) throw new FinanceError("Backup exceeds the 8 MB inspection limit", 413, "payload_too_large");
    if (!request.body) throw new FinanceError("Choose a JSON backup", 400, "invalid_input");
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > TARSI_BACKUP_MAX_BYTES) {
          await reader.cancel();
          throw new FinanceError("Backup exceeds the 8 MB inspection limit", 413, "payload_too_large");
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    let backup: unknown;
    try { backup = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new FinanceError("Invalid JSON backup", 400, "invalid_input"); }
    return Response.json(inspectTarsiBackup({ kind: "owner" }, backup), { headers });
  } catch (error) {
    if (error instanceof FinanceError) return Response.json({ error: error.message, code: error.code }, { status: error.status, headers });
    return Response.json({ error: "Could not inspect backup. Try again.", code: "internal_error" }, { status: 500, headers });
  }
}
