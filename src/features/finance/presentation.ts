export function formatPHP(cents: number): string {
  const absolute = BigInt(cents < 0 ? -cents : cents);
  return `${cents < 0 ? "-" : ""}PHP ${new Intl.NumberFormat("en-PH").format(absolute / 100n)}.${String(absolute % 100n).padStart(2, "0")}`;
}

export function decimalPHP(cents: number): string {
  return `${cents < 0 ? "-" : ""}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;
}

// Edit-input initializer: like decimalPHP, but never appends forced ".00"
// padding to a prefilled amount.
export function decimalPHPInput(cents: number): string {
  const text = decimalPHP(cents);
  const dot = text.indexOf(".");
  if (dot === -1) return text;
  const fraction = text.slice(dot + 1).replace(/0+$/, "");
  return fraction ? `${text.slice(0, dot + 1)}${fraction}` : text.slice(0, dot);
}

export function allocationWarningText(result: { allocation_shortfalls?: { shortfall_cents: number }[] }): string {
  const shortfalls = result.allocation_shortfalls;
  return shortfalls?.length ? ` Goal allocation shortfall: ${shortfalls.map(row => formatPHP(row.shortfall_cents)).join("; ")}. Review goal reservations in Planning.` : "";
}

const historyMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatHistoryDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  const month = match ? Number(match[2]) : 0;
  if (!match || month < 1 || month > 12) return iso;
  return `${historyMonths[month - 1]} ${Number(match[3])}, ${match[1]}`;
}

export function localCalendarDate(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export const financeSheet = "data-[side=right]:w-full gap-0 overflow-y-auto p-0 text-sm data-[side=right]:sm:max-w-md transition-none data-starting-style:translate-x-0 data-ending-style:translate-x-0";

export const financeDrawerFooter = "sticky bottom-0 -mx-4 mt-auto flex flex-wrap justify-end gap-2 border-t border-border bg-background px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:-mx-6 sm:px-6";
