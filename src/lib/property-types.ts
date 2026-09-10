// Shared property-schema types. DB-free on purpose: client components can
// import this module, while `src/lib/properties.ts` (which touches SQLite) stays server-only.

export type PropertyType =
  | "string"
  | "number"
  | "checkbox"
  | "date"
  | "list"
  | "tags"
  | "select";

export interface PropertyDef {
  /** Frontmatter key, e.g. `status`. */
  name: string;
  type: PropertyType;
  /** Allowed values for `select` type. */
  options?: string[];
}

/** Canonical order shown in type pickers. */
export const PROPERTY_TYPES: PropertyType[] = [
  "string",
  "number",
  "checkbox",
  "date",
  "list",
  "tags",
  "select",
];

/** Legacy/alias type names -> canonical. `text` predates `string`. */
export const PROPERTY_TYPE_ALIASES: Record<string, PropertyType> = {
  text: "string",
};

export function normalizePropertyType(type: string | undefined | null): PropertyType | null {
  if (!type) return null;
  const canonical = PROPERTY_TYPE_ALIASES[type] ?? type;
  return PROPERTY_TYPES.includes(canonical as PropertyType) ? (canonical as PropertyType) : null;
}

export const DEFAULT_PROPERTY_DEFS: PropertyDef[] = [
  { name: "status", type: "select", options: ["draft", "active", "done", "archived"] },
  { name: "category", type: "string" },
  { name: "tags", type: "tags" },
];
