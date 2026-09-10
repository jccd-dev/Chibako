import { NextRequest } from "next/server";
import { withAuth } from "@/lib/api";
import { addBookmark, listBookmarks, removeBookmark, reorderBookmarks, updateBookmark, BookmarkError } from "@/lib/bookmarks";

export const GET = withAuth("notes:read", async () => {
  return Response.json({ bookmarks: listBookmarks() });
});

export const POST = withAuth("notes:write", async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}));
  try {
    if (!body || typeof body !== "object" || typeof body.note_id !== "string") {
      return Response.json({ error: "note_id is required" }, { status: 400 });
    }
    const bookmark = addBookmark({
      note_id: body.note_id,
      label: typeof body.label === "string" ? body.label : undefined,
      group_name: typeof body.group_name === "string" ? body.group_name : undefined,
    });
    return Response.json({ bookmark }, { status: 201 });
  } catch (e) {
    if (e instanceof BookmarkError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
});

/** Drag-reorder: full display order; entries may change group inline. */
export const PUT = withAuth("notes:write", async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}));
  if (!body || !Array.isArray(body.order)) {
    return Response.json({ error: "order array is required" }, { status: 400 });
  }
  const order = body.order
    .filter((o: unknown): o is { id: string; group_name?: string } =>
      Boolean(o) && typeof o === "object" && typeof (o as { id?: unknown }).id === "string")
    .map((o: { id: string; group_name?: string }) => ({
      id: o.id,
      group_name: typeof o.group_name === "string" ? o.group_name : undefined,
    }));
  return Response.json({ bookmarks: reorderBookmarks(order) });
});

export const PATCH = withAuth("notes:write", async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}));
  if (!body || typeof body !== "object" || typeof body.id !== "string") {
    return Response.json({ error: "id is required" }, { status: 400 });
  }
  const bookmark = updateBookmark(body.id, {
    label: typeof body.label === "string" ? body.label : undefined,
    group_name: typeof body.group_name === "string" ? body.group_name : undefined,
  });
  if (!bookmark) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ bookmark });
});

export const DELETE = withAuth("notes:write", async (req: NextRequest) => {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });
  if (!removeBookmark(id)) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true });
});
