import { formatPHP } from "./presentation";

const presets = [50000, 100000, 500000];

// Full and Half always lead; fixed presets only appear while they are below the remaining amount and not duplicates.
export function obligationQuickAmounts(outstandingCents: number): { label: string; cents: number }[] {
  if (!Number.isSafeInteger(outstandingCents) || outstandingCents <= 0) return [];
  const amounts = [{ label: "Full amount", cents: outstandingCents }];
  const half = Math.floor(outstandingCents / 2);
  if (half > 0) amounts.push({ label: "Half", cents: half });
  for (const cents of presets) if (cents < outstandingCents && cents !== half) amounts.push({ label: formatPHP(cents), cents });
  return amounts;
}
