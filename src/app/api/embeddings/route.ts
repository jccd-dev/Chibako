import { withAuth } from "@/lib/api";
import { embeddingStatus } from "@/lib/embedding-index";

export const GET = withAuth("notes:read", async () => {
  return Response.json({ status: embeddingStatus() });
});
