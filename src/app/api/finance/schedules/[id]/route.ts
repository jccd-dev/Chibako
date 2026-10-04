import { getSchedule, updateSchedule } from "@/features/finance/recurrence";
import { withFinanceAuth, financeJsonBody, financeQuery } from "../../_adapter";

export const GET = withFinanceAuth("finance:read", async (request, actor, context) => Response.json({ schedule: getSchedule(actor, (await context.params).id, financeQuery(request)) }));
export const PATCH = withFinanceAuth("finance:manage", async (request, actor, context) => Response.json(updateSchedule(actor, (await context.params).id, await financeJsonBody(request))));
