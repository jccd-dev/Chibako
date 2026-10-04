import { createPlan, listPlans } from "@/features/finance/planning";
import { withFinanceAuth, financeJsonBody, financeQuery } from "../_adapter";
export const GET = withFinanceAuth("finance:read", async (request, actor) => Response.json(listPlans(actor, financeQuery(request))));
export const POST = withFinanceAuth("finance:write", async (request, actor) => Response.json(createPlan(actor, await financeJsonBody(request)), { status: 201 }));
