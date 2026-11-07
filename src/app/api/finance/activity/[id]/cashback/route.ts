import { applyCashback, unapplyCashback } from "@/features/finance/cashbacks";
import { financeJsonBody, withFinanceAuth } from "../../../_adapter";

export const runtime = "nodejs";
export const POST = withFinanceAuth("finance:write", async (request, actor, context) => {
  const { id } = await context.params;
  return Response.json(applyCashback(actor, id, await financeJsonBody(request)));
});
export const DELETE = withFinanceAuth("finance:write", async (request, actor, context) => {
  const { id } = await context.params;
  return Response.json(unapplyCashback(actor, id, await financeJsonBody(request)));
});
