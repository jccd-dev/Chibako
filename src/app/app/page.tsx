import { requireAuth } from "@/lib/auth";
import { listNotes } from "@/lib/notes";
import { listBookmarks } from "@/lib/bookmarks";
import { getPropertyDefs } from "@/lib/properties";
import { getFinanceReport } from "@/features/finance/budgets";
import { getFinanceAttention, getFinanceOverview } from "@/features/finance/overview";
import { getVaultStats } from "@/features/graph/vault-stats";
import { memoryArea } from "@/features/memory/memory";
import { bookkeepingNoteIds } from "@/features/memory/session-memory";
import { HomeDashboard, type HomeFinance } from "@/features/home/components/HomeDashboard";
import type { HomeContext } from "@/features/home/home-summary";

/** Finance figures for Home; null when Finance is unused or unreadable, so Home still renders. */
function readFinance(): HomeFinance | null {
  try {
    const actor = { kind: "owner" } as const;
    const overview = getFinanceOverview(actor);
    if (!overview.money.account_count && !overview.assets.account_count && !overview.credit.account_count) return null;
    const attention = getFinanceAttention(actor, { limit: 3 });
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const report = getFinanceReport(actor, { date_from: `${month}-01`, date_to: `${month}-${lastDay}` });
    return {
      netCents: overview.money.balance_cents + overview.credit.balance_cents,
      spendableCents: overview.spendable_cents,
      owedToMeCents: overview.obligations.receivable_cents,
      debtCents: overview.obligations.debt_cents,
      monthIncomeCents: report.income_cents,
      monthSpendingCents: report.spending_cents,
      monthLimitCents: report.categories.reduce((sum, category) => sum + (category.budget_cents ?? 0), 0),
      attention: attention.items,
      attentionTotal: attention.total,
    };
  } catch (error) {
    console.error(error);
    return null;
  }
}

export default async function AppIndex() {
  await requireAuth();
  const { folders, links } = getVaultStats();
  const memoryFolder = memoryArea();
  const context: HomeContext = {
    statusOptions: getPropertyDefs().find((def) => def.name === "status" && def.type === "select")?.options ?? [],
    bookmarks: listBookmarks().map(({ note_id, label }) => ({ note_id, label })),
    memoryFolder,
    bookkeepingIds: memoryFolder ? [...bookkeepingNoteIds()] : [],
  };
  return <HomeDashboard notes={listNotes()} vault={{ folders, links }} finance={readFinance()} context={context} />;
}
