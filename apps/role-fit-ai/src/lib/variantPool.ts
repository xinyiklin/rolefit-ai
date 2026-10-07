// The variants Prepare may pick from, per document kind. Stored as exclusions
// keyed by file name, so an unset pool and every newly saved variant stay
// eligible, and a name that no longer exists matches nothing.

export type VariantKind = "resume" | "cover-letter";
export type VariantExclusions = Readonly<Record<string, true>>;

export const MAX_VARIANT_EXCLUSIONS = 200;
// The longest file name the workspace's file systems can list.
const MAX_VARIANT_FILE_NAME_LENGTH = 255;

// The workspace's own variant name rules for each kind.
const VARIANT_FILE_NAME_PATTERNS: Readonly<Record<VariantKind, RegExp>> = {
  resume: /^[A-Za-z0-9][A-Za-z0-9_-]*\.resume$/,
  "cover-letter": /^[A-Za-z0-9][A-Za-z0-9_-]*\.cover$/
};

function isExcluded(exclusions: VariantExclusions | undefined, fileName: string): boolean {
  return Boolean(exclusions) && Object.prototype.hasOwnProperty.call(exclusions, fileName);
}

// Keeps valid entries in input order, so an already-clean record normalizes to
// itself and passes the strict backup/preferences comparison.
export function normalizeVariantExclusions(value: unknown, kind: VariantKind): Record<string, true> {
  const kept: Record<string, true> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return kept;
  let count = 0;
  for (const [fileName, excluded] of Object.entries(value)) {
    if (count >= MAX_VARIANT_EXCLUSIONS) break;
    if (
      excluded === true
      && fileName.length <= MAX_VARIANT_FILE_NAME_LENGTH
      && VARIANT_FILE_NAME_PATTERNS[kind].test(fileName)
    ) {
      kept[fileName] = true;
      count += 1;
    }
  }
  return kept;
}

export function eligibleVariantOptions<T extends { fileName: string }>(
  options: readonly T[],
  exclusions: VariantExclusions | undefined
): T[] {
  return options.filter((option) => !isExcluded(exclusions, option.fileName));
}

export function eligibleVariantKey(
  options: readonly { fileName: string }[],
  exclusions: VariantExclusions | undefined
): string {
  return JSON.stringify(eligibleVariantOptions(options, exclusions).map((option) => option.fileName));
}
