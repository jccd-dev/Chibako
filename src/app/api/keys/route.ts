import { NextRequest } from "next/server";
import { withAuth } from "@/lib/api";
import { listApiKeys, createApiKey } from "@/lib/auth";

export const GET = withAuth("keys:read", async () => {
  return Response.json({ keys: listApiKeys() });
});

export const POST = withAuth("*", async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "Agent key";
  const requested: unknown[] = Array.isArray(body.scopes) ? body.scopes : [];
  const valid = ["notes:read", "notes:write", "search:read", "schema:read", "schema:write", "keys:read", "keys:write"];
  const clean = requested.filter((s): s is string => typeof s === "string" && valid.includes(s));
  if (!clean.length) return Response.json({ error: "No valid scopes" }, { status: 400 });
  const { id, key } = createApiKey(name, clean);
  return Response.json({ id, key }, { status: 201 });
});