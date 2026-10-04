import { createSchedule, listSchedules } from "@/features/finance/recurrence";
import { withFinanceAuth, financeJsonBody, financeQuery } from "../_adapter";

export const GET = withFinanceAuth("finance:read", async (request, actor) => Response.json(listSchedules(actor, financeQuery(request))));
export const POST = withFinanceAuth("finance:manage", async (request, actor) => Response.json(createSchedule(actor, await financeJsonBody(request)), { status: 201 }));
