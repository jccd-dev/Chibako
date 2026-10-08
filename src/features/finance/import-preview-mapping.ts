import { decimalCents, exactCents } from "./money";
import { FinanceError } from "./types";
import { isCalendarDay, isSourceObject } from "./import-source-format";
import type { TarsiProposalRecord } from "./import-preview-types";

export function mapTarsiRecord(collection: string, source: Record<string, unknown>, path: string): TarsiProposalRecord {
  // Retain source metadata and relationships alongside normalized finance values.
  const target: Record<string, unknown> = { ...source };
  const effects: TarsiProposalRecord["effects"] = [];
  function invalid(message: string): never { throw new FinanceError(message, 400, "unresolved_mapping"); }
  const text = (field: string, required = false) => {
    const value = source[field];
    if (value === undefined || value === null) return required ? invalid(`${field} is required.`) : null;
    if (typeof value !== "string" || (required && !value.trim())) return invalid(`${field} must be text${required ? " and nonempty" : ""}.`);
    return value;
  };
  const cents = (field: string, signed = false, optional = false) => {
    const value = source[field];
    if (optional && (value === undefined || value === null)) return null;
    const decimal = typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "string" ? value : "";
    if (decimal.length > 32 || !/^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(decimal)) return invalid(`${field} must be an exact amount with at most two decimals.`);
    const amount = decimalCents(decimal);
    if (!signed && amount < 0) return invalid(`${field} cannot be negative.`);
    return amount;
  };
  const positiveAmount = () => {
    const amount = cents("amount")!;
    if (amount <= 0) invalid("Historical cash amounts must be positive.");
    return amount;
  };
  const effect = (field: string, amount: number) => effects.push({ account_id: text(field, true)!, amount_cents: amount });
  // Nested progress history is retained, never replayed as new cash activity.
  for (const field of ["contributions", "borrowings", "payments", "advances", "collections", "mutualOffsets"]) {
    if (source[field] === undefined) continue;
    const history = source[field];
    if (!Array.isArray(history)) invalid(`${field} must be a history array.`);
    const ids = new Set<string>();
    for (const row of history) {
      if (!isSourceObject(row) || typeof row.id !== "string" || !row.id || row.id.length > 128 || ids.has(row.id)) invalid(`${field} requires unique source IDs.`);
      ids.add(row.id);
      const amount = typeof row.amount === "number" ? String(row.amount) : row.amount;
      if (typeof amount !== "string" || amount.length > 32 || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(amount)) invalid(`${field} history requires cent-exact nonnegative amounts.`);
      decimalCents(amount);
      if (typeof row.date !== "string" || !isCalendarDay(row.date)) invalid(`${field} history needs an explicit calendar date.`);
    }
  }
  switch (collection) {
    case "accounts":
      if (source.type !== "debit" && source.type !== "asset") invalid("Account type needs an explicit money/asset mapping.");
      Object.assign(target, { kind: source.type === "asset" ? "asset" : "money", name: text("name", true), currency: text("currency", true), snapshot_cents: cents("balance", true) });
      break;
    case "expenses":
    case "incomes": {
      if (source.planned !== undefined && typeof source.planned !== "boolean") invalid("planned must be a boolean.");
      const amount = positiveAmount();
      Object.assign(target, { kind: collection === "expenses" ? "expense" : "income", amount_cents: amount, account_id: text("accountId", true), transaction_date: text("date", true), category_id: text("category"), subcategory_id: text("subcategoryId"), tag_id: text("tagId"), text: text("note"), schedule_id: text(collection === "expenses" ? "recurringExpenseId" : "recurringIncomeId"), status: source.planned === true ? "pending" : "posted" });
      if (source.planned !== true) effect("accountId", collection === "expenses" ? -amount : amount);
      break;
    }
    case "transfers": {
      const amount = positiveAmount();
      if (source.fromAccountId === source.toAccountId) invalid("A transfer requires two distinct accounts.");
      Object.assign(target, { kind: "transfer", amount_cents: amount, from_account_id: text("fromAccountId", true), to_account_id: text("toAccountId", true), transaction_date: text("date", true), text: text("note") });
      effect("fromAccountId", -amount); effect("toAccountId", amount);
      break;
    }
    case "balanceAdjustments": {
      const delta = exactCents(BigInt(cents("nextBalance", true)!) - BigInt(cents("previousBalance", true)!));
      Object.assign(target, { kind: "adjustment", account_id: text("accountId", true), amount_cents: delta, transaction_date: text("date", true), source_kind: text("kind") });
      effect("accountId", delta);
      break;
    }
    case "recurringExpenses":
    case "recurringIncomes": {
      const units: Record<string, string> = { daily: "day", weekly: "week", monthly: "month", yearly: "year" };
      const interval = text("interval", true)!;
      if (!Object.hasOwn(units, interval)) invalid("Recurring interval requires review; no frequency is inferred.");
      Object.assign(target, { kind: collection === "recurringExpenses" ? "expense" : "income", amount_cents: positiveAmount(), account_id: text("accountId", true), interval_count: 1, interval_unit: units[interval], start_date: text("nextDueDate", true), end_date: text("endDate"), category_id: text("category"), subcategory_id: text("subcategoryId"), text: text("note"), paused: true });
      for (const field of ["paymentMode", "endCondition", "maxPayments", "targetAmount"]) if (source[field] !== undefined && source[field] !== null) target[field] = source[field];
      if (source.maxPayments !== undefined && source.maxPayments !== null && (!Number.isSafeInteger(source.maxPayments) || Number(source.maxPayments) < 1)) invalid("Recurring payment limit requires a positive integer.");
      cents("targetAmount", false, true);
      break;
    }
    case "goals": {
      const progress = cents("currentAmount")!;
      const account = text("linkedAccountId");
      Object.assign(target, { kind: "goal", currency: text("currency", true), name: text("title", true), target_cents: cents("targetAmount"), starting_progress_cents: progress, due_date: text("targetDate"), text: text("notes"), allocations: progress > 0 && account ? [{ account_id: account, amount_cents: progress }] : [] });
      if (progress > 0 && !account) invalid("Saved goal progress needs an explicit money-account allocation.");
      cents("startingAmount", false, true);
      break;
    }
    case "debts":
    case "receivables": {
      const principal = cents("totalAmount")!;
      const progress = cents(collection === "debts" ? "paidAmount" : "collectedAmount")!;
      if (progress > principal) invalid("Paid/collected starting progress exceeds principal.");
      Object.assign(target, { kind: collection === "debts" ? "debt" : "receivable", currency: text("currency", true), name: text("name", true), opening_principal_cents: principal, starting_progress_cents: progress, outstanding_cents: principal - progress, due_date: text("dueDate"), text: text("notes") });
      for (const field of ["startingTotalAmount", "startingPaidAmount", "startingCollectedAmount"]) cents(field, false, true);
      if (source.closedAt && progress < principal) invalid("Closed outstanding obligation requires an explicit write-off mapping.");
      break;
    }
    case "customCategories":
    case "customIncomeCategories":
    case "customSubcategories":
      Object.assign(target, { kind: "category", type: collection === "customIncomeCategories" || source.parentCategoryKind === "income" ? "income" : "expense", name: text("label", true), parent_id: text("parentCategoryId", collection === "customSubcategories") });
      if (collection === "customSubcategories" && !["income", "expense"].includes(String(source.parentCategoryKind))) invalid("Subcategory kind requires an explicit mapping.");
      break;
    default:
      Object.assign(target, { kind: collection === "tags" ? "tag" : collection, name: text("name", true) });
  }
  return { collection, source_id: text("id", true)!, path, status: "accepted", source, target, effects };
}
