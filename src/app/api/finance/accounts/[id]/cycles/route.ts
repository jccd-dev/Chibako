import { getCardPaymentOptions } from "@/features/finance/card-payments";
import { withFinanceAuth } from "../../../_adapter";

export const runtime = "nodejs";
export const GET = withFinanceAuth("finance:read", async (_request, actor, context) => {
  const { id } = await context.params;
  return Response.json(getCardPaymentOptions(actor, id));
});
