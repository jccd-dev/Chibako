import { getTransaction } from "@/features/finance/activity";
import { correctActivity, hideActivity } from "@/features/finance/corrections";
import { financeJsonBody, financeQuery, withFinanceAuth } from "../../_adapter";

export const runtime = "nodejs";
export const GET = withFinanceAuth("finance:read", async (request, actor, context) => {
  const { id } = await context.params;
  return Response.json({ transaction: getTransaction(actor, id, financeQuery(request)) });
});
export const PATCH = withFinanceAuth("finance:write", async (request, actor, context) => {
  const { id } = await context.params;
  return Response.json(correctActivity(actor, id, await financeJsonBody(request)));
});
export const DELETE = withFinanceAuth("finance:write", async (request, actor, context) => {
  const { id } = await context.params;
  return Response.json(hideActivity(actor, id, await financeJsonBody(request)));
});
