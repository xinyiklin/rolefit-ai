import type { DocumentHeader } from "@typeset/engine/lib/resumeData.ts";

export const TYPESET_INLINE_CLIPBOARD_MIME = "application/x-typeset-inline+json";
export const TYPESET_SELECTION_CLIPBOARD_MIME =
  "application/x-typeset-selection+json";

const INLINE_CLIPBOARD_FORMAT = "typeset-inline";
const INLINE_CLIPBOARD_VERSION = 1;
const MAX_INLINE_CLIPBOARD_CHARS = 1_000_000;
const SELECTION_CLIPBOARD_FORMAT = "typeset-selection";
const SELECTION_CLIPBOARD_VERSION = 1;

export type TypesetSelectionClipboardBlock =
  | { kind: "header"; header: DocumentHeader }
  | { kind: "paragraph"; value: string };

export function encodeSelectionClipboard(
  blocks: readonly TypesetSelectionClipboardBlock[]
): string {
  return JSON.stringify({
    format: SELECTION_CLIPBOARD_FORMAT,
    schemaVersion: SELECTION_CLIPBOARD_VERSION,
    blocks
  });
}

export function decodeSelectionClipboard(
  payload: string
): TypesetSelectionClipboardBlock[] | null {
  if (!payload || payload.length > MAX_INLINE_CLIPBOARD_CHARS) return null;
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    if (
      Object.keys(parsed).sort().join("|") !== "blocks|format|schemaVersion" ||
      parsed.format !== SELECTION_CLIPBOARD_FORMAT ||
      parsed.schemaVersion !== SELECTION_CLIPBOARD_VERSION ||
      !Array.isArray(parsed.blocks) ||
      parsed.blocks.length > 1_000
    ) {
      return null;
    }
    const blocks: TypesetSelectionClipboardBlock[] = [];
    for (const raw of parsed.blocks) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
      const block = raw as Record<string, unknown>;
      if (block.kind === "paragraph") {
        if (
          Object.keys(block).some((key) => key !== "kind" && key !== "value") ||
          typeof block.value !== "string" ||
          block.value.length > 100_000
        ) {
          return null;
        }
        blocks.push({ kind: "paragraph", value: block.value });
        continue;
      }
      if (block.kind !== "header") return null;
      if (
        Object.keys(block).some((key) => key !== "kind" && key !== "header") ||
        !block.header ||
        typeof block.header !== "object" ||
        Array.isArray(block.header)
      ) {
        return null;
      }
      const header = block.header as Record<string, unknown>;
      if (
        Object.keys(header).sort().join("|") !== "contact|name|visible" ||
        typeof header.visible !== "boolean" ||
        (header.name !== null && typeof header.name !== "string") ||
        !Array.isArray(header.contact) ||
        header.contact.length > 1_000 ||
        header.contact.some((item) => typeof item !== "string") ||
        (header.name === null && header.contact.length === 0)
      ) {
        return null;
      }
      blocks.push({
        kind: "header",
        header: {
          visible: header.visible,
          name: header.name as string | null,
          contact: [...header.contact] as string[]
        }
      });
    }
    const headerIndex = blocks.findIndex((block) => block.kind === "header");
    if (
      headerIndex > 0 ||
      blocks.filter((block) => block.kind === "header").length > 1
    ) {
      return null;
    }
    return blocks.length ? blocks : null;
  } catch {
    return null;
  }
}

export function encodeInlineClipboard(fragment: string): string {
  return JSON.stringify({
    format: INLINE_CLIPBOARD_FORMAT,
    schemaVersion: INLINE_CLIPBOARD_VERSION,
    value: fragment
  });
}

export function decodeInlineClipboard(payload: string): string | null {
  if (!payload || payload.length > MAX_INLINE_CLIPBOARD_CHARS) return null;
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    if (
      Object.keys(parsed).sort().join("|") !== "format|schemaVersion|value" ||
      parsed.format !== INLINE_CLIPBOARD_FORMAT ||
      parsed.schemaVersion !== INLINE_CLIPBOARD_VERSION ||
      typeof parsed.value !== "string" ||
      parsed.value.length > MAX_INLINE_CLIPBOARD_CHARS
    ) {
      return null;
    }
    return parsed.value;
  } catch {
    return null;
  }
}
