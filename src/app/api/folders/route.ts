import { withAuth } from "@/lib/api";
import { createFolder, folderTree, moveFolder, deleteFolder } from "@/lib/notes";
import { z } from "zod";

const pathInput = z.object({ path: z.string().min(1).max(512) });
const moveInput = z.object({ from: z.string().min(1).max(512), to: z.string().min(1).max(512) });

export const GET = withAuth("notes:read", async () => Response.json({ folders: folderTree() }));
export const POST = withAuth("notes:write", async req => {
  const parsed = pathInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter a folder path." }, { status: 400 });
  return Response.json({ path: createFolder(parsed.data.path) }, { status: 201 });
});
export const PATCH = withAuth("notes:write", async req => {
  const parsed = moveInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Provide source and destination paths." }, { status: 400 });
  return Response.json({ path: moveFolder(parsed.data.from, parsed.data.to) });
});
export const DELETE = withAuth("notes:write", async req => {
  const path = req.nextUrl.searchParams.get("path") ?? "";
  if (!path) return Response.json({ error: "Provide a folder path." }, { status: 400 });
  return Response.json({ parent: deleteFolder(path) });
});
