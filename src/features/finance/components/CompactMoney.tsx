"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatCompactPHP, formatPHP } from "../presentation";

export function CompactMoney({ cents, className }: { cents: number; className?: string }) {
  const compact = formatCompactPHP(cents);
  const exact = formatPHP(cents);

  if (compact === exact) return <span className={className}>{exact}</span>;

  return (
    <Popover>
      <PopoverTrigger
        type="button"
        openOnHover
        className={className}
        aria-label={`${exact}, show exact amount`}
      >
        {compact}
      </PopoverTrigger>
      <PopoverContent className="w-auto tabular-nums" aria-label="Exact amount">
        {exact}
      </PopoverContent>
    </Popover>
  );
}
