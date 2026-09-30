import { getDb } from "./db";
import {
  DEFAULT_PROPERTY_DEFS,
  PROPERTY_TYPES,
  normalizePropertyType,
  type PropertyDef,
  type PropertyType,
} from "./property-types";

// ---------- property dictionary ----------
//
// Typed property definitions keep values consistent across the vault — the
// lesson from Obsidian's property sprawl: typed + consistent beats ad-hoc.
// Stored in `settings.property_schema` as JSON; agents read it via the
// schema/REST/MCP surfaces so they can set and filter by properties.
//
// The dictionary is NOT fixed: creating a property in the note editor with a
// chosen type auto-registers it here (vault-wide), so nothing needs to be
// pre-configured in Settings first.

export { DEFAULT_PROPERTY_DEFS, PROPERTY_TYPES };
export type { PropertyDef, PropertyType };

const SETTINGS_KEY = "property_schema";
// Bumped whenever DEFAULT_PROPERTY_DEFS gains entries. A vault whose saved
// dictionary predates the bump gets the new defaults merged in exactly once,
// so the defaults can still be deleted afterwards.
const DEFAULTS_VERSION_KEY = "property_defaults_version";
const DEFAULTS_VERSION = 2;

export class PropertySchemaError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function readSetting(key: string): string | undefined {
  const row = getDb().prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined;
  return row?.value;
}

function writeSetting(key: string, value: string): void {
  getDb()
    .prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(key, value);
}

/** Defaults the stored dictionary is missing, appended in canonical order. */
function mergeMissingDefaults(stored: PropertyDef[]): PropertyDef[] {
  const names = new Set(stored.map((def) => def.name));
  return [...stored, ...DEFAULT_PROPERTY_DEFS.filter((def) => !names.has(def.name))];
}

export function getPropertyDefs(): PropertyDef[] {
  const raw = readSetting(SETTINGS_KEY);
  if (raw === undefined) return DEFAULT_PROPERTY_DEFS;
  let stored: PropertyDef[];
  try {
    const parsed = JSON.parse(raw);
    stored = Array.isArray(parsed) ? parsed.map(normalizeDef).filter(Boolean) as PropertyDef[] : DEFAULT_PROPERTY_DEFS;
  } catch {
    return DEFAULT_PROPERTY_DEFS;
  }
  if (Number(readSetting(DEFAULTS_VERSION_KEY) ?? 0) >= DEFAULTS_VERSION) return stored;
  // One-time lazy migration. If the stored dictionary is malformed enough to
  // fail validation, leave it untouched rather than breaking reads.
  try {
    return setPropertyDefs(mergeMissingDefaults(stored));
  } catch {
    return stored;
  }
}

export function setPropertyDefs(defs: unknown): PropertyDef[] {
  const clean = validateDefs(defs);
  writeSetting(SETTINGS_KEY, JSON.stringify(clean));
  writeSetting(DEFAULTS_VERSION_KEY, String(DEFAULTS_VERSION));
  return clean;
}

/** Upsert a single property definition (name + type [+ options]). Used by the editor's auto-register. */
export function registerPropertyDef(input: { name: string; type: string; options?: string[] }): PropertyDef {
  const [def] = validateDefs([input]);
  const current = getPropertyDefs();
  const index = current.findIndex((d) => d.name === def.name);
  const next = [...current];
  if (index === -1) next.push(def);
  else next[index] = def;
  setPropertyDefs(next);
  return def;
}

function normalizeDef(def: unknown): PropertyDef | null {
  if (!def || typeof def !== "object") return null;
  const raw = def as Record<string, unknown>;
  if (typeof raw.name !== "string" || !raw.name.trim()) return null;
  const type = normalizePropertyType(typeof raw.type === "string" ? raw.type : undefined);
  if (!type) return null;
  const entry: PropertyDef = { name: raw.name.trim(), type };
  if (type === "select" && Array.isArray(raw.options)) {
    entry.options = (raw.options as unknown[]).filter((o): o is string => typeof o === "string");
  }
  return entry;
}

function validateDefs(defs: unknown): PropertyDef[] {
  if (!Array.isArray(defs)) throw new PropertySchemaError("properties must be an array");
  const seen = new Set<string>();
  const clean: PropertyDef[] = [];
  for (const def of defs) {
    if (!def || typeof def !== "object") throw new PropertySchemaError("each property must be an object");
    const { name, type, options } = def as Record<string, unknown>;
    if (typeof name !== "string" || !name.trim()) throw new PropertySchemaError("property name is required");
    const key = name.trim();
    if (!/^[\w.$-]+$/.test(key)) throw new PropertySchemaError(`invalid property name "${key}"`);
    if (seen.has(key)) throw new PropertySchemaError(`duplicate property "${key}"`);
    seen.add(key);
    const canonicalType = normalizePropertyType(typeof type === "string" ? type : undefined);
    if (!canonicalType) throw new PropertySchemaError(`property "${key}" has an unknown type`);
    const entry: PropertyDef = { name: key, type: canonicalType };
    if (canonicalType === "select") {
      if (!Array.isArray(options) || options.length === 0 || !options.every((o) => typeof o === "string" && o.trim())) {
        throw new PropertySchemaError(`select property "${key}" needs a non-empty options list`);
      }
      entry.options = (options as string[]).map((o) => o.trim());
    }
    clean.push(entry);
  }
  return clean;
}
