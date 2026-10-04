"use client";

import { useEffect, useState } from "react";
import type { ActivityPage, FinanceTransaction } from "@/features/finance/activity-types";
import type { FinancePlan } from "@/features/finance/planning-types";
import type { FinancePlanningController } from "@/features/finance/use-finance-planning";
import { financeJson } from "@/features/finance/client-json";
import { financeControl as control, formatPHP as money } from "@/features/finance/presentation";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Field, FieldLabel } from "./ui/field";
import { Alert, AlertDescription } from "./ui/alert";

export function FinancePlanMatch({ plan, planning, onSaved }: { plan: FinancePlan; planning: FinancePlanningController; onSaved: () => void }) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<ActivityPage | null>(null);
  const [selected, setSelected] = useState<FinanceTransaction | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setPage(null); setSelected(null); setError("");
    const params = new URLSearchParams({ type: plan.type, matchable: "true", hidden: "all", include_details: "true", q: query, limit: "25", offset: String(offset) });
    void fetch(`/api/finance/activity?${params}`, { signal: abort.signal }).then(financeJson<ActivityPage>).then(result => { if (!abort.signal.aborted) setPage(result); })
      .catch(e => { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : "Could not load matching activity."); });
    return () => abort.abort();
  }, [plan.type, query, offset, reload]);
  return <section className="flex flex-col gap-4" aria-label="Match existing activity">
    <p className="text-sm text-muted-foreground">Select a manually recorded {plan.type}. Amount, account and date may differ from the plan. Already-linked activity, transfer fees and reverted mistakes are excluded.</p>
    <form onSubmit={event => { event.preventDefault(); setOffset(0); setQuery(search); setReload(value => value + 1); }} className="flex flex-col gap-3">
      <Field><FieldLabel htmlFor="plan-match-search">Search existing activity</FieldLabel><Input id="plan-match-search" maxLength={200} value={search} disabled={planning.busy} className={control} onChange={event => setSearch(event.target.value)} /></Field>
      <Button type="submit" variant="outline" className={`${control} self-start`} disabled={planning.busy}>Find activity</Button>
    </form>
    {error ? <Alert><AlertDescription>{error}<Button variant="outline" className={control} onClick={() => setReload(value => value + 1)}>Retry matching activity</Button></AlertDescription></Alert> : !page ? <p role="status">Loading existing activity…</p> : page.transactions.length ? <fieldset className="flex flex-col gap-2"><legend className="mb-2 text-sm font-medium">Choose one transaction</legend>
      {page.transactions.map(row => <label key={row.id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-border p-3 text-sm">
        <input type="radio" name="matched-activity" className="mt-1 size-4 shrink-0 accent-primary" disabled={planning.busy} checked={selected?.id === row.id} onChange={() => setSelected(row)} />
        <span className="min-w-0 break-words"><strong className="tabular-nums">{money(row.amount_cents)}</strong> · {row.transaction_date}<span className="block">{row.account_name} · {row.category_name ?? "Uncategorized"}{row.hidden ? " · Hidden" : ""}</span>{row.text && <span className="mt-1 block text-muted-foreground">{row.text}</span>}</span>
      </label>)}
    </fieldset> : <p className="text-sm text-muted-foreground">No eligible activity for this search. Record it in Activity first, or post from this plan.</p>}
    {page && page.total > 25 && <nav aria-label="Matching activity pages" className="flex flex-wrap items-center gap-3"><Button variant="outline" className={control} disabled={!offset || planning.busy} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous matches</Button><span className="text-sm">{offset + 1}-{Math.min(offset + 25, page.total)} of {page.total}</span><Button variant="outline" className={control} disabled={offset + 25 >= page.total || planning.busy} onClick={() => setOffset(offset + 25)}>Next matches</Button></nav>}
    {selected && <p className="text-sm">Confirm {money(selected.amount_cents)} on {selected.transaction_date} in {selected.account_name}. This satisfies the plan without moving money again. Delete preserves satisfaction; Revert reopens the plan.</p>}
    <Button className={control} disabled={!selected || planning.busy} onClick={() => { if (selected) void planning.save(plan.id, "match", { version: plan.version, transaction_id: selected.id, transaction_version: selected.version }).then(result => { if (result) onSaved(); }); }}>{planning.busy ? "Matching…" : "Confirm match (no cash movement)"}</Button>
  </section>;
}
