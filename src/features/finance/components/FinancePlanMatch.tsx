"use client";

import { useEffect, useState } from "react";
import type { ActivityPage, FinanceTransaction } from "@/features/finance/activity-types";
import type { FinancePlan } from "@/features/finance/planning-types";
import type { FinanceObligation } from "@/features/finance/obligation-types";
import type { FinancePlanningController } from "@/features/finance/use-finance-planning";
import { financeJson } from "@/features/finance/client-json";
import { formatPHP as money } from "@/features/finance/presentation";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function FinancePlanMatch({ plan, planning, obligation, onSaved }: { plan: FinancePlan; planning: FinancePlanningController; obligation: FinanceObligation | null; onSaved: () => void }) {
  const linked = !!plan.obligation_id;
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<{ key: string; value: ActivityPage } | null>(null);
  const [selected, setSelected] = useState<{ key: string; value: FinanceTransaction } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [reload, setReload] = useState(0);
  const requestKey = `${plan.id}:${plan.type}:${plan.obligation_id ?? ""}:${query}:${offset}:${reload}`;
  const visiblePage = page?.key === requestKey ? page.value : null;
  const visibleSelected = selected?.key === requestKey ? selected.value : null;
  const visibleError = error?.key === requestKey ? error.message : "";
  useEffect(() => {
    const abort = new AbortController();
    const params = new URLSearchParams({ type: plan.type, hidden: linked ? "false" : "all", include_details: "true", q: query, limit: "25", offset: String(offset) });
    if (linked) params.set("obligation_id", plan.obligation_id!);
    else params.set("matchable", "true");
    void fetch(`/api/finance/activity?${params}`, { signal: abort.signal }).then(financeJson<ActivityPage>).then(result => {
      if (!abort.signal.aborted) { if (linked) result.transactions = result.transactions.filter(row => row.obligation_payment === true); setPage({ key: requestKey, value: result }); }
    })
      .catch(e => { if (!abort.signal.aborted) setError({ key: requestKey, message: e instanceof Error ? e.message : "Could not load matching activity." }); });
    return () => abort.abort();
  }, [plan.obligation_id, plan.type, linked, query, offset, reload, requestKey]);
  return <section className="flex flex-col gap-4" aria-label={linked ? "Match recorded principal payment" : "Match existing activity"}>
    <p className="text-sm text-muted-foreground">{linked ? `Review an already recorded principal payment of this obligation. Cash stays as recorded; matching only satisfies this occurrence and keeps principal progress unchanged.` : `Select a manually recorded ${plan.type}. Amount, account and date may differ from the plan. Already-linked activity, transfer fees and reverted mistakes are excluded.`}</p>
    <form onSubmit={event => { event.preventDefault(); setOffset(0); setQuery(search); setReload(value => value + 1); }} className="flex flex-col gap-3">
      <Field><FieldLabel htmlFor="plan-match-search">Search existing activity</FieldLabel><Input id="plan-match-search" maxLength={200} value={search} disabled={planning.busy} onChange={event => setSearch(event.target.value)} /></Field>
      <Button type="submit" variant="outline" className="self-start" disabled={planning.busy}>Find activity</Button>
    </form>
    {visibleError ? <Alert><AlertDescription>{visibleError}<Button variant="outline" onClick={() => setReload(value => value + 1)}>Retry matching activity</Button></AlertDescription></Alert> : !visiblePage ? <p role="status">Loading existing activity…</p> : visiblePage.transactions.length ? <fieldset className="flex flex-col gap-2"><legend className="mb-2 text-sm font-medium">Choose one transaction</legend><RadioGroup aria-label="Choose one transaction" name="matched-activity" value={visibleSelected?.id ?? ""} disabled={planning.busy} onValueChange={value => { const row = visiblePage.transactions.find(item => item.id === value); if (row) setSelected({ key: requestKey, value: row }); }}>
      {visiblePage.transactions.map(row => <label key={row.id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-border p-3 text-sm">
        <RadioGroupItem value={row.id} className="mt-1" />
        <span className="min-w-0 break-words"><strong className="tabular-nums">{money(row.amount_cents)}</strong> · {row.transaction_date}<span className="block">{row.account_name} · {row.category_name ?? "Uncategorized"}{row.hidden ? " · Hidden" : ""}</span>{row.text && <span className="mt-1 block text-muted-foreground">{row.text}</span>}</span>
      </label>)}
    </RadioGroup></fieldset> : <p className="text-sm text-muted-foreground">{linked ? "No recorded principal payment of this obligation is left to link. Record it via Post actual payment or this obligation's payment flow." : `No eligible activity for this search. Record it in Activity first, or post from this plan.`}</p>}
    {visiblePage && visiblePage.total > 25 && <nav aria-label="Matching activity pages" className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={!offset || planning.busy} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous matches</Button><span className="text-sm">{offset + 1}-{Math.min(offset + 25, visiblePage.total)} of {visiblePage.total}</span><Button variant="outline" disabled={offset + 25 >= visiblePage.total || planning.busy} onClick={() => setOffset(offset + 25)}>Next matches</Button></nav>}
    {visibleSelected && <p className="text-sm">Confirm {money(visibleSelected.amount_cents)} on {visibleSelected.transaction_date} in {visibleSelected.account_name}. This satisfies the plan{linked ? "; no cash or principal progress changes again" : " without moving money again"}. Delete preserves satisfaction; Revert reopens the plan.</p>}
    <Button disabled={!visibleSelected || planning.busy || linked && !obligation} onClick={() => { if (visibleSelected) void planning.save(plan.id, "match", { version: plan.version, transaction_id: visibleSelected.id, transaction_version: visibleSelected.version, ...(linked ? { obligation_version: obligation?.version } : {}) }).then(result => { if (result) onSaved(); }); }}>{planning.busy ? "Matching…" : linked ? "Confirm match of recorded payment (no cash movement)" : "Confirm match (no cash movement)"}</Button>
  </section>;
}
