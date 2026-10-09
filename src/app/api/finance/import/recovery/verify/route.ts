import type { NextRequest } from "next/server";
import { verifyTarsiImportRecovery } from "@/features/finance/import-commit";
import { importErrorResponse, importJsonBody, requireImportOwner } from "../../_owner";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    requireImportOwner(request);
    return Response.json(verifyTarsiImportRecovery({ kind: "owner" }, await importJsonBody(request)), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return importErrorResponse(error);
  }
}
