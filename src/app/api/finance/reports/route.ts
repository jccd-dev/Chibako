import { getFinanceReport } from "@/features/finance/budgets";
import { withFinanceAuth, financeQuery } from "../_adapter";
export const GET = withFinanceAuth("finance:read", async (request, actor) => Response.json(getFinanceReport(actor, financeQuery(request))));
