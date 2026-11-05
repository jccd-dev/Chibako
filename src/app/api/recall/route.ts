import { NextRequest } from "next/server";
import { withAuthAny } from "@/lib/api";
import { recallDetailed } from "@/lib/recall";
import { projectSchema } from "@/features/memory/types";
import { reindexEmbeddings, embeddingStatus } from "@/lib/embedding-index";

export const GET = withAuthAny(["notes:read", "search:read"], async (req: NextRequest) => {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const limit = Math.max(1, Math.min(50, Number(req.nextUrl.searchParams.get("limit") ?? 8)));
  const budget = Math.max(100, Math.min(20000, Number(req.nextUrl.searchParams.get("budget") ?? 2000)));
  const rawProject = req.nextUrl.searchParams.get("project");
  const project = rawProject === null ? undefined : projectSchema.safeParse(rawProject);
  if (project && !project.success) return Response.json({ error: "invalid project" }, { status: 400 });
  try {
    const { results, mode, fallback_reason } = await recallDetailed({ query: q, project: project?.data, limit, budget });
    return Response.json({ query: q, budget, count: results.length, results, mode, fallback_reason });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "recall failed" }, { status: 500 });
  }
});

export const POST = withAuthAny(["notes:write", "schema:write"], async () => {
  try {
    const res = await reindexEmbeddings();
    return Response.json({ ...res, status: embeddingStatus() });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "embedding indexing failed" }, { status: 500 });
  }
});