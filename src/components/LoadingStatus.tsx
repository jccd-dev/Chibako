"use client";

import type { ReactNode } from "react";
import { Orb, type OrbState } from "@yogesharc/thinking-orbs";
import { cn } from "@/lib/utils";

export function ActivityOrb({ state = "working", size = 20, className }: {
  state?: OrbState;
  size?: number;
  className?: string;
}) {
  return <Orb state={state} size={size} className={cn("shrink-0 text-brand", className)} />;
}

export function LoadingStatus({ children, state, size, className }: {
  children: ReactNode;
  state?: OrbState;
  size?: number;
  className?: string;
}) {
  return (
    <span role="status" className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)}>
      <ActivityOrb state={state} size={size} />
      {children}
    </span>
  );
}
