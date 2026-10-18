import { createAccount, listAccounts } from "@/features/finance/accounts";
import { financeJsonBody, withFinanceAuth } from "../_adapter";

export const runtime = "nodejs";

export const GET = withFinanceAuth("finance:read", async (request, actor) => {
  const params = new URL(request.url).searchParams;
  return Response.json(listAccounts(actor, {
    ...(params.has("limit") ? { limit: Number(params.get("limit")) } : {}),
    ...(params.has("offset") ? { offset: Number(params.get("offset")) } : {}),
    ...(params.has("archived") ? { archived: params.get("archived") } : {}),
    ...(params.has("kind") ? { kind: params.get("kind") } : {}),
  }));
});

export const POST = withFinanceAuth("finance:manage", async (request, actor) => {
  return Response.json(createAccount(actor, await financeJsonBody(request)), { status: 201 });
});
