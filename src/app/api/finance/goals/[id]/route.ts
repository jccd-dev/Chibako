import { getGoal, updateGoal } from "@/features/finance/goals";
import { financeJsonBody, withFinanceAuth } from "../../_adapter";

export const runtime = "nodejs";

export const GET = withFinanceAuth("finance:read", async (_request, actor, context) => {
  const { id } = await context.params;
  return Response.json({ goal: getGoal(actor, id) });
});

export const PATCH = withFinanceAuth("finance:manage", async (request, actor, context) => {
  const { id } = await context.params;
  return Response.json(updateGoal(actor, id, await financeJsonBody(request)));
});
