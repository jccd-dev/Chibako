import type { FinanceTransaction } from "./activity-types";

// Applied/pending split; records without the partial fields fall back to the all-or-nothing link.
export function cashbackSplit(record: FinanceTransaction) {
  const total = record.cashback_amount_cents ?? 0;
  const legacyApplied = record.cashback_transaction_id ? total : 0;
  return { total, applied: record.cashback_applied_cents ?? legacyApplied, pending: record.cashback_pending_cents ?? total - legacyApplied };
}
