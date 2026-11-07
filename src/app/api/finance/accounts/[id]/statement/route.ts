import { confirmStatement } from "@/features/finance/statements";
import { financeJsonBody, withFinanceAuth } from "../../../_adapter";

export const runtime = "nodejs";
export const POST = withFinanceAuth("finance:write", async (request, actor, context) => {
  const { id } = await context.params;
  return Response.json(confirmStatement(actor, id, await financeJsonBody(request)));
});
