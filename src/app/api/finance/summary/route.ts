import { getFinanceSummary } from "@/features/finance/accounts";
import { withFinanceAuth } from "../_adapter";

export const runtime = "nodejs";

export const GET = withFinanceAuth("finance:read", async (_request, actor) => {
  return Response.json(getFinanceSummary(actor));
});
