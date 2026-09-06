import { withAuth } from "@/lib/api";
import { listTrash } from "@/lib/notes";

export const GET = withAuth("notes:read", async () => {
  return Response.json({ notes: listTrash() });
});
