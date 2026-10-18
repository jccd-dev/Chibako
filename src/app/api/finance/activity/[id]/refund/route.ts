import { recordRefund } from "@/features/finance/corrections";
import { financeJsonBody, withFinanceAuth } from "../../../_adapter";

export const runtime = "nodejs";
export const POST = withFinanceAuth("finance:write", async (request, actor, context) => {
  const { id } = await context.params;
  return Response.json(recordRefund(actor, id, await financeJsonBody(request)), { status: 201 });
});
