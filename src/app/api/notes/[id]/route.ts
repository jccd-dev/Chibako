import { NextRequest } from "next/server";
import { withAuth } from "@/lib/api";
import { getNote, updateNote, deleteNote } from "@/lib/notes";

export const GET = withAuth("notes:read", async (_req, _scopes, ctx) => {
  const { id } = await ctx.params;
  const note = getNote(id);
  if (!note) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ note });
});

export const PATCH = withAuth("notes:write", async (req: NextRequest, _scopes, ctx) => {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Invalid body" }, { status: 400 });
  const updated = updateNote(id, {
    title: typeof body.title === "string" ? body.title : undefined,
    folder: typeof body.folder === "string" ? body.folder : undefined,
    content: typeof body.content === "string" ? body.content : undefined,
    kind: body.kind === "note" || body.kind === "wiki" || body.kind === "index" ? body.kind : undefined,
    is_pinned: body.is_pinned === 1 || body.is_pinned === 0 ? body.is_pinned : undefined,
    properties: body.properties && typeof body.properties === "object" && !Array.isArray(body.properties) ? body.properties : undefined,
  });
  if (!updated) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ note: updated });
});

export const DELETE = withAuth("notes:write", async (_req, _scopes, ctx) => {
  const { id } = await ctx.params;
  if (!deleteNote(id)) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true, trashed: true });
});