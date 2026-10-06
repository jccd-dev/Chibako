import { listGoalAccounts } from "@/features/finance/goals";
import { financeQuery, withFinanceAuth } from "../../_adapter";

export const runtime = "nodejs";

export const GET = withFinanceAuth("finance:read", async (request, actor) => Response.json(listGoalAccounts(actor, financeQuery(request))));
