import { withAuth } from "@/lib/api";
import { DEFAULT_SCHEMA } from "@/lib/schema";

export const GET = withAuth("schema:read", async () => {
  return Response.json({ schema: DEFAULT_SCHEMA });
});
