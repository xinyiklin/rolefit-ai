// The document font families, in menu order. This is the ONE list.
//
// A family id appears in the persisted `.resume`/`.cover` style enum, the inline
// `<font=…>` tag grammar, the toolbar menu, and the engine's face registry. Those
// used to hold separate hardcoded copies, so adding a family meant editing eight
// places and any miss failed quietly — a file would validate but the tag it
// contained would not parse, or the menu would offer a family the codec rejected.
// Everything now derives from here.
//
// Ids are persisted values: never rename one without a migration.

export type FontFamilyDefinition = Readonly<{
  id: string;
  label: string;
  // The proprietary family this open font is metrically compatible with — same
  // advance widths per character, so a document keeps its line and page count
  // when opened in a word processor that only has the original. Shown in the
  // menu because that compatibility is the reason to pick the font.
  metricsOf?: string;
}>;

// Menu order is recognition first: the three families a job posting or a style
// guide asks for by name lead, each beside the original it is metrically
// compatible with, and the house faces follow. Serif then sans within each
// group, so a reader scanning for "a Times-like face" or "an Arial-like face"
// meets it before the typographic defaults. Order is presentation only — the
// ids below are the persisted values and never move with it.
export const FONT_FAMILIES = [
  { id: "tinos", label: "Tinos", metricsOf: "Times New Roman" },
  { id: "carlito", label: "Carlito", metricsOf: "Calibri" },
  { id: "arimo", label: "Arimo", metricsOf: "Arial" },
  { id: "source-serif", label: "Source Serif 4" },
  { id: "source-sans", label: "Source Sans 3" },
  { id: "latin-modern", label: "Latin Modern" }
] as const satisfies readonly FontFamilyDefinition[];

export type FontFamily = (typeof FONT_FAMILIES)[number]["id"];

export const FONT_FAMILY_IDS: readonly FontFamily[] = FONT_FAMILIES.map((family) => family.id);

export const DEFAULT_FONT_FAMILY: FontFamily = "latin-modern";

export function isFontFamily(value: unknown): value is FontFamily {
  return typeof value === "string" && (FONT_FAMILY_IDS as readonly string[]).includes(value);
}

export function coerceFontFamily(value: unknown, fallback: FontFamily = DEFAULT_FONT_FAMILY): FontFamily {
  return isFontFamily(value) ? value : fallback;
}

// Regex alternation for the inline `<font=…>` tag grammar. Ids are restricted to
// lowercase letters, digits, and hyphens so they need no escaping and can never
// smuggle regex syntax into the shared tag pattern.
const SAFE_ID = /^[a-z0-9-]+$/;
for (const family of FONT_FAMILIES) {
  if (!SAFE_ID.test(family.id)) {
    throw new Error(`Font family id "${family.id}" must match ${SAFE_ID} to be used in the inline tag grammar.`);
  }
}

export const FONT_FAMILY_ALTERNATION: string = FONT_FAMILY_IDS.join("|");
