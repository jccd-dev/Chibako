import { NextResponse } from "next/server";
import { z } from "zod";
import { withOwnerSession } from "@/lib/api";
import { versionSchema } from "@/features/updates/protocol";
import { UpdateError, getUpdateView, requestUpdate } from "@/features/updates/updates";

export const runtime = "nodejs";

const requestBody = z.object({ version: versionSchema }).strict();

export const GET = withOwnerSession(async () => NextResponse.json(getUpdateView()));

export const POST = withOwnerSession(async (req) => {
  const text = await req.text();
  if (text.length > 256) return NextResponse.json({ error: "Request too large." }, { status: 413 });
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = null; }
  const parsed = requestBody.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid update request." }, { status: 400 });
  try {
    return NextResponse.json(requestUpdate(parsed.data.version), { status: 202 });
  } catch (e) {
    if (e instanceof UpdateError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
});
