import { withAuth } from "@/lib/api";
import { listTrash, purgeExpiredTrash } from "@/lib/notes";
import { hasScope } from "@/server/auth/api-key-authorization";

export const GET = withAuth("notes:read", async (_req, scopes) => {
  if (hasScope(scopes, "notes:purge")) purgeExpiredTrash();
  return Response.json({ notes: listTrash() });
});
