import { withAuth } from "@/lib/api";
import { revokeApiKey } from "@/lib/auth";

export const DELETE = withAuth("keys:write", async (_req, _scopes, ctx) => {
  const { id } = await ctx.params;
  revokeApiKey(id);
  return Response.json({ ok: true });
});