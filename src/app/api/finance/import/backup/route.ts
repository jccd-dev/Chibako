import type { NextRequest } from "next/server";
import { createTarsiImportBackup } from "@/features/finance/import-commit";
import { requireImportOwner, importErrorResponse } from "../_owner";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    requireImportOwner(request);
    return Response.json(await createTarsiImportBackup({ kind: "owner" }), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return importErrorResponse(error);
  }
}
