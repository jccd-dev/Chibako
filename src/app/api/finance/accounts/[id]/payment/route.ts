import { recordCardPayment } from "@/features/finance/card-payments";
import { financeJsonBody, withFinanceAuth } from "../../../_adapter";

export const runtime = "nodejs";
export const POST = withFinanceAuth("finance:write", async (request, actor, context) => {
  const { id } = await context.params;
  return Response.json(recordCardPayment(actor, id, await financeJsonBody(request)));
});
