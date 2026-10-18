import { getObligationPaymentHistory } from "@/features/finance/obligations";
import { financeQuery, withFinanceAuth } from "../../../_adapter";

export const runtime = "nodejs";
export const GET = withFinanceAuth("finance:read", async (request, actor, context) => {
  const { id } = await context.params;
  return Response.json(getObligationPaymentHistory(actor, id, financeQuery(request)));
});
