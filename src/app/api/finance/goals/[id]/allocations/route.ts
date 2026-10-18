import { setGoalAllocation } from "@/features/finance/goals";
import { financeJsonBody, withFinanceAuth } from "../../../_adapter";

export const runtime = "nodejs";

export const PUT = withFinanceAuth("finance:manage", async (request, actor, context) => {
  const { id } = await context.params;
  return Response.json(setGoalAllocation(actor, id, await financeJsonBody(request)));
});
