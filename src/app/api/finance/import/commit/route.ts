import type { NextRequest } from "next/server";
import { commitTarsiImport } from "@/features/finance/import-commit";
import { importErrorResponse, importJsonBody, requireImportOwner } from "../_owner";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    requireImportOwner(request);
    return Response.json(commitTarsiImport({ kind: "owner" }, await importJsonBody(request)), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return importErrorResponse(error);
  }
}
