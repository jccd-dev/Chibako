import { getFinanceOverview } from "@/features/finance/overview";
import { withFinanceAuth } from "../_adapter";

export const runtime = "nodejs";

export const GET = withFinanceAuth("finance:read", async (_request, actor) => {
  return Response.json(getFinanceOverview(actor));
});
