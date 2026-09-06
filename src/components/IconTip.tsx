"use client";

import type { ReactNode } from "react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

/** Icon-only button with a themed tooltip (replaces bare `title` attrs). */
export function IconTip({
  label,
  kbd,
  onClick,
  className,
  children,
  active,
}: {
  label: string;
  kbd?: string;
  onClick?: () => void;
  className?: string;
  children: ReactNode;
  active?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button type="button" className={className ?? "btn"} onClick={onClick} aria-label={label} aria-pressed={active}>
            {children}
          </button>
        }
      />
      <TooltipContent>
        {label}
        {kbd && <span className="kbd">{kbd}</span>}
      </TooltipContent>
    </Tooltip>
  );
}
