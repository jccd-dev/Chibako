import { withAuth } from "@/lib/api";
import { revokeApiKey } from "@/server/auth/api-key-authorization";

export const DELETE = withAuth("*", async (_req, _scopes, ctx) => {
  const { id } = await ctx.params;
  revokeApiKey(id);
  return Response.json({ ok: true });
});