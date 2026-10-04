import { getActivityNoteLinks, setActivityNoteLinks } from "@/features/finance/note-links";
import { financeJsonBody, withFinanceAuth } from "../../../_adapter";

export const runtime = "nodejs";
export const GET = withFinanceAuth("finance:read", async (_request, actor, context) => {
  const { id } = await context.params;
  return Response.json(getActivityNoteLinks(actor, id));
});
export const PUT = withFinanceAuth("finance:write", async (request, actor, context) => {
  const { id } = await context.params;
  return Response.json(setActivityNoteLinks(actor, id, await financeJsonBody(request)));
});
