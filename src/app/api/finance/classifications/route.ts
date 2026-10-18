import { createClassification, listClassifications } from "@/features/finance/classifications";
import { financeJsonBody, financeQuery, withFinanceAuth } from "../_adapter";

export const runtime = "nodejs";
export const GET = withFinanceAuth("finance:read", async (request, actor) => Response.json(listClassifications(actor, financeQuery(request))));
export const POST = withFinanceAuth("finance:manage", async (request, actor) => Response.json(createClassification(actor, await financeJsonBody(request)), { status: 201 }));
