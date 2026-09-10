import { NextRequest } from "next/server";
import { withAuth } from "@/lib/api";
import { listObservations, saveObservation, deleteObservation } from "@/lib/recall";

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
  const obs = saveObservation({
    content: body.content,
    note_id: typeof body.note_id === "string" ? body.note_id : undefined,
    source: typeof body.source === "string" ? body.source : undefined,
  });
  return Response.json({ observation: obs }, { status: 201 });
});