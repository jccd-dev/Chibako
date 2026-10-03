import { getTransaction } from "@/features/finance/activity";
import { financeQuery, withFinanceAuth } from "../../_adapter";

export const runtime = "nodejs";
export const GET = withFinanceAuth("finance:read", async (request, actor, context) => {
  const { id } = await context.params;
  return Response.json({ transaction: getTransaction(actor, id, financeQuery(request)) });
});
