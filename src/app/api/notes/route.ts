import { NextRequest } from "next/server";
import { withAuth } from "@/lib/api";
import { listNotes, createNote, folderTree } from "@/lib/notes";

export const GET = withAuth("notes:read", async () => {
  return Response.json({ notes: listNotes(), folders: folderTree() });
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
  });
  return Response.json({ note }, { status: 201 });
});