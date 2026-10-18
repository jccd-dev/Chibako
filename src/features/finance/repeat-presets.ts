import type { FinanceSchedule } from "./recurrence-types";

export const repeatPresets = [
  { value: "daily", label: "Daily", count: 1, unit: "day" },
  { value: "weekly", label: "Weekly", count: 1, unit: "week" },
  { value: "biweekly", label: "Bi-weekly", count: 2, unit: "week" },
  { value: "bimonthly", label: "Every 2 months", count: 2, unit: "month" },
  { value: "monthly", label: "Monthly", count: 1, unit: "month" },
  { value: "quarterly", label: "Quarterly", count: 3, unit: "month" },
  { value: "yearly", label: "Yearly", count: 1, unit: "year" },
] as const;

export function repeatPreset(count: number, unit: FinanceSchedule["interval_unit"]): string {
  return repeatPresets.find(preset => preset.count === count && preset.unit === unit)?.value ?? "custom";
}
