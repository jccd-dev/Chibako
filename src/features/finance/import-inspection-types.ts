export const TARSI_BACKUP_MAX_BYTES = 8 * 1024 * 1024;

export interface TarsiInspectionIssue {
  code: string;
  path: string;
  message: string;
  severity: "blocker" | "exception";
}

export interface TarsiInspection {
  stage: "source-inspection";
  eligible: boolean;
  can_proceed: boolean;
  representation: "top-level" | "profile";
  profile_id: string | null;
  mirrors: { profile_id: string; compared_sections: number; divergent_sections: string[] }[];
  sections: { name: string; kind: "collection" | "object" | "value"; count: number | null; supported: boolean; fields: string[]; ids: string[] }[];
  currencies: string[];
  relationships: { path: string; target_collection: string; target_id: string; resolved: boolean }[];
  dates: { path: string; value: string | number; status: "calendar-day" | "timestamp" | "invalid" | "ambiguous" }[];
  issues: TarsiInspectionIssue[];
}
