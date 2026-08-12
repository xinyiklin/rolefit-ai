export const EXTENSION_IMPORT_PARAM = "extensionImport";

export function extensionImportClaimTokenFromHref(href: string): string {
  try {
    return new URL(href).searchParams.get(EXTENSION_IMPORT_PARAM)?.trim() ?? "";
  } catch {
    return "";
  }
}
