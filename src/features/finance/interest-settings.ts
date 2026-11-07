import { randomUUID } from "node:crypto";
import { getDb, now } from "../../lib/db";
import { financeActorId } from "../../server/auth/finance-authorization";
import { interestCalendarDate, interestPercent, interestPercentText, type InterestFrequency } from "./interest-calculation";
import { interestSettingsSchema, type FinanceAccountInterest, type FinanceActor } from "./types";
import type { z } from "zod";

interface ActiveConfiguration { id: string; start_date: string; annual_rate_scaled: number; tax_scaled: number; frequency: InterestFrequency }

const DEFAULT_TAX_SCALED = 200_000;

function activeConfiguration(accountId: string) {
  return getDb().prepare("SELECT id,start_date,annual_rate_scaled,tax_scaled,frequency FROM finance_interest_configurations WHERE account_id=? AND end_date IS NULL").get(accountId) as ActiveConfiguration | undefined;
}

export function readInterestSettings(accountId: string): FinanceAccountInterest | null {
  const active = activeConfiguration(accountId);
  return active ? {
    annual_rate: interestPercentText(active.annual_rate_scaled), withholding_tax: interestPercentText(active.tax_scaled),
    frequency: active.frequency, start_date: active.start_date,
  } : null;
}

/** Runs inside the account mutation. Completed days keep their configuration; today's unfinished day takes the new one. */
export function saveInterestSettings(actor: FinanceActor, requestId: string, accountId: string, settings: z.infer<typeof interestSettingsSchema> | null) {
  const db = getDb(), today = interestCalendarDate(new Date()), active = activeConfiguration(accountId);
  const next = settings && {
    rate: Number(interestPercent(settings.annual_rate)),
    tax: settings.withholding_tax === undefined ? active?.tax_scaled ?? DEFAULT_TAX_SCALED : Number(interestPercent(settings.withholding_tax, true)),
    frequency: settings.frequency ?? active?.frequency ?? "monthly",
  };
  if (active && next && active.annual_rate_scaled === next.rate && active.tax_scaled === next.tax && active.frequency === next.frequency) return;
  if (active) db.prepare("UPDATE finance_interest_configurations SET end_date=MAX(start_date,?) WHERE id=?").run(today, active.id);
  if (!next) return;
  // A row started today has no completed days, so a same-day edit or re-enable replaces it.
  db.prepare(`INSERT INTO finance_interest_configurations(id,account_id,start_date,end_date,annual_rate_scaled,tax_scaled,frequency,actor_id,request_id,created_at)
    VALUES (?,?,?,NULL,?,?,?,?,?,?) ON CONFLICT(account_id,start_date) DO UPDATE SET end_date=NULL,annual_rate_scaled=excluded.annual_rate_scaled,
    tax_scaled=excluded.tax_scaled,frequency=excluded.frequency,actor_id=excluded.actor_id,request_id=excluded.request_id`)
    .run(randomUUID(), accountId, today, next.rate, next.tax, next.frequency, financeActorId(actor), requestId, now());
}
