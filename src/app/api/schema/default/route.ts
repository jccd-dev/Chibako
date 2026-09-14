import { withAuth } from "@/lib/api";
import { DEFAULT_KNOWLEDGE_SCHEMA } from "@/features/schema/knowledge-schema";

export const GET = withAuth("schema:read", async () => {
  return Response.json({ schema: DEFAULT_KNOWLEDGE_SCHEMA });
});
