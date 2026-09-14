export const APPEARANCE_STORAGE_KEY = "chibako_appearance";

export const FONT_OPTIONS = [
  { value: "dm-sans", label: "DM Sans" },
  { value: "questrial", label: "Questrial" },
  { value: "quicksand", label: "Quicksand" },
  { value: "existing", label: "Existing pairing" },
] as const;

export type FontChoice = (typeof FONT_OPTIONS)[number]["value"];

export interface AppearancePreferences {
  interfaceFont: FontChoice;
  noteFont: FontChoice;
}

export const DEFAULT_APPEARANCE: AppearancePreferences = {
  interfaceFont: "dm-sans",
  noteFont: "dm-sans",
};

const FONT_CHOICES = new Set<string>(FONT_OPTIONS.map((option) => option.value));

function parseFontChoice(value: unknown): FontChoice {
  return typeof value === "string" && FONT_CHOICES.has(value)
    ? (value as FontChoice)
    : "dm-sans";
}

export function parseAppearancePreferences(raw: string | null): AppearancePreferences {
  if (!raw) return DEFAULT_APPEARANCE;

  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    return {
      interfaceFont: parseFontChoice(value.interfaceFont),
      noteFont: parseFontChoice(value.noteFont),
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function readAppearancePreferences(storage: Pick<Storage, "getItem">): AppearancePreferences {
  try {
    return parseAppearancePreferences(storage.getItem(APPEARANCE_STORAGE_KEY));
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function applyAppearancePreferences(
  preferences: AppearancePreferences,
  root: Pick<HTMLElement, "dataset">
): void {
  root.dataset.interfaceFont = preferences.interfaceFont;
  root.dataset.noteFont = preferences.noteFont;
}

export function writeAppearancePreferences(
  preferences: AppearancePreferences,
  storage: Pick<Storage, "setItem">
): void {
  try {
    storage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Browser storage can be unavailable in private or restricted contexts.
  }
}

const fontChoiceValues = FONT_OPTIONS.map((option) => option.value);

export const APPEARANCE_INIT_SCRIPT = `(() => {
  const fallback = ${JSON.stringify(DEFAULT_APPEARANCE)};
  const choices = ${JSON.stringify(fontChoiceValues)};
  let value = fallback;
  try {
    const stored = JSON.parse(localStorage.getItem(${JSON.stringify(APPEARANCE_STORAGE_KEY)}) || "{}");
    value = {
      interfaceFont: choices.includes(stored.interfaceFont) ? stored.interfaceFont : fallback.interfaceFont,
      noteFont: choices.includes(stored.noteFont) ? stored.noteFont : fallback.noteFont
    };
  } catch {}
  document.documentElement.dataset.interfaceFont = value.interfaceFont;
  document.documentElement.dataset.noteFont = value.noteFont;
})();`;
