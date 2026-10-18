import { skipPlans } from "@/features/finance/recurrence";
import { withFinanceAuth, financeJsonBody } from "../../_adapter";

export const POST = withFinanceAuth("finance:write", async (request, actor) => Response.json(skipPlans(actor, await financeJsonBody(request))));
