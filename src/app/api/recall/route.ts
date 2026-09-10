import { NextRequest } from "next/server";
import { withAuthAny } from "@/lib/api";
import { recall, getEmbeddingStatus, indexEmbeddings } from "@/lib/recall";

export const GET = withAuthAny(["notes:read", "search:read"], async (req: NextRequest) => {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const limit = Math.max(1, Math.min(50, Number(req.nextUrl.searchParams.get("limit") ?? 8)));
  const budget = Math.max(100, Math.min(20000, Number(req.nextUrl.searchParams.get("budget") ?? 2000)));
  try {
    const results = await recall({ query: q, limit, budget });
    return Response.json({ query: q, budget, count: results.length, results });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "recall failed" }, { status: 500 });
  }
});

export const POST = withAuthAny(["notes:write", "schema:write"], async () => {
  try {
    const res = await indexEmbeddings();
    return Response.json({ ...res, status: getEmbeddingStatus() });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "embedding indexing failed" }, { status: 500 });
  }
});