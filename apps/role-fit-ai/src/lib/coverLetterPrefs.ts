import {
  COVER_LETTER_STYLE_DEFAULTS,
  type CoverLetterStyle
} from "@typeset/engine/lib/coverLetter.ts";

const KEY = "rolefit:lastCoverLetter";

const LEGACY_STYLE_DEFAULTS: CoverLetterStyle = {
  fontFamily: "carlito",
  fontSizePt: 11,
  lineHeight: 1.25,
  paragraphGapPt: 10,
  marginTopPt: 72,
  marginRightPt: 72,
  marginBottomPt: 72,
  marginLeftPt: 72,
  contactDivider: "|"
};

// The old professional defaults were persisted as if the user had customized
// them. Migrate only that exact snapshot; real custom values remain untouched.
export function migrateStoredCoverLetterStyle(style: CoverLetterStyle): CoverLetterStyle {
  const isLegacyDefault = (Object.keys(LEGACY_STYLE_DEFAULTS) as Array<keyof CoverLetterStyle>)
    .every((key) => style[key] === LEGACY_STYLE_DEFAULTS[key]);
  return isLegacyDefault
    ? { ...COVER_LETTER_STYLE_DEFAULTS }
    : style;
}

export function resolveCoverLetterStartup(
  availableFileNames: string[],
  rememberedFileName: string
): { fileName: string; stale: boolean } {
  const remembered = rememberedFileName.trim();
  const rememberedExists =
    Boolean(remembered) && availableFileNames.includes(remembered);
  return {
    fileName: rememberedExists ? remembered : availableFileNames[0] ?? "",
    stale: Boolean(remembered) && !rememberedExists
  };
}

export function coverLetterStartupIsCurrent(
  startupFingerprint: string,
  currentFingerprint: string,
  cancelled: boolean
): boolean {
  return !cancelled && startupFingerprint === currentFingerprint;
}

export function loadLastCoverLetterName(): string {
  if (typeof localStorage === "undefined") return "";
  try {
    return localStorage.getItem(KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function saveLastCoverLetterName(fileName: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    const value = fileName.trim();
    if (value) localStorage.setItem(KEY, value);
    else localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable or over quota — saved variants still open normally.
  }
}
