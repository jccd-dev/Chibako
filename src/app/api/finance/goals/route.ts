import { createGoal, listGoals } from "@/features/finance/goals";
import { financeJsonBody, financeQuery, withFinanceAuth } from "../_adapter";

export const runtime = "nodejs";

export const GET = withFinanceAuth("finance:read", async (request, actor) => Response.json(listGoals(actor, financeQuery(request))));

export const POST = withFinanceAuth("finance:manage", async (request, actor) => {
  return Response.json(createGoal(actor, await financeJsonBody(request)), { status: 201 });
});
