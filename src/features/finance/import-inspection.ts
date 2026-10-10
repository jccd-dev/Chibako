import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { getDb } from "../../lib/db";
import { FinanceError, type FinanceActor } from "./types";
import type { TarsiInspection } from "./import-inspection-types";
import { tarsiIdentityKey } from "./import-preview-types";
import { sourceFields, requiredSourceFields, referenceCollections, isSourceObject, isCalendarDay, isSourceTimestamp } from "./import-source-format";

const financeTables = [
  "finance_accounts", "finance_classifications", "finance_transactions", "finance_movements", "finance_plans",
  "finance_budget_plans", "finance_budget_limits", "finance_schedules", "finance_goals", "finance_goal_allocations",
  "finance_obligations", "finance_obligation_movements", "finance_refunds", "finance_note_links",
  "finance_obligation_payments", "finance_obligation_writeoffs", "finance_requests", "finance_audit",
  "finance_import_migrations", "finance_import_records",
] as const;
const profileKeys = new Set(["profiles", "activeProfileId", "profileMetas"]);
const retryAnchorCollections = new Set(["expenses", "incomes", "transfers", "balanceAdjustments", "recurringExpenses", "recurringIncomes", "goals", "debts", "receivables"]);

function findRetryMigration(input: Record<string, unknown>, selected: Record<string, unknown>): string | null {
  const db = getDb();
  const sourceHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const exact = db.prepare<[string], { id: string }>("SELECT id FROM finance_import_migrations WHERE source_hash=?").get(sourceHash);
  if (exact) return exact.id;

  const historyCollections = [...retryAnchorCollections];
  const hasHistory = historyCollections.some(collection => Array.isArray(selected[collection]) && (selected[collection] as unknown[]).length > 0);
  const incoming = new Set<string>();
  const collections = hasHistory ? historyCollections : Object.keys(selected).filter(collection => !profileKeys.has(collection));
  for (const collection of collections) {
    const rows = selected[collection];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (isSourceObject(row) && typeof row.id === "string") incoming.add(tarsiIdentityKey(collection, row.id));
      else if (typeof row === "string" && ["categoryOrderIds", "incomeCategoryOrderIds"].includes(collection)) {
        incoming.add(tarsiIdentityKey(collection, row));
      }
    }
  }
  if (!incoming.size) return null;
  const candidates = new Set<string>();
  const importedRows = db.prepare<[], { migration_id: string; collection: string; source_id: string; status: string }>(
    "SELECT migration_id,collection,source_id,status FROM finance_import_records",
  ).all();
  const identitiesByMigration = new Map<string, Set<string>>();
  for (const row of importedRows) {
    const identity = tarsiIdentityKey(row.collection, row.source_id);
    if (!identitiesByMigration.has(row.migration_id)) identitiesByMigration.set(row.migration_id, new Set());
    identitiesByMigration.get(row.migration_id)!.add(identity);
    if (hasHistory && incoming.has(identity) && row.status === "imported") candidates.add(row.migration_id);
  }
  // shortcut: retries without history require the original identity set; additions need explicit migration selection.
  if (!hasHistory) for (const [migrationId, identities] of identitiesByMigration) {
    if (identities.size === incoming.size && [...incoming].every(identity => identities.has(identity))) candidates.add(migrationId);
  }
  return candidates.size === 1 ? [...candidates][0] : null;
}

export function inspectTarsiBackup(actor: FinanceActor, input: unknown): TarsiInspection {
  if (actor.kind !== "owner") {
    throw new FinanceError("Backup inspection requires the owner session", 403, "owner_required");
  }
  if (!isSourceObject(input) || input.app !== "Tarsi" || !isSourceObject(input.data)) {
    throw new FinanceError("Choose a Tarsi JSON backup with an app and data envelope", 400, "invalid_input");
  }
  const db = getDb();
  const emptyFinance = !financeTables.some(table => db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get());
  const report: TarsiInspection = {
    stage: "source-inspection", eligible: emptyFinance, retry_migration_id: null, can_proceed: false, representation: "top-level", profile_id: null,
    mirrors: [], sections: [], currencies: [], relationships: [], dates: [], issues: [],
  };
  const issue = (code: string, path: string, message: string, severity: "blocker" | "exception" = "blocker") => {
    report.issues.push({ code, path, message, severity });
  };
  for (const field of Object.keys(input)) if (!["app", "data", "exportedAt"].includes(field)) issue("unsupported_field", field, "Backup envelope field requires review.");
  const data = input.data;
  const hasTopLevelCollections = Object.keys(sourceFields).some(key => Object.hasOwn(data, key));
  const profiles = isSourceObject(data.profiles) ? data.profiles : {};
  if (data.profiles !== undefined && !isSourceObject(data.profiles)) issue("invalid_profiles", "data.profiles", "Profiles must be an object keyed by profile ID.");
  let selected = data;
  if (!Object.hasOwn(data, "accounts")) {
    const active = typeof data.activeProfileId === "string" ? data.activeProfileId : "";
    if (!isSourceObject(profiles[active])) throw new FinanceError("Backup has no top-level accounts or selected active profile", 400, "invalid_input");
    selected = profiles[active];
    report.representation = "profile";
    report.profile_id = active;
  }
  for (const [id, profile] of Object.entries(profiles)) {
    if (!isSourceObject(profile)) { issue("invalid_profile", `data.profiles.${id}`, "Profile must contain source sections."); continue; }
    const shared = Object.keys(data).filter(key => !profileKeys.has(key) && Object.hasOwn(profile, key));
    const divergent = shared.filter(key => !isDeepStrictEqual(data[key], profile[key]));
    for (const key of Object.keys(sourceFields)) {
      if (hasTopLevelCollections && Object.hasOwn(data, key) !== Object.hasOwn(profile, key)) divergent.push(key);
    }
    report.mirrors.push({ profile_id: id, compared_sections: shared.length, divergent_sections: [...new Set(divergent)] });
    if (divergent.length) issue("mirrored_divergence", `data.profiles.${id}`, "Mirrored source sections diverge. Only the selected representation is inspected; records are never combined.");
    for (const key of Object.keys(profile)) {
      if (!Object.hasOwn(selected, key) && !profileKeys.has(key)) issue("unselected_profile_section", `data.profiles.${id}.${key}`, "Section exists only outside the selected representation and requires review.");
    }
  }
  if (report.representation === "profile") for (const key of Object.keys(data)) {
    if (!profileKeys.has(key) && !Object.hasOwn(selected, key)) issue("unselected_top_level_section", `data.${key}`, "Top-level section is absent from the selected profile and requires review; records are never combined.");
  }
  if (typeof data.activeProfileId === "string" && !isSourceObject(profiles[data.activeProfileId])) issue("missing_active_profile", "data.activeProfileId", "The selected profile ID does not resolve.");
  report.retry_migration_id = findRetryMigration(input, selected);
  report.eligible = emptyFinance || report.retry_migration_id !== null;
  if (!report.eligible) issue("finance_not_empty", "destination", "A populated Vault accepts retries of a previously imported migration only. Another Tarsi history cannot be merged.");
  const identities = new Map<string, Set<string>>();
  for (const [name, value] of Object.entries(selected)) {
    if (profileKeys.has(name)) continue;
    const supported = Object.hasOwn(sourceFields, name);
    const rows = Array.isArray(value) ? value : [];
    const ids = new Set<string>();
    const fields = new Set<string>();
    for (const [index, row] of rows.entries()) {
      if (!isSourceObject(row)) {
        if (supported) issue("invalid_record", `${name}[${index}]`, "Source record must be an object.");
        continue;
      }
      for (const field of Object.keys(row)) fields.add(field);
      if (Object.hasOwn(requiredSourceFields, name)) for (const field of requiredSourceFields[name]) {
        if (row[field] === undefined || row[field] === null || row[field] === "") {
          issue(field === "currency" ? "missing_currency" : /date$/i.test(field) ? "missing_date" : "missing_reference", `${name}[${index}].${field}`, "Required source field is absent. No currency, historical date, or relationship is inferred.");
        }
      }
      if (typeof row.id !== "string" || !row.id || row.id.length > 128) {
        if (supported) issue("invalid_id", `${name}[${index}].id`, "Source record requires an ID of 1–128 characters.");
      } else {
        if (ids.has(row.id)) issue("duplicate_id", `${name}[${index}].id`, "Duplicate identity within this source collection.");
        ids.add(row.id);
      }
    }
    identities.set(name, ids);
    report.sections.push({ name, kind: Array.isArray(value) ? "collection" : isSourceObject(value) ? "object" : "value", count: Array.isArray(value) ? value.length : isSourceObject(value) ? Object.keys(value).length : null, supported, fields: [...fields], ids: [...ids] });
    if (supported && !Array.isArray(value)) issue("invalid_collection", name, "Source collection must be an array.");
    if (!supported) issue("unsupported_section", name, "Source section has no agreed migration mapping or exclusion.");
    if (supported) for (const field of fields) {
      if (!sourceFields[name].includes(field)) issue("unsupported_field", `${name}.${field}`, "Source field has no agreed migration mapping or exclusion.");
    }
  }
  const currencies = new Set<string>();
  for (const [kind, custom, order] of [["expenseCategories", "customCategories", "categoryOrderIds"], ["incomeCategories", "customIncomeCategories", "incomeCategoryOrderIds"]] as const) {
    const ordered = selected[order];
    identities.set(kind, new Set([...(identities.get(custom) ?? []), ...(Array.isArray(ordered) ? ordered.filter((id): id is string => typeof id === "string") : []), "other"]));
  }
  let visited = 0;
  function inspect(value: unknown, path: string, collection: string, depth = 0): void {
    if (++visited > 100_000 || depth > 20) throw new FinanceError("Backup structure exceeds inspection limits", 400, "invalid_input");
    if (Array.isArray(value)) { value.forEach((item, index) => inspect(item, `${path}[${index}]`, collection, depth + 1)); return; }
    if (!isSourceObject(value)) return;
    for (const [field, item] of Object.entries(value)) {
      const fieldPath = path ? `${path}.${field}` : field;
      if (item === null || item === "") continue;
      if (depth > 2 && !["id", "amount", "accountId", "goalAccountId", "type", "date", "createdAt", "description"].includes(field)
        && /\.(?:contributions|borrowings|payments|advances|collections|mutualOffsets)\[\d+\]$/.test(path)) {
        issue("unsupported_field", fieldPath, "Nested source field has no agreed migration mapping or exclusion.");
      }
      if (field === "currency" || field === "preferredCurrency") {
        if (typeof item !== "string") issue("invalid_currency", fieldPath, "Currency must be an explicit code.");
        else { currencies.add(item); if (item !== "PHP") issue("unsupported_currency", fieldPath, "Only PHP is supported. No conversion will be performed."); }
      }
      const target = field === "category" || field === "parentCategoryId"
        ? collection === "incomes" || collection === "recurringIncomes" || value.parentCategoryKind === "income" ? "incomeCategories" : "expenseCategories"
        : Object.hasOwn(referenceCollections, field) ? referenceCollections[field] : undefined;
      if (target) {
        const valid = typeof item === "string" && !!item && item.length <= 128;
        const resolved = valid && !!identities.get(target)?.has(item);
        report.relationships.push({ path: fieldPath, target_collection: target, target_id: valid ? item : "(invalid ID)", resolved });
        if (!resolved) issue(collection === "balanceAdjustments" && field === "accountId" ? "missing_account_adjustment" : "unresolved_reference", fieldPath,
          collection === "balanceAdjustments" && field === "accountId" ? "Adjustment refers to a missing account. Requires explicit exclusion; no account is invented or reassigned." : "Source relationship does not resolve in the selected representation.",
          collection === "balanceAdjustments" && field === "accountId" ? "exception" : "blocker");
      }
      if (/(?:date|At)$/i.test(field) && !isSourceObject(item) && !Array.isArray(item)) {
        const calendar = typeof item === "string" && isCalendarDay(item);
        const timestamp = typeof item === "string" && isSourceTimestamp(item);
        const metadata = /At$/.test(field);
        const status = calendar ? "calendar-day" : timestamp && metadata ? "timestamp" : timestamp || (typeof item === "number" && Number.isFinite(item)) ? "ambiguous" : "invalid";
        report.dates.push({ path: fieldPath, value: typeof item === "string" ? item.slice(0, 256) : typeof item === "number" ? item : "(invalid date)", status });
        if (status === "invalid" || status === "ambiguous") issue(`${status}_date`, fieldPath, status === "invalid" ? "Invalid source date requires review." : "Timestamp-to-calendar-day mapping requires owner review. No date is inferred.");
      }
      inspect(item, fieldPath, collection, depth + 1);
    }
  }
  for (const [name, value] of Object.entries(selected)) if (!profileKeys.has(name)) inspect({ [name]: value }, "", name);
  report.currencies = [...currencies].sort();
  report.can_proceed = report.eligible && report.issues.length === 0;
  return report;
}
