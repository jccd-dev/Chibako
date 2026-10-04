import { getFinanceNoteChoices } from "@/features/finance/note-links";
import { financeQuery, withFinanceAuth } from "../_adapter";

export const runtime = "nodejs";
export const GET = withFinanceAuth("finance:read", async (request, actor) => Response.json(getFinanceNoteChoices(actor, financeQuery(request))));
