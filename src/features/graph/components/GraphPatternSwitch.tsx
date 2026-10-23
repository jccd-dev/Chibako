"use client";

import { cn } from "@/lib/utils";
import type { GraphPattern } from "@/features/graph/galaxy-style";

const OPTIONS: Array<{ value: GraphPattern; label: string }> = [
  { value: "galaxy", label: "Galaxy" },
  { value: "radial", label: "Radial" },
];

export function GraphPatternSwitch({ value, onChange }: { value: GraphPattern; onChange: (next: GraphPattern) => void }) {
  return (
    <div role="radiogroup" aria-label="Graph layout" className="flex overflow-hidden rounded-lg border border-border bg-popover text-xs">
      {OPTIONS.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            // Roving tabindex: arrow keys move between options like native radios.
            tabIndex={active ? 0 : -1}
            className={cn(
              "px-2.5 py-1.5 font-medium transition",
              active ? "bg-primary/12 text-primary" : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
              event.preventDefault();
              const next = OPTIONS[(OPTIONS.findIndex((o) => o.value === value) + 1) % OPTIONS.length];
              onChange(next.value);
              (event.currentTarget.parentElement?.querySelector(`[data-pattern="${next.value}"]`) as HTMLElement | null)?.focus();
            }}
            data-pattern={option.value}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
