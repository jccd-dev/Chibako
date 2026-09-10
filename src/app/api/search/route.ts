import { NextRequest } from "next/server";
import { withAuthAny } from "@/lib/api";
import { searchNotes, type PropertyFilter } from "@/lib/notes";

export const GET = withAuthAny(["notes:read", "search:read"], async (req: NextRequest) => {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  // Optional property filter: ?q=foo&prop.status=done&prop.tags=work
  const props: PropertyFilter[] = [];
  for (const [key, value] of req.nextUrl.searchParams.entries()) {
    if (key.startsWith("prop.") && value) props.push({ key: key.slice(5), value });
  }
  return Response.json({ query: q, results: searchNotes(q, props) });
});
