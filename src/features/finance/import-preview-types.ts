import type { TarsiInspection, TarsiInspectionIssue } from "./import-inspection-types";

export interface TarsiPreviewOptions {
  exclusions?: string[];
  acknowledged_exclusions?: string[];
}

export interface TarsiProposalRecord {
  collection: string;
  source_id: string;
  path: string;
  status: "accepted" | "blocked" | "excluded";
  source: Record<string, unknown>;
  target: Record<string, unknown>;
  effects: { account_id: string; amount_cents: number }[];
}

export interface TarsiPreview {
  stage: "reconciled-preview";
  inspection: TarsiInspection;
  can_approve: boolean;
  issues: TarsiInspectionIssue[];
  counts: { collection: string; accepted: number; skipped: number; excluded: number; blocked: number }[];
  records: TarsiProposalRecord[];
  balances: { account_id: string; name: string; source_cents: number; effects_cents: number; opening_cents: number; reconciled_cents: number; opening_inferred: true; historical_balances_verified: false }[];
  exclusions: { path: string; reason: string; acknowledged: boolean; source: unknown }[];
  exclusion_choices: { path: string; label: string }[];
  commit_notice: string;
}
