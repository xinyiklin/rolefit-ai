/**
 * One-shot migration from RoleFit's pre-monorepo docStyle/editorPrefs
 * localStorage keys to the shared `@typeset/editor` useDocStyle keys.
 *
 * Before the typeset monorepo merge, RoleFit owned its own useDocStyle /
 * useEditorPrefs hooks (deleted) that persisted under:
 *   - "rolefit.docStyle.v3"        full legacy DocStyle: zoom, em-based
 *                                   spacing, style flags, page margins preset
 *   - "rolefit.docStyle.custom.v1" the user's saved spacing preset (same v3
 *                                   shape, spacing fields only)
 *   - "rolefit.editorPrefs.v1"     { spellCheck: boolean }, default true
 *
 * RoleFit now renders through the shared `@typeset/editor` useDocStyle hook
 * (packages/editor/src/hooks/useDocStyle.ts), whose storage keys are:
 *   - "typeset-resume.docStyle.v1"
 *   - "typeset-resume.docStyle.custom.v1"
 * (those two strings are not exported constants from that file — duplicated
 * here; keep in sync if that hook's storage keys ever change).
 *
 * Without this migration a returning user's zoom/spacing/style/spellcheck
 * preferences would silently reset to the shared defaults on first load after
 * the merge (and spellcheck would flip from the legacy default-on to the
 * shared default-off — see DOC_STYLE_DEFAULTS.spellCheck in
 * packages/engine/src/lib/documentStyle.ts).
 *
 * Idempotent / one-shot: no-ops whenever the new v1 key is already present,
 * so this can never clobber a preference already set through the shared
 * hook. Legacy keys are read-only here — never deleted — matching the
 * non-destructive, parse-don't-throw coercion style used elsewhere in this
 * codebase (see server/ai and the deleted hook's own v1/v2 migrations).
 *
 * TEMPORARY COMPATIBILITY ISLAND: remove this file, its main.tsx call, and its
 * focused eval after 2026-10-01, or earlier once every supported RoleFit build
 * has shipped the monorepo editor for one full release cycle.
 */
import {
  coerceDocStyle,
  pickDocSpacing,
  type DocStyle
} from "@typeset/engine/lib/documentStyle.ts";

const NEW_STYLE_KEY = "typeset-resume.docStyle.v1";
const NEW_CUSTOM_KEY = "typeset-resume.docStyle.custom.v1";

const LEGACY_STYLE_KEY = "rolefit.docStyle.v3";
const LEGACY_CUSTOM_KEY = "rolefit.docStyle.custom.v1";
const LEGACY_EDITOR_PREFS_KEY = "rolefit.editorPrefs.v1";

// Frozen snapshot of the conversion used when the shared pt-based contract was
// introduced. Future engine calibration changes must not reinterpret an old
// persisted preference during its one-shot migration.
const TEX_PT_TO_DOCUMENT_PT = 72 / 72.27;
const CALIBRATED_NAME_CONTACT_GAP = 0.04;
const CALIBRATED_HEADER_SECTION_GAP = 1.19;
const CALIBRATED_SECTION_GAP = 0.85;

const nameContactGapToPt = (value: number) =>
  (1 + (value - CALIBRATED_NAME_CONTACT_GAP) * 10) * TEX_PT_TO_DOCUMENT_PT;
const contactGapToPt = (value: number) => value * 10 * TEX_PT_TO_DOCUMENT_PT;
const headerSectionGapToPt = (value: number) =>
  (value - CALIBRATED_HEADER_SECTION_GAP + CALIBRATED_SECTION_GAP) * 11 * TEX_PT_TO_DOCUMENT_PT;
const normalGapToPt = (value: number) => value * 11 * TEX_PT_TO_DOCUMENT_PT;
const smallGapToPt = (value: number) => value * 10 * TEX_PT_TO_DOCUMENT_PT;

// Loose shape of the deleted apps/role-fit-ai/src/hooks/useDocStyle.ts v3
// payload. Every field is optional/unknown because this
// reads untrusted localStorage JSON — never throw on shape, coerce instead.
// boldTitles / boldHeadings / boldSkillLabels / italicSubtitles existed in
// that legacy shape but have no counterpart in the shared DocStyle: the
// shared editor expresses entry emphasis as inline marks on the resume
// document itself, not as a document-wide style flag. They cannot be
// migrated and are intentionally dropped.
type LegacyDocStyleV3 = Partial<{
  zoom: unknown;
  lineHeight: unknown;
  nameContactGap: unknown;
  contactGap: unknown;
  headerSectionGap: unknown;
  sectionGap: unknown;
  sectionEntryGap: unknown;
  entryGap: unknown;
  titleSubGap: unknown;
  headBulletGap: unknown;
  skillsRowGap: unknown;
  bulletGap: unknown;
  headingCase: unknown;
  sectionRule: unknown;
  contactDivider: unknown;
  headerAlign: unknown;
  bodyAlign: unknown;
  headingAlign: unknown;
  nameSize: unknown;
  pageMargins: unknown;
}>;

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

// Maps a parsed legacy v3 (or custom-preset, same shape) payload onto the
// shared DocStyle's raw input shape. Only fields the legacy hook actually
// stored are mapped; everything else is left unset so coerceDocStyle below
// backfills it from the shared defaults.
export function mapLegacyToSharedRaw(legacy: LegacyDocStyleV3): Record<string, unknown> {
  const raw: Record<string, unknown> = {};

  const zoom = numberField(legacy.zoom);
  if (zoom !== undefined) raw.zoom = zoom;
  const lineHeight = numberField(legacy.lineHeight);
  if (lineHeight !== undefined) raw.lineHeight = lineHeight;

  const nameContactGap = numberField(legacy.nameContactGap);
  if (nameContactGap !== undefined) raw.nameContactGapPt = nameContactGapToPt(nameContactGap);
  const contactGap = numberField(legacy.contactGap);
  if (contactGap !== undefined) raw.contactGapPt = contactGapToPt(contactGap);
  const headerSectionGap = numberField(legacy.headerSectionGap);
  if (headerSectionGap !== undefined) raw.headerSectionGapPt = headerSectionGapToPt(headerSectionGap);
  const sectionGap = numberField(legacy.sectionGap);
  if (sectionGap !== undefined) raw.sectionGapPt = normalGapToPt(sectionGap);
  const sectionEntryGap = numberField(legacy.sectionEntryGap);
  if (sectionEntryGap !== undefined) raw.sectionEntryGapPt = normalGapToPt(sectionEntryGap);
  const entryGap = numberField(legacy.entryGap);
  if (entryGap !== undefined) raw.entryGapPt = normalGapToPt(entryGap);
  const titleSubGap = numberField(legacy.titleSubGap);
  if (titleSubGap !== undefined) raw.titleSubGapPt = normalGapToPt(titleSubGap);
  const headBulletGap = numberField(legacy.headBulletGap);
  if (headBulletGap !== undefined) raw.headBulletGapPt = normalGapToPt(headBulletGap);
  const skillsRowGap = numberField(legacy.skillsRowGap);
  if (skillsRowGap !== undefined) raw.skillsRowGapPt = smallGapToPt(skillsRowGap);
  const bulletGap = numberField(legacy.bulletGap);
  if (bulletGap !== undefined) raw.bulletGapPt = normalGapToPt(bulletGap);

  if (typeof legacy.headingCase === "string") raw.headingCase = legacy.headingCase;
  if (typeof legacy.sectionRule === "boolean") raw.sectionRule = legacy.sectionRule;
  if (typeof legacy.contactDivider === "string") raw.contactDivider = legacy.contactDivider;
  if (typeof legacy.headerAlign === "string") raw.headerAlign = legacy.headerAlign;
  if (typeof legacy.bodyAlign === "string") raw.bodyAlign = legacy.bodyAlign;
  if (typeof legacy.headingAlign === "string") raw.headingAlign = legacy.headingAlign;
  if (typeof legacy.nameSize === "string") raw.nameSize = legacy.nameSize;
  if (typeof legacy.pageMargins === "string") raw.pageMargins = legacy.pageMargins;

  return raw;
}

// Matches the deleted useEditorPrefs.ts's own coercion: anything but an
// explicit `false` keeps the legacy default-on state. Returns undefined (no
// override) when the key is absent, corrupt, or storage is unavailable.
function readLegacySpellCheck(): boolean | undefined {
  try {
    const raw = window.localStorage.getItem(LEGACY_EDITOR_PREFS_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { spellCheck?: unknown };
    return parsed?.spellCheck !== false;
  } catch {
    return undefined;
  }
}

type MigrationShape = "full" | "spacing";

// Reads one legacy key, maps + sanitizes it, and writes it under its new key.
// No-ops (does not touch the new key) when the legacy key is absent, its JSON
// is corrupt, or storage throws — parse-don't-throw, matching this
// codebase's model/storage boundary convention.
function migrateKey(legacyKey: string, newKey: string, shape: MigrationShape, spellCheck?: boolean): void {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(legacyKey);
  } catch {
    return;
  }
  if (!raw) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return; // Corrupt legacy payload — skip migrating this key.
  }

  const mappedRaw = mapLegacyToSharedRaw((parsed ?? {}) as LegacyDocStyleV3);
  if (spellCheck !== undefined) mappedRaw.spellCheck = spellCheck;
  // coerceDocStyle clamps every numeric field to DOC_STYLE_BOUNDS and falls
  // back to shared defaults for anything invalid or missing, so an
  // out-of-bounds or partial legacy value can never escape as-is.
  const sanitized: DocStyle = coerceDocStyle(mappedRaw);
  const payload = shape === "spacing" ? pickDocSpacing(sanitized) : sanitized;

  try {
    window.localStorage.setItem(newKey, JSON.stringify(payload));
  } catch {
    // Storage unavailable (private mode, quota) — nothing more to do this session.
  }
}

// One-shot, idempotent, non-destructive: call once before the React root
// renders (see src/main.tsx), so the shared useDocStyle hook's very first
// `loadStyle()` / `loadCustomPreset()` read already sees the migrated value.
export function migrateLegacyDocStylePrefs(): void {
  if (typeof window === "undefined" || !window.localStorage) return;

  let alreadyMigrated: string | null;
  try {
    alreadyMigrated = window.localStorage.getItem(NEW_STYLE_KEY);
  } catch {
    return; // No usable storage — nothing to migrate into.
  }
  // One-shot guard: the shared hook already owns a value (either a real user
  // preference or a prior run of this migration) — never overwrite it.
  if (alreadyMigrated) return;

  const spellCheck = readLegacySpellCheck();
  migrateKey(LEGACY_STYLE_KEY, NEW_STYLE_KEY, "full", spellCheck);
  // The custom preset never carried spellCheck (it was always spacing-only),
  // so no override is passed here.
  migrateKey(LEGACY_CUSTOM_KEY, NEW_CUSTOM_KEY, "spacing");
}
