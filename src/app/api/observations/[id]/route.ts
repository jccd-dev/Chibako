import { NextRequest } from "next/server";
import { withAuth } from "@/lib/api";
import { deleteObservation } from "@/lib/recall";

export const DELETE = withAuth("notes:write", async (_req: NextRequest, _scopes: string[], ctx: { params: Promise<Record<string, string>> }) => {
  const { id } = await ctx.params;
  if (!deleteObservation(id)) return Response.json({ error: "observation not found" }, { status: 404 });
  return Response.json({ deleted: id });
});