import { NextRequest } from "next/server";
import { withAuth } from "@/lib/api";
import { getKnowledgeSchema, setKnowledgeSchema } from "@/features/schema/knowledge-schema";

export const GET = withAuth("schema:read", async () => {
  return Response.json({ schema: getKnowledgeSchema() });
});

export const PUT = withAuth("schema:write", async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}));
  if (typeof body.schema !== "string") {
    return Response.json({ error: "schema must be a string" }, { status: 400 });
  }
  setKnowledgeSchema(body.schema);
  return Response.json({ ok: true });
});