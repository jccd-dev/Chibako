import { NextRequest } from "next/server";
import { withAuth } from "@/lib/api";
import { getDb } from "@/lib/db";
import { DEFAULT_SCHEMA } from "@/lib/schema";

export const GET = withAuth("schema:read", async () => {
  const row = getDb().prepare(`SELECT value FROM settings WHERE key = 'knowledge_schema'`).get() as { value: string } | undefined;
  return Response.json({ schema: row?.value ?? DEFAULT_SCHEMA });
});

export const PUT = withAuth("schema:write", async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}));
  if (typeof body.schema !== "string") {
    return Response.json({ error: "schema must be a string" }, { status: 400 });
  }
  getDb()
    .prepare(`INSERT INTO settings (key, value) VALUES ('knowledge_schema', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(body.schema);
  return Response.json({ ok: true });
});