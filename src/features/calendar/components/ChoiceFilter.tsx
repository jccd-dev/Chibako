"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/** Multi-select chips for one select property; no chip pressed means any value. */
export function ChoiceFilter({ label, options, value, onChange }: {
  label: string;
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  // Off-list values from a URL stay visible so they can be cleared.
  const choices = [...options, ...value.filter((choice) => !options.includes(choice))];
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <ToggleGroup
        multiple
        variant="outline"
        size="sm"
        spacing={1}
        aria-label={`Filter by ${label.toLowerCase()}`}
        value={value}
        onValueChange={(next) => onChange(choices.filter((choice) => next.includes(choice)))}
        className="flex-wrap"
      >
        {choices.map((choice) => <ToggleGroupItem key={choice} value={choice}>{choice}</ToggleGroupItem>)}
      </ToggleGroup>
    </div>
  );
}
