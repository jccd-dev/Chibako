import { catchUpPlans } from "@/features/finance/recurrence";
import { withFinanceAuth, financeJsonBody } from "../../_adapter";

export const POST = withFinanceAuth("finance:write", async (request, actor) => Response.json(catchUpPlans(actor, await financeJsonBody(request))));
