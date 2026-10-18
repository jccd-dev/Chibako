import { moveGoalMoney } from "@/features/finance/goals";
import { financeJsonBody, withFinanceAuth } from "../../../_adapter";

export const runtime = "nodejs";

export const POST = withFinanceAuth("finance:manage", async (request, actor, context) => {
  const { id } = await context.params;
  return Response.json(moveGoalMoney(actor, id, await financeJsonBody(request)));
});
