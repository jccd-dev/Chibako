import { NoteInputError } from "@/lib/notes";
import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, getCookieToken, getSession, getSessionReadOnly } from "@/lib/auth";
import { hasAnyScope } from "@/server/auth/api-key-authorization";

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
    if (!hasAnyScope(scopes, required)) return NextResponse.json({ error: "Forbidden: missing scope" }, { status: 403 });
    try {
      return await handler(req, scopes, ctx);
    } catch (e) {
      if (e instanceof NoteInputError) return NextResponse.json({ error: e.message }, { status: e.status });
      console.error(e);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  };
}

/**
 * Browser-only mutation guard. Browsers always send Sec-Fetch-Site; for older
 * clients fall back to matching Origin against the (proxy-forwarded) host.
 */
export function isSameOriginBrowserRequest(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const trusted = process.env.CHIBAKO_TRUST_PROXY === "true";
  const host = (trusted && req.headers.get("x-forwarded-host")) || req.headers.get("host");
  try {
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Owner-only: the browser session cookie alone. API keys (even "*") and MCP
 * callers are denied, and state-changing methods must be same-origin browser requests.
 */
export function withOwnerSession(handler: (req: NextRequest) => Promise<Response>) {
  return async (req: NextRequest) => {
    const validSession = req.method === "GET" ? getSessionReadOnly : getSession;
    if (!validSession(await getCookieToken())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (req.method !== "GET" && !isSameOriginBrowserRequest(req)) {
      return NextResponse.json({ error: "Forbidden origin" }, { status: 403 });
    }
    try {
      return await handler(req);
    } catch (e) {
      console.error(e);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  };
}
