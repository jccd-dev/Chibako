import { NoteInputError } from "@/lib/notes";
import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, getCookieToken, hasScope } from "@/lib/auth";

export interface ApiHandler {
  (req: NextRequest, scopes: string[], ctx: { params: Promise<Record<string, string>> }): Promise<Response>;
}

export function withAuth(required: string, handler: ApiHandler) {
  return withAuthAny([required], handler);
}

/** Like withAuth but grants access when ANY of the listed scopes is present. */
export function withAuthAny(required: string[], handler: ApiHandler) {
  return async (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => {
    const sessionToken = await getCookieToken();
    const scopes = authenticateRequest(req.headers.get("authorization"), sessionToken);
    if (!scopes) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!required.some((r) => hasScope(scopes, r))) return NextResponse.json({ error: "Forbidden: missing scope" }, { status: 403 });
    try {
      return await handler(req, scopes, ctx);
    } catch (e) {
      if (e instanceof NoteInputError) return NextResponse.json({ error: e.message }, { status: e.status });
      console.error(e);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  };
}