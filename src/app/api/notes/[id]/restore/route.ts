import { withAuth } from "@/lib/api";
import { restoreNote } from "@/lib/notes";

export const POST = withAuth("notes:write", async (_req, _scopes, ctx) => {
  const { id } = await ctx.params;
  const note = restoreNote(id);
  if (!note) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ note });
});
