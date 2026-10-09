import type { NextRequest } from "next/server";
import { readTarsiImportBackup } from "@/features/finance/import-commit";
import { requireImportOwner, importErrorResponse } from "../../_owner";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    requireImportOwner(request);
    const { id } = await context.params;
    const backup = readTarsiImportBackup({ kind: "owner" }, id);
    return new Response(new Uint8Array(backup), { headers: {
      "Cache-Control": "no-store", "Content-Type": "application/vnd.sqlite3",
      "Content-Disposition": `attachment; filename="chibako-finance-backup-${id}.db"`,
    } });
  } catch (error) {
    return importErrorResponse(error);
  }
}
