import { withAuth } from "@/lib/api";
import { graphData } from "@/lib/notes";

export const GET = withAuth("notes:read", async () => {
  return Response.json(graphData());
});