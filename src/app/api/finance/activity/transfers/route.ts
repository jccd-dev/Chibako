import { postTransfer } from "@/features/finance/movements";
import { financeJsonBody, withFinanceAuth } from "../../_adapter";

export const runtime = "nodejs";
export const POST = withFinanceAuth("finance:write", async (request, actor) => Response.json(postTransfer(actor, await financeJsonBody(request)), { status: 201 }));
