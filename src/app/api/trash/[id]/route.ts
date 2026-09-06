import { withAuth } from "@/lib/api";
import { purgeNote } from "@/lib/notes";

export const DELETE = withAuth("notes:write", async (_req, _scopes, ctx) => {
  const { id } = await ctx.params;
  if (!purgeNote(id)) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true, purged: true });
});
