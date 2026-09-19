import { NextResponse } from "next/server";
import { getCookieToken, getSession } from "@/lib/auth";
import { listDatedNotes } from "@/features/calendar/dated-notes";

export async function GET() {
  if (!getSession(await getCookieToken())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json({ notes: listDatedNotes() });
}
