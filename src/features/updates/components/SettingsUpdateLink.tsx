"use client";

import { useId } from "react";
import Link from "next/link";
import { IconGear } from "@/components/icons";
import { cn } from "@/lib/utils";
import { useUpdates } from "../use-updates";

export function SettingsUpdateLink({ active }: { active: boolean }) {
  const { view } = useUpdates();
  const descriptionId = useId();
  const available = view?.state === "available" && view.operation?.phase !== "needs_attention";
  const description = available ? `Update available: v${view.latest?.version}` : undefined;

  return (
    <Link
      href="/app/settings"
      aria-label="Settings"
      aria-describedby={available ? descriptionId : undefined}
      title={description ? `Settings — ${description}` : "Settings"}
      className={cn(
        "relative grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
        active && "bg-accent text-foreground"
      )}
    >
      <IconGear size={16} />
      {available && <>
        <span aria-hidden="true" className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-primary" />
        <span id={descriptionId} className="sr-only">{description}</span>
      </>}
    </Link>
  );
}
