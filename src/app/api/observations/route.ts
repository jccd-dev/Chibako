import { NextRequest } from "next/server";
import { withAuth } from "@/lib/api";
import { saveFact } from "@/features/memory/facts";
import { MemoryError } from "@/features/memory/types";
import { listObservations } from "@/lib/recall";

export const GET = withAuth("notes:read", async (req: NextRequest) => {
  const limit = Math.max(1, Math.min(500, Number(req.nextUrl.searchParams.get("limit") ?? 50)));
  const list = listObservations(limit);
  return Response.json({ count: list.length, observations: list });
});

export const POST = withAuth("notes:write", async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}));
  if (!body || typeof body !== "object" || typeof body.content !== "string" || !body.content.trim()) {
    return Response.json({ error: "content is required" }, { status: 400 });
  }
  try {
    // Same capability and response shape as the MCP memory_save tool.
    return Response.json({ observation: saveFact(body) }, { status: 201 });
  } catch (e) {
    if (e instanceof MemoryError) return Response.json({ error: e.message, code: e.code }, { status: e.status });
    throw e;
  }
});
