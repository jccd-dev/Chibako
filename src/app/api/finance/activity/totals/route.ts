import { getActivityTotals } from "@/features/finance/activity";
import { financeQuery, withFinanceAuth } from "../../_adapter";

export const runtime = "nodejs";
export const GET = withFinanceAuth("finance:read", async (request, actor) => Response.json(getActivityTotals(actor, financeQuery(request))));
