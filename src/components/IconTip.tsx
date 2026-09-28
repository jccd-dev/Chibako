"use client";

import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Icon-only button with a themed tooltip (replaces bare `title` attrs). */
export function IconTip({
  label,
  kbd,
  onClick,
  className,
  children,
  active,
  expanded,
  destructive,
}: {
  label: string;
  kbd?: string;
  onClick?: () => void;
  className?: string;
  children: ReactNode;
  active?: boolean;
  expanded?: boolean;
  destructive?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={destructive ? "destructive" : "ghost"}
            size="icon"
            type="button"
            onClick={onClick}
            aria-label={label}
            aria-pressed={active}
            aria-expanded={expanded}
            className={cn("rounded-md bg-muted/60 hover:bg-muted", className)}
          >
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
