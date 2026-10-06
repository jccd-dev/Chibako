import { createObligation, listObligations } from "@/features/finance/obligations";
import { financeJsonBody, financeQuery, withFinanceAuth } from "../_adapter";

export const runtime = "nodejs";
export const GET = withFinanceAuth("finance:read", async (request, actor) => Response.json(listObligations(actor, financeQuery(request))));
export const POST = withFinanceAuth("finance:manage", async (request, actor) => Response.json(createObligation(actor, await financeJsonBody(request)), { status: 201 }));
