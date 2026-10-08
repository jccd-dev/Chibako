export const sourceFields: Record<string, readonly string[]> = {
  accounts: ["id", "name", "balance", "currency", "type", "accountGroupId", "linkedGoalId", "archivedAt", "createdAt"],
  accountGroups: ["id", "name", "createdAt"],
  expenses: ["id", "amount", "category", "subcategoryId", "note", "date", "createdAt", "accountId", "planned", "recurringExpenseId", "recurringDueDate"],
  incomes: ["id", "amount", "category", "tagId", "note", "date", "createdAt", "accountId", "planned", "recurringIncomeId"],
  transfers: ["id", "amount", "fromAccountId", "toAccountId", "date", "createdAt", "note"],
  balanceAdjustments: ["id", "accountId", "currency", "previousBalance", "nextBalance", "kind", "date", "createdAt"],
  recurringExpenses: ["id", "amount", "category", "subcategoryId", "note", "accountId", "interval", "paymentMode", "nextDueDate", "endCondition", "endDate", "maxPayments", "targetAmount", "lastCreatedDate", "createdAt"],
  recurringIncomes: ["id", "amount", "category", "note", "accountId", "interval", "paymentMode", "nextDueDate", "endDate", "lastCreatedDate", "createdAt"],
  goals: ["id", "title", "currency", "targetAmount", "startingAmount", "currentAmount", "linkedAccountId", "contributions", "targetDate", "notes", "createdAt"],
  debts: ["id", "name", "contactId", "creditorType", "currency", "totalAmount", "startingTotalAmount", "startingPaidAmount", "paidAmount", "closedAt", "borrowings", "payments", "mutualOffsets", "dueDate", "createdAt"],
  receivables: ["id", "name", "contactId", "debtorType", "currency", "totalAmount", "startingTotalAmount", "startingCollectedAmount", "collectedAmount", "closedAt", "advances", "collections", "mutualOffsets", "notes", "accountId", "dueDate", "createdAt"],
  tags: ["id", "name", "kind", "status", "startedAt", "endedAt", "createdAt", "updatedAt"],
  customCategories: ["id", "label"],
  customIncomeCategories: ["id", "label"],
  customSubcategories: ["id", "parentCategoryId", "parentCategoryKind", "label"],
  sharedBalanceContacts: ["id", "name", "createdAt", "updatedAt"],
};

export const referenceCollections: Record<string, string> = {
  accountId: "accounts", fromAccountId: "accounts", toAccountId: "accounts", linkedAccountId: "accounts", goalAccountId: "accounts",
  accountGroupId: "accountGroups", linkedGoalId: "goals", contactId: "sharedBalanceContacts", tagId: "tags",
  subcategoryId: "customSubcategories", recurringExpenseId: "recurringExpenses", recurringIncomeId: "recurringIncomes",
  cashbackIncomeId: "incomes", cashbackExpenseId: "expenses", feeExpenseId: "expenses",
};

export const requiredSourceFields: Record<string, readonly string[]> = {
  accounts: ["currency"], expenses: ["accountId", "date"], incomes: ["accountId", "date"],
  transfers: ["fromAccountId", "toAccountId", "date"], balanceAdjustments: ["accountId", "currency", "date"],
  recurringExpenses: ["accountId", "nextDueDate"], recurringIncomes: ["accountId", "nextDueDate"],
  goals: ["currency"], debts: ["currency"], receivables: ["currency"],
};

export function isSourceObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

export function isSourceTimestamp(value: string): boolean {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/);
  return !!match && isCalendarDay(match[1]) && Number(match[2]) < 24 && Number(match[3]) < 60 && Number(match[4]) < 60
    && (!match[5] || (Number(match[5]) < 24 && Number(match[6]) < 60)) && Number.isFinite(Date.parse(value));
}
