import { getBudget, setBudget } from "@/features/finance/budgets";
import { withFinanceAuth, financeQuery, financeJsonBody } from "../_adapter";
export const GET = withFinanceAuth("finance:read", async (request, actor) => Response.json({ budget: getBudget(actor, financeQuery(request)) }));
export const PUT = withFinanceAuth("finance:manage", async (request, actor) => Response.json(setBudget(actor, await financeJsonBody(request))));
