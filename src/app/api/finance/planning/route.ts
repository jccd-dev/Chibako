import { listPlanning } from "@/features/finance/planning-list";
import { financeQuery, withFinanceAuth } from "../_adapter";

export const GET = withFinanceAuth("finance:read", async (request, actor) => Response.json(listPlanning(actor, financeQuery(request))));
