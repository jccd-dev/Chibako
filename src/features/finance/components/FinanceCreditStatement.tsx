"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "cn";
import type { FinanceAccount } from "../types";
import { formatHistoryDate, formatPHP } from "../presentation";
import { useFinanceCreditCycles } from "../use-finance-credit-cycles";
import { FinanceCreditPayment } from "./FinanceCreditPayment";

function CreditCycles({ account, onSaved }: { account: FinanceAccount; onSaved: () => void }) {
  const { data, error, reload } = useFinanceCreditCycles(account.id);
  const [picked, setPicked] = useState<string | null>(null);
  if (error && !data) return <Alert><AlertDescription>{error} <Button type="button" variant="link" onClick={reload}>Retry</Button></AlertDescription></Alert>;
  if (!data) return <p role="status" className="text-sm text-muted-foreground">Loading statements…</p>;
  const cycles = [...data.cycles].sort((a, b) => b.statement_date.localeCompare(a.statement_date));
  const oldestUnpaid = [...cycles].reverse().find(c => c.status === "closed" && c.remaining_due_cents > 0);
  const selected = cycles.find(c => c.statement_date === picked) ?? oldestUnpaid ?? cycles[0];
  const olderUnpaid = selected ? cycles.filter(c => c.status === "closed" && c.statement_date < selected.statement_date).reduce((sum, c) => sum + c.remaining_due_cents, 0) : 0;
  const includedThrough = selected ? cycles.filter(c => c.confirmed && c.statement_date <= selected.statement_date).map(c => c.statement_date).sort().pop() ?? null : null;
  return <div className="flex flex-col gap-3">
    {error && <Alert><AlertDescription>{error}</AlertDescription></Alert>}
    <ul className="flex flex-col gap-2" aria-label="Statement cycles">
      {cycles.map(cycle => <li key={cycle.statement_date}>
        <button type="button" aria-pressed={cycle === selected} onClick={() => setPicked(cycle.statement_date)}
          className={cn("flex min-h-11 w-full flex-col gap-0.5 rounded-md border p-3 text-left text-sm", cycle === selected ? "border-primary" : "border-border")}>
          <span className="flex justify-between gap-2 font-medium">
            <span>{cycle.status === "upcoming" ? "Upcoming" : cycle.confirmed ? "Confirmed" : "Estimated"} · cutoff {formatHistoryDate(cycle.statement_date)}</span>
            <span className="tabular-nums">{formatPHP(cycle.remaining_due_cents)}</span>
          </span>
          <span className="text-xs text-muted-foreground">
            {cycle.cycle_start ? `${formatHistoryDate(cycle.cycle_start)} – ${formatHistoryDate(cycle.statement_date)}` : `Through ${formatHistoryDate(cycle.statement_date)}`} · SOA issued {formatHistoryDate(cycle.soa_date)}
            {cycle.due_date ? ` · due ${formatHistoryDate(cycle.due_date)}` : ""} · statement total incl. carried balance {formatPHP(cycle.balance_cents)}
            {cycle.remaining_minimum_cents !== null ? ` · minimum left ${formatPHP(cycle.remaining_minimum_cents)}` : ""}
          </span>
        </button>
      </li>)}
    </ul>
    {selected && <FinanceCreditPayment key={`${selected.statement_date}:${account.version}`} card={account} cycle={selected} olderUnpaidCents={olderUnpaid} includedThroughDate={includedThrough}
      cash={data.accounts} rewards={data.rewards} onSaved={() => { reload(); onSaved(); }} />}
  </div>;
}

export function FinanceCreditStatement({ account, onSaved }: { account: FinanceAccount; onSaved: () => void }) {
  return <section aria-label="Credit card statement" className="flex flex-col gap-4 border-t border-border pt-4">
    <div>
      <h3 className="text-sm font-semibold">{account.statement_confirmed ? "Confirmed statement" : "Estimated statement"}</h3>
      <p className="text-sm text-muted-foreground">Remaining balance {formatPHP(account.remaining_due_cents ?? 0)}{account.remaining_minimum_cents !== null ? ` · Minimum remaining ${formatPHP(account.remaining_minimum_cents)}` : ""}</p>
      {account.statement_difference_cents !== null && <p className="text-sm text-muted-foreground">Bank balance minus estimate: {formatPHP(account.statement_difference_cents)}</p>}
    </div>
    <CreditCycles account={account} onSaved={onSaved} />
  </section>;
}
