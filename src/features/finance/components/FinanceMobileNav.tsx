"use client";

import Link from "next/link";
import {
  IconChartPie,
  IconCreditCard,
  IconHistory,
  IconLayoutDashboard,
  IconPlus,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { financeTabLabel, type FinanceTab } from "../finance-tabs";

// Manage stays in the sidebar sheet: five slots is the most a phone bar holds comfortably.
const left = [
  { tab: "overview", Icon: IconLayoutDashboard },
  { tab: "activity", Icon: IconHistory },
] as const;
const right = [
  { tab: "planning", Icon: IconChartPie },
  { tab: "accounts", Icon: IconCreditCard },
] as const;

const press =
  "transition-[transform,background-color,color] duration-150 ease-out active:scale-[0.97] motion-reduce:transition-none";

/** Floating bottom bar for phones: finance views plus an always-reachable Add transaction. */
export function FinanceMobileNav({ tab, onAdd }: { tab: FinanceTab; onAdd: () => void }) {
  const item = ({ tab: value, Icon }: (typeof left)[number] | (typeof right)[number]) => {
    const active = tab === value;
    return (
      <Link
        key={value}
        href={`/app/finance?tab=${value}`}
        scroll={false}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
          press,
          active ? "bg-background px-4 text-foreground dark:bg-foreground dark:text-background" : "text-background/70 hover:text-background dark:text-muted-foreground dark:hover:text-foreground",
        )}
      >
        <Icon className="size-5 shrink-0" aria-hidden="true" />
        <span className={active ? undefined : "sr-only"}>{financeTabLabel(value)}</span>
      </Link>
    );
  };
  return (
    <nav
      aria-label="Finance shortcuts"
      className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-md items-center justify-between rounded-full bg-foreground p-1.5 text-background shadow-xl shadow-black/25 md:hidden dark:bg-sidebar dark:text-foreground dark:ring-1 dark:ring-foreground/15"
    >
      {left.map(item)}
      <button
        type="button"
        aria-label="Add transaction"
        onClick={onAdd}
        className={cn(
          "grid size-12 place-items-center rounded-full bg-primary text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring",
          press,
        )}
      >
        <IconPlus className="size-5" aria-hidden="true" />
      </button>
      {right.map(item)}
    </nav>
  );
}
