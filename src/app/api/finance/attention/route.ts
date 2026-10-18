import { getFinanceAttention } from "@/features/finance/overview";
import { withFinanceAuth, financeQuery } from "../_adapter";

export const runtime = "nodejs";

export const GET = withFinanceAuth("finance:read", async (request, actor) => {
  return Response.json(getFinanceAttention(actor, financeQuery(request)));
});
