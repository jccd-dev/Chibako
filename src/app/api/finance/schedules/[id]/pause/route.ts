import { pauseSchedule } from "@/features/finance/recurrence";
import { withFinanceAuth, financeJsonBody } from "../../../_adapter";

export const POST = withFinanceAuth("finance:manage", async (request, actor, context) => Response.json(pauseSchedule(actor, (await context.params).id, await financeJsonBody(request))));
