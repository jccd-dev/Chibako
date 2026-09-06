import { withAuth } from "@/lib/api";
import { getNote, getOutlinks, getBacklinks } from "@/lib/notes";

export const GET = withAuth("notes:read", async (_req, _scopes, ctx) => {
  const { id } = await ctx.params;
  const note = getNote(id);
  if (!note) return Response.json({ error: "Not found" }, { status: 404 });
  const out = getOutlinks(id).map((l) => ({
    target: l.target_title,
    target_id: l.target_id,
    resolved: Boolean(l.target_id),
  }));
  const back = getBacklinks(note.title).map((b) => ({
    id: b.id,
    title: b.title,
    folder: b.folder,
    snippet: b.snippet,
  }));
  return Response.json({ outlinks: out, backlinks: back });
});