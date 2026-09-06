import { NextRequest } from "next/server";
import { withAuthAny } from "@/lib/api";
import { searchNotes } from "@/lib/notes";

export const GET = withAuthAny(["notes:read", "search:read"], async (req: NextRequest) => {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  return Response.json({ query: q, results: searchNotes(q) });
});