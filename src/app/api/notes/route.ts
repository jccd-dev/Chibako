import { NextRequest } from "next/server";
import { withAuth } from "@/lib/api";
import { listNotes, createNote, folderTree, filterByProperties, type PropertyFilter } from "@/lib/notes";

export const GET = withAuth("notes:read", async (req: NextRequest) => {
  // Optional property filter: /api/notes?prop.status=done&prop.tags=work
  const filters: PropertyFilter[] = [];
  for (const [key, value] of req.nextUrl.searchParams.entries()) {
    if (key.startsWith("prop.") && value) filters.push({ key: key.slice(5), value });
  }
  const notes = filterByProperties(listNotes(), filters);
  return Response.json({ notes, folders: folderTree() });
});

export const POST = withAuth("notes:write", async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}));
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  const note = createNote({
    title: typeof body.title === "string" ? body.title : undefined,
    folder: typeof body.folder === "string" ? body.folder : undefined,
    content: typeof body.content === "string" ? body.content : undefined,
    kind: body.kind === "wiki" ? "wiki" : body.kind === "index" ? "index" : "note",
    properties: body.properties && typeof body.properties === "object" && !Array.isArray(body.properties) ? body.properties : undefined,
  });
  return Response.json({ note }, { status: 201 });
});