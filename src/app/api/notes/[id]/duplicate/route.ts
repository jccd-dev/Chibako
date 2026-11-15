import { NextRequest } from "next/server";
import { withAuth } from "@/lib/api";
import { duplicateNote } from "@/lib/notes";

export const POST = withAuth("notes:write", async (req: NextRequest, _scopes, ctx) => {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Invalid body" }, { status: 400 });
  const properties = body.properties && typeof body.properties === "object" && !Array.isArray(body.properties) ? body.properties : undefined;
  const note = duplicateNote(id, properties);
  if (!note) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ note }, { status: 201 });
});
