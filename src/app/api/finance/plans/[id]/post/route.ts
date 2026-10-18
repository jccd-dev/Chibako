import { postPlan } from "@/features/finance/planning";
import { withFinanceAuth, financeJsonBody } from "../../../_adapter";
export const POST = withFinanceAuth("finance:write", async (request, actor, context) => Response.json(postPlan(actor, (await context.params).id, await financeJsonBody(request))));
