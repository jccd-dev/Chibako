import { withAuth } from "@/lib/api";
import { reindexEmbeddings, embeddingStatus } from "@/lib/embedding-index";

export const POST = withAuth("notes:write", async () => {
  const result = await reindexEmbeddings();
  return Response.json({ ...result, status: embeddingStatus() });
});
