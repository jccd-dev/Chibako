import { postObligationPayment } from "@/features/finance/obligations";
import { financeJsonBody, withFinanceAuth } from "../../_adapter";

export const runtime = "nodejs";
export const POST = withFinanceAuth("finance:write", async (request, actor) =>
  Response.json(postObligationPayment(actor, await financeJsonBody(request)), { status: 201 }));
