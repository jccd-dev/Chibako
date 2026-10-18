import { matchPlan } from "@/features/finance/planning";
import { withFinanceAuth, financeJsonBody } from "../../../_adapter";
export const POST = withFinanceAuth("finance:write", async (request, actor, context) => Response.json(matchPlan(actor, (await context.params).id, await financeJsonBody(request))));
