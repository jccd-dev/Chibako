export function formatPHP(cents: number): string {
  const absolute = BigInt(cents < 0 ? -cents : cents);
  return `${cents < 0 ? "-" : ""}PHP ${new Intl.NumberFormat("en-PH").format(absolute / 100n)}.${String(absolute % 100n).padStart(2, "0")}`;
}

export function decimalPHP(cents: number): string {
  return `${cents < 0 ? "-" : ""}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;
}

export function allocationWarningText(result: { allocation_shortfalls?: { shortfall_cents: number }[] }): string {
  const shortfalls = result.allocation_shortfalls;
  return shortfalls?.length ? ` Goal allocation shortfall: ${shortfalls.map(row => formatPHP(row.shortfall_cents)).join("; ")}. Review goal reservations in Planning.` : "";
}

export function localCalendarDate(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export const financeSheet = "data-[side=right]:w-full gap-0 overflow-y-auto p-0 text-sm data-[side=right]:sm:max-w-md transition-none data-starting-style:translate-x-0 data-ending-style:translate-x-0 pb-[env(safe-area-inset-bottom)]";
