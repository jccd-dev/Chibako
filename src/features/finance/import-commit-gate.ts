import type { TarsiPreview } from "./import-preview-types";

export interface TarsiCommitGateInput {
  preview: Pick<TarsiPreview, "can_approve" | "exclusions"> | null;
  needsUpdate: boolean;
  busy: boolean;
  acknowledged: string[];
  backupVerified: boolean;
  confirmed: boolean;
}

export interface TarsiCommitGateCheck {
  key: "blockers" | "exclusions" | "current" | "backup" | "confirmation";
  label: string;
  met: boolean;
}

export interface TarsiCommitGate {
  canConfirm: boolean;
  ready: boolean;
  checks: TarsiCommitGateCheck[];
}

export function evaluateTarsiCommitGate(
  input: TarsiCommitGateInput,
): TarsiCommitGate {
  const {
    preview,
    needsUpdate,
    busy,
    acknowledged,
    backupVerified,
    confirmed,
  } = input;
  const exclusionsAcknowledged =
    preview !== null &&
    preview.exclusions.every((row) => acknowledged.includes(row.path));
  const checks: TarsiCommitGateCheck[] = [
    {
      key: "blockers",
      label: "Blockers settled",
      met: preview?.can_approve === true,
    },
    {
      key: "exclusions",
      label: "Every exclusion acknowledged",
      met: exclusionsAcknowledged,
    },
    {
      key: "current",
      label: "Preview reflects your latest choices",
      met: preview !== null && !needsUpdate,
    },
    {
      key: "backup",
      label: "Recoverable backup verified",
      met: backupVerified,
    },
    {
      key: "confirmation",
      label: "Reviewed proposal confirmed",
      met: confirmed,
    },
  ];
  const reviewed = checks.filter(
    (check) => check.key !== "backup" && check.key !== "confirmation",
  );

  return {
    canConfirm: !busy && reviewed.every((check) => check.met),
    ready: !busy && checks.every((check) => check.met),
    checks,
  };
}
