import { listTarsiImportSummaries } from "@/features/finance/import-read";
import { financeQuery, withFinanceAuth } from "../_adapter";

export const runtime = "nodejs";

export const GET = withFinanceAuth("finance:read", async (request, actor) => {
  return Response.json(listTarsiImportSummaries(actor, financeQuery(request)));
});
