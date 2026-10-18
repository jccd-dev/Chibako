import { postTransaction, listTransactions } from "@/features/finance/activity";
import { financeJsonBody, financeQuery, withFinanceAuth } from "../_adapter";

export const runtime = "nodejs";
export const GET = withFinanceAuth("finance:read", async (request, actor) => Response.json(listTransactions(actor, financeQuery(request))));
export const POST = withFinanceAuth("finance:write", async (request, actor) => Response.json(postTransaction(actor, await financeJsonBody(request)), { status: 201 }));
