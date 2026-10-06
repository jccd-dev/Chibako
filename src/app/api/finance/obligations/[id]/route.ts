import { getObligation, updateObligation } from "@/features/finance/obligations";
import { financeJsonBody, financeQuery, withFinanceAuth } from "../../_adapter";

export const runtime = "nodejs";
export const GET = withFinanceAuth("finance:read", async (request, actor, context) => {
  const { id } = await context.params;
  return Response.json({ obligation: getObligation(actor, id, financeQuery(request)) });
});
export const PATCH = withFinanceAuth("finance:manage", async (request, actor, context) => {
  const { id } = await context.params;
  return Response.json(updateObligation(actor, id, await financeJsonBody(request)));
});
