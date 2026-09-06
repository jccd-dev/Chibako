"use client";

import { Button } from "@/components/ui/button";
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
          <Button variant={className?.includes("btn-danger") ? "destructive" : "ghost"} size="icon" type="button" onClick={onClick} aria-label={label} aria-pressed={active}>
            {children}
          </Button>
        }
      />
      <TooltipContent>
        {label}
        {kbd && <span className="kbd">{kbd}</span>}
      </TooltipContent>
    </Tooltip>
  );
}
