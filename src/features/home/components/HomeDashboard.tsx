"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Orb } from "@yogesharc/thinking-orbs";
import { NoteLink } from "@/components/NoteLink";
import type { NoteSummary } from "@/lib/notes";
import type { FinanceAttentionItem } from "@/features/finance/overview-types";
import { formatPHP } from "@/features/finance/presentation";
import { CompactMoney } from "@/features/finance/components/CompactMoney";
import { dateToNoteDate, noteDateToDate, type DatedNote } from "@/features/calendar/note-dates";
import { isTask } from "@/features/calendar/task-folder";
import { DatedNotesCalendar } from "@/features/calendar/components/DatedNotesCalendar";
import { TaskDrawer } from "@/features/calendar/components/TaskDrawer";
import { isDone, summarizeHome, type HomeContext } from "@/features/home/home-summary";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IconPlus, IconSearch } from "@/components/icons";
import { openCommandPalette } from "@/components/layout/CommandPalette";
import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";

export interface HomeFinance {
  netCents: number;
  spendableCents: number;
  owedToMeCents: number;
  debtCents: number;
  monthIncomeCents: number;
  monthSpendingCents: number;
  /** Sum of this month's category limits; 0 when none is set. */
  monthLimitCents: number;
  attention: FinanceAttentionItem[];
  attentionTotal: number;
}

const LIST_LIMIT = 5;
const row = "-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-md px-2 py-2 text-left text-sm outline-none transition-[background-color,transform] duration-150 ease-out hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.99]";
const ghostLink = buttonVariants({ variant: "ghost", size: "sm" });

const statusTones = ["bg-brand/40", "bg-brand/70", "bg-brand"];
const statusTone = (status: string, index: number) =>
  !status ? "bg-muted-foreground/40" : status.toLowerCase() === "done" ? "bg-success" : statusTones[index % statusTones.length];

const formatDay = (day: string, options: Intl.DateTimeFormatOptions) => noteDateToDate(day).toLocaleDateString("en-US", options);
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function greeting(hour: number) {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  return "Good evening";
}

const relativeTime = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
function timeAgo(seconds: number, now: Date) {
  const minutes = Math.round((seconds * 1000 - now.getTime()) / 60_000);
  if (Math.abs(minutes) < 60) return relativeTime.format(minutes, "minute");
  if (Math.abs(minutes) < 60 * 24) return relativeTime.format(Math.round(minutes / 60), "hour");
  return relativeTime.format(Math.round(minutes / (60 * 24)), "day");
}

const urgencyLabel = { overdue: "Overdue", due: "Due today", warning: "Review needed", upcoming: "Upcoming" } as const;

function Stat({ label, value, href, tone, detail }: { label: string; value: number; href: string; tone?: string; detail?: string }) {
  return (
    <Link href={href} className="flex flex-col gap-0.5 bg-card px-4 py-3 text-left outline-none transition-colors duration-150 hover:bg-accent focus-visible:bg-accent">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-xl font-semibold tabular-nums", value > 0 && tone)}>
        {value}
        {detail && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{detail}</span>}
      </span>
    </Link>
  );
}

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold tabular-nums">{children}</dd>
    </div>
  );
}

function NoteLinks({ items, empty }: { items: { id: string; title: string; sub: string; meta?: string }[]; empty: string }) {
  if (!items.length) return <p className="py-2 text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul>
      {items.map((item) => (
        <li key={item.id}>
          <NoteLink noteId={item.id} className={row}>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{item.title}</span>
              <span className="block truncate text-xs text-muted-foreground">{item.sub}</span>
            </span>
            {item.meta && <span className="shrink-0 text-xs text-muted-foreground">{item.meta}</span>}
          </NoteLink>
        </li>
      ))}
    </ul>
  );
}

function DatedRow({ note, today, onOpen }: { note: DatedNote; today: string; onOpen: (id: string) => void }) {
  const task = isTask(note);
  const done = task && isDone(note);
  const overdue = task && !done && note.endDate < today;
  const priority = String(note.properties.priority ?? "");
  const scheduledToday = note.date <= today && !overdue;
  return (
    <li>
      <button type="button" onClick={() => onOpen(note.id)} className={row}>
        <span
          aria-hidden="true"
          className={cn(
            "size-2.5 shrink-0 rounded-full border-[1.5px]",
            !task ? "border-transparent bg-muted-foreground/40"
              : done ? "border-success bg-success"
              : overdue ? "border-destructive" : "border-muted-foreground",
          )}
        />
        <span className={cn("min-w-0 flex-1 truncate font-medium", done && "text-muted-foreground line-through")}>
          {note.title}
          {done && <span className="sr-only"> (done)</span>}
        </span>
        {priority && !done && <Badge variant="outline">{priority}</Badge>}
        <span className={cn("max-w-[40%] shrink-0 truncate text-xs tabular-nums text-muted-foreground", overdue && "text-destructive")}>
          {scheduledToday
            ? note.folder || "Vault root"
            : overdue ? `Due ${formatDay(note.endDate, { month: "short", day: "numeric" })}`
            : formatDay(note.date, { weekday: "short", month: "short", day: "numeric" })}
        </span>
      </button>
    </li>
  );
}

/** Home: the day at a glance. Dates use the viewer's clock, so day-dependent cards render after hydration. */
export function HomeDashboard({ notes, vault, finance, context }: {
  notes: NoteSummary[];
  vault: { folders: number; links: number };
  finance: HomeFinance | null;
  context: HomeContext;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [now, setNow] = useState<Date | null>(null);
  if (hydrated && now === null) setNow(new Date());
  const [drawer, setDrawer] = useState({ open: false, noteId: null as string | null, key: 0 });
  const openNote = (noteId: string | null) => setDrawer((d) => ({ open: true, noteId, key: d.key + 1 }));

  useEffect(() => {
    // Re-read the vault and the clock: Home may sit open across edits elsewhere and past midnight.
    const onChange = () => { setNow(new Date()); router.refresh(); };
    window.addEventListener("chibako:notes-changed", onChange);
    window.addEventListener("focus", onChange);
    return () => {
      window.removeEventListener("chibako:notes-changed", onChange);
      window.removeEventListener("focus", onChange);
    };
  }, [router]);

  const today = now ? dateToNoteDate(now) : null;
  const summary = useMemo(() => (today ? summarizeHome(notes, today, context) : null), [notes, today, context]);

  if (!summary || !today || !now) {
    return (
      <div className="mx-auto max-w-[1600px] px-4 py-4 sm:px-6">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Welcome back</h1>
      </div>
    );
  }

  const agenda = [...summary.overdue, ...summary.today];
  const doneTasks = summary.tasks - summary.openTasks;
  const status = summary.overdue.length
    ? `${plural(summary.overdue.length, "overdue task")} waiting on you`
    : summary.dueToday ? `${plural(summary.dueToday, "task")} due today` : "Nothing due today";
  const limitPercent = finance?.monthLimitCents
    ? Math.min(100, Math.round((finance.monthSpendingCents / finance.monthLimitCents) * 100))
    : 0;

  return (
    <div className="mx-auto grid max-w-[1600px] min-w-0 gap-3 px-4 py-4 sm:px-6 md:grid-cols-2 xl:grid-cols-[20rem_minmax(0,1fr)_20rem]">
      <section aria-label="Today at a glance" className="flex min-w-0 flex-col gap-3 md:col-span-2 xl:col-span-1 xl:col-start-2 xl:row-start-1">
        <div className="flex flex-1 flex-col items-center justify-center gap-5 py-8 text-center">
          <Orb state="reasoning" speed={0.65} dotSize={0.8} size={220} className="size-40 text-brand sm:size-52 xl:size-60" />
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight">{greeting(now.getHours())}</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {formatDay(today, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
            </p>
          </div>
          <Badge variant="outline" className="h-auto gap-2 px-3 py-1 text-sm font-normal">
            <span aria-hidden="true" className={cn("size-1.5 rounded-full", summary.overdue.length ? "bg-destructive" : "bg-brand")} />
            {status}
          </Badge>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button onClick={() => openNote(null)}><IconPlus data-icon="inline-start" />New task</Button>
            <NoteLink noteId="new" className={buttonVariants({ variant: "outline" })}><IconPlus data-icon="inline-start" />New note</NoteLink>
            <Button variant="outline" onClick={openCommandPalette}><IconSearch data-icon="inline-start" />Search notes</Button>
          </div>
        </div>
        <Card size="sm" className="py-0">
          <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
            <Stat label="Due today" value={summary.dueToday} href={`/app/calendar?date=${today}&tasks=1`} tone="text-brand" />
            <Stat label="Overdue" value={summary.overdue.length} href="/app/tasks" tone="text-destructive" />
            <Stat label="Open tasks" value={summary.openTasks} href="/app/tasks" detail={`of ${summary.tasks}`} />
            <Stat label="Next 6 days" value={summary.upcoming.length} href="/app/calendar" />
          </div>
        </Card>
      </section>

      <div className="flex min-w-0 flex-col gap-3 xl:col-start-1 xl:row-start-1">
        <Card size="sm" className="flex-1">
          <CardHeader>
            <CardTitle>Today</CardTitle>
            <CardDescription>
              {summary.overdue.length ? `${plural(summary.today.length, "item")} today, ${summary.overdue.length} overdue` : plural(summary.today.length, "item")}
            </CardDescription>
            <CardAction><Link href="/app/tasks" className={ghostLink}>All tasks</Link></CardAction>
          </CardHeader>
          <CardContent>
            {agenda.length ? (
              <ul>
                {agenda.slice(0, LIST_LIMIT + 1).map((note) => <DatedRow key={note.id} note={note} today={today} onOpen={openNote} />)}
              </ul>
            ) : <p className="py-2 text-sm text-muted-foreground">Nothing scheduled today.</p>}
            {agenda.length > LIST_LIMIT + 1 && <p className="pt-2 text-muted-foreground">and {agenda.length - LIST_LIMIT - 1} more in Tasks</p>}
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle>Upcoming</CardTitle>
            <CardDescription>Starting in the next 6 days</CardDescription>
            <CardAction><Link href="/app/calendar" className={ghostLink}>Calendar</Link></CardAction>
          </CardHeader>
          <CardContent>
            {summary.upcoming.length ? (
              <ul>
                {summary.upcoming.slice(0, LIST_LIMIT).map((note) => <DatedRow key={note.id} note={note} today={today} onOpen={openNote} />)}
              </ul>
            ) : <p className="py-2 text-sm text-muted-foreground">Nothing scheduled yet.</p>}
            {summary.upcoming.length > LIST_LIMIT && <p className="pt-2 text-muted-foreground">and {summary.upcoming.length - LIST_LIMIT} more in Calendar</p>}
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle>Tasks by status</CardTitle>
            <CardDescription>{summary.tasks ? `${doneTasks} of ${summary.tasks} done` : "No tasks yet"}</CardDescription>
          </CardHeader>
          {summary.tasks > 0 && (
            <CardContent>
              <div aria-hidden="true" className="flex h-2 gap-px overflow-hidden rounded-sm bg-muted">
                {summary.statuses.map((group, index) => (
                  <div key={group.status} className={statusTone(group.status, index)} style={{ flexGrow: group.count }} />
                ))}
              </div>
              <ul className="mt-2">
                {summary.statuses.map((group, index) => (
                  <li key={group.status}>
                    <Link href={group.status ? `/app/tasks?status=${encodeURIComponent(group.status)}` : "/app/tasks"} className={cn(row, "py-1.5")}>
                      <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-sm", statusTone(group.status, index))} />
                      <span className="min-w-0 flex-1 truncate">{group.status || "No status"}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{group.count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          )}
        </Card>
      </div>

      <div className="flex min-w-0 flex-col gap-3 xl:col-start-3 xl:row-start-1">
        <Card size="sm">
          <CardHeader>
            <CardTitle>Calendar</CardTitle>
            <CardDescription>Pick a day to open it</CardDescription>
          </CardHeader>
          <CardContent>
            <DatedNotesCalendar compact notes={notes} selected={today} onSelect={(day) => router.push(`/app/calendar?date=${day}`)} />
          </CardContent>
        </Card>
        {finance && (
          <Card size="sm" className="flex-1">
            <CardHeader>
              <CardTitle className="text-2xl font-semibold tabular-nums"><CompactMoney cents={finance.netCents} /></CardTitle>
              <CardDescription>Net balance</CardDescription>
              <CardAction><Link href="/app/finance" className={ghostLink}>Finance</Link></CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <dl className="grid grid-cols-3 gap-3">
                <Figure label="Spendable"><CompactMoney cents={finance.spendableCents} /></Figure>
                <Figure label="Owed to me"><CompactMoney cents={finance.owedToMeCents} /></Figure>
                <Figure label="Debt"><CompactMoney cents={finance.debtCents} /></Figure>
              </dl>
              <div className="border-t border-border pt-3">
                <p className="mb-2 font-medium">This month</p>
                <dl className="grid grid-cols-3 gap-3">
                  <Figure label="Income"><CompactMoney cents={finance.monthIncomeCents} /></Figure>
                  <Figure label="Spent"><CompactMoney cents={finance.monthSpendingCents} /></Figure>
                  <Figure label="Limit">{finance.monthLimitCents ? <CompactMoney cents={finance.monthLimitCents} /> : "Not set"}</Figure>
                </dl>
                {finance.monthLimitCents > 0 && (
                  <div
                    role="progressbar"
                    aria-label="Spending against this month's limit"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={limitPercent}
                    className="mt-3 h-2 overflow-hidden rounded-sm bg-muted"
                  >
                    <div
                      className={cn("h-full", finance.monthSpendingCents > finance.monthLimitCents ? "bg-destructive" : "bg-primary")}
                      style={{ width: `${limitPercent}%` }}
                    />
                  </div>
                )}
              </div>
              {finance.attention.length > 0 && (
                <ul className="border-t border-border pt-2">
                  {finance.attention.map((item) => (
                    <li key={item.id}>
                      <Link href="/app/finance" className={row}>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{item.title}</span>
                          <span className={cn("block text-xs text-muted-foreground", item.urgency === "overdue" && "text-destructive")}>
                            {urgencyLabel[item.urgency]}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatPHP(item.amount_cents)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {finance.attentionTotal > finance.attention.length && (
                <p className="text-muted-foreground">and {finance.attentionTotal - finance.attention.length} more to review</p>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Pinned</CardTitle>
          <CardDescription>Pinned notes and bookmarks</CardDescription>
        </CardHeader>
        <CardContent>
          <NoteLinks
            items={summary.quick.slice(0, LIST_LIMIT).map((item) => ({ id: item.id, title: item.title, sub: item.folder || "Vault root" }))}
            empty="Pin or bookmark a note to keep it here."
          />
        </CardContent>
      </Card>

      <div className="grid min-w-0 gap-3 sm:grid-cols-2 md:order-last md:col-span-2 xl:order-none xl:col-span-1">
        <Card size="sm" className={cn(!summary.agent && "sm:col-span-2")}>
          <CardHeader>
            <CardTitle>Recent notes</CardTitle>
            <CardDescription>Your latest edits</CardDescription>
          </CardHeader>
          <CardContent>
            <NoteLinks
              items={summary.recent.map((note) => ({ id: note.id, title: note.title, sub: note.folder || "Vault root", meta: timeAgo(note.updated_at, now) }))}
              empty="No notes yet."
            />
          </CardContent>
        </Card>
        {summary.agent && (
          <Card size="sm">
            <CardHeader>
              <CardTitle>Agent activity</CardTitle>
              <CardDescription>Latest notes saved by your agents</CardDescription>
            </CardHeader>
            <CardContent>
              <NoteLinks
                items={summary.agent.map(({ note, project }) => ({ id: note.id, title: note.title, sub: project || "Shared", meta: timeAgo(note.updated_at, now) }))}
                empty="No agent notes yet."
              />
            </CardContent>
          </Card>
        )}
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Vault</CardTitle>
          <CardDescription>Your notes at a glance</CardDescription>
          <CardAction><Link href="/app/graph" className={ghostLink}>Open graph</Link></CardAction>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-3">
            <Figure label="Notes">{summary.notes}</Figure>
            <Figure label="Folders">{vault.folders}</Figure>
            <Figure label="Links">{vault.links}</Figure>
            <Figure label="New this week">{summary.createdThisWeek}</Figure>
          </dl>
        </CardContent>
      </Card>

      {drawer.key > 0 && (
        <TaskDrawer
          key={drawer.key}
          open={drawer.open}
          noteId={drawer.noteId}
          date={today}
          onOpenChange={(open) => setDrawer((d) => ({ ...d, open }))}
        />
      )}
    </div>
  );
}
