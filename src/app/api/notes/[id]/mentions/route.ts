import { NextRequest } from "next/server";
import { withAuth } from "@/lib/api";
import { getNote, unlinkedMentions, linkMention } from "@/lib/notes";

export const GET = withAuth("notes:read", async (_req, _scopes, ctx) => {
  const { id } = await ctx.params;
  const note = getNote(id);
  if (!note) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ mentions: unlinkedMentions(id) });
});

export const POST = withAuth("notes:write", async (req: NextRequest, _scopes, ctx) => {
  const { id } = await ctx.params;
  const note = getNote(id);
  if (!note) return Response.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  if (typeof body.source_id !== "string") return Response.json({ error: "source_id required" }, { status: 400 });
  if (!linkMention(body.source_id, note.title)) {
    return Response.json({ error: "No linkable mention found" }, { status: 404 });
  }
  return Response.json({ ok: true, linked: true });
});
