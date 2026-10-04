import { getPlan, updatePlan, cancelPlan } from "@/features/finance/planning";
import { withFinanceAuth, financeJsonBody, financeQuery } from "../../_adapter";
export const GET = withFinanceAuth("finance:read", async (request, actor, context) => Response.json({ plan: getPlan(actor, (await context.params).id, financeQuery(request)) }));
export const PATCH = withFinanceAuth("finance:write", async (request, actor, context) => Response.json(updatePlan(actor, (await context.params).id, await financeJsonBody(request))));
export const DELETE = withFinanceAuth("finance:write", async (request, actor, context) => Response.json(cancelPlan(actor, (await context.params).id, await financeJsonBody(request))));
