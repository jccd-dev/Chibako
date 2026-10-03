import { getAccount, updateAccount } from "@/features/finance/accounts";
import { financeJsonBody, withFinanceAuth } from "../../_adapter";

export const runtime = "nodejs";

export const GET = withFinanceAuth("finance:read", async (_request, actor, context) => {
  const { id } = await context.params;
  return Response.json({ account: getAccount(actor, id) });
});

export const PATCH = withFinanceAuth("finance:manage", async (request, actor, context) => {
  const { id } = await context.params;
  return Response.json(updateAccount(actor, id, await financeJsonBody(request)));
});
