export const financeTabs = [
  "overview",
  "activity",
  "planning",
  "accounts",
  "manage",
] as const;

export type FinanceTab = (typeof financeTabs)[number];

export const isFinanceTab = (value: string | undefined | null): value is FinanceTab =>
  financeTabs.some((tab) => tab === value);

export const financeTabLabel = (tab: FinanceTab): string =>
  tab === "activity" ? "History" : tab[0].toUpperCase() + tab.slice(1);
