import { getCookieToken, getSession } from "@/lib/auth";
import { authenticateApiKey } from "@/server/auth/api-key-authorization";
import { authorizeFinance } from "@/server/auth/finance-authorization";
import { FinanceError, type FinanceActor, type FinanceScope } from "@/features/finance/types";

type Context = { params: Promise<Record<string, string>> };

export function withFinanceAuth(scope: FinanceScope, handler: (request: Request, actor: FinanceActor, context: Context) => Promise<Response>) {
  return async (request: Request, context: Context): Promise<Response> => {
    try {
      const authorization = request.headers.get("authorization");
      let actor: FinanceActor;
      if (authorization !== null) {
        const match = authorization.match(/^Bearer ([^\s]+)$/);
        const principal = match ? authenticateApiKey(match[1]) : null;
        if (!principal) throw new FinanceError("Unauthorized", 401, "unauthorized");
        actor = { kind: "api-key", id: principal.id, scopes: principal.scopes };
      } else {
        if (!getSession(await getCookieToken())) throw new FinanceError("Unauthorized", 401, "unauthorized");
        actor = { kind: "owner" };
      }
      authorizeFinance(actor, scope);
      const response = await handler(request, actor, context);
      response.headers.set("Cache-Control", "no-store");
      return response;
    } catch (error) {
      if (error instanceof FinanceError) return Response.json({ error: error.message, code: error.code }, { status: error.status, headers: { "Cache-Control": "no-store" } });
      console.error(error);
      return Response.json({ error: "Internal error", code: "internal_error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
    }
  };
}

export function financeQuery(request: Request): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  for (const [key, value] of new URL(request.url).searchParams) {
    if (key === "limit" || key === "offset") query[key] = value === "" ? NaN : Number(value);
    else if (key === "include_details" || key === "matchable" || key === "payment_matchable" || key === "overdue") query[key] = value === "true" ? true : value === "false" ? false : value;
    else query[key] = value;
  }
  return query;
}

export async function financeJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new FinanceError("Invalid JSON body", 400, "invalid_input");
  }
}
