import { updateClassification } from "@/features/finance/classifications";
import { financeJsonBody, withFinanceAuth } from "../../_adapter";

export const runtime = "nodejs";
export const PATCH = withFinanceAuth("finance:manage", async (request, actor, context) => {
  const { id } = await context.params;
  return Response.json(updateClassification(actor, id, await financeJsonBody(request)));
});
