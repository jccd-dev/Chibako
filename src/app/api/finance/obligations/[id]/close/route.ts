import { closeObligation } from "@/features/finance/obligations";
import { financeJsonBody, withFinanceAuth } from "../../../_adapter";

export const runtime = "nodejs";
export const POST = withFinanceAuth("finance:manage", async (request, actor, context) => {
  const { id } = await context.params;
  return Response.json(closeObligation(actor, id, await financeJsonBody(request)));
});
