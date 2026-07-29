import {
  decodeInlineClipboard,
  encodeInlineClipboard,
  TYPESET_INLINE_CLIPBOARD_MIME,
  TYPESET_SELECTION_CLIPBOARD_MIME
} from "./clipboardPrivateCodec.ts";

export type RichClipboardPayload = {
  plain: string;
  html: string;
  inline?: string;
  selection?: string;
};

export type BrowserClipboardPayload = {
  inline: string | null;
  selectionPayload: string;
  html: string;
  text: string;
};

export async function writeRichClipboard(
  payload: RichClipboardPayload
): Promise<boolean> {
  if (!payload.plain || typeof navigator === "undefined" || !navigator.clipboard) {
    return false;
  }
  if (navigator.clipboard.write && typeof ClipboardItem !== "undefined") {
    const entries: Record<string, Blob> = {
      "text/plain": new Blob([payload.plain], { type: "text/plain" }),
      "text/html": new Blob([payload.html], { type: "text/html" })
    };
    if (payload.inline) {
      entries[TYPESET_INLINE_CLIPBOARD_MIME] = new Blob(
        [encodeInlineClipboard(payload.inline)],
        { type: TYPESET_INLINE_CLIPBOARD_MIME }
      );
    }
    if (payload.selection) {
      entries[TYPESET_SELECTION_CLIPBOARD_MIME] = new Blob(
        [payload.selection],
        { type: TYPESET_SELECTION_CLIPBOARD_MIME }
      );
    }
    try {
      await navigator.clipboard.write([new ClipboardItem(entries)]);
      return true;
    } catch {
      // Some browsers reject custom ClipboardItem MIME types. Retry the rich
      // external payload without the private flavor before plain text.
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": entries["text/plain"],
            "text/html": entries["text/html"]
          })
        ]);
        return true;
      } catch {
        // Fall through to the broadly supported plain-text API.
      }
    }
  }
  try {
    await navigator.clipboard.writeText(payload.plain);
    return true;
  } catch {
    return false;
  }
}

export async function readBrowserClipboard(): Promise<BrowserClipboardPayload | null> {
  if (typeof navigator === "undefined" || !navigator.clipboard) return null;

  let inline: string | null = null;
  let selectionPayload = "";
  let html = "";
  let text = "";
  if (navigator.clipboard.read) {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (
          !selectionPayload &&
          item.types.includes(TYPESET_SELECTION_CLIPBOARD_MIME)
        ) {
          selectionPayload = await (
            await item.getType(TYPESET_SELECTION_CLIPBOARD_MIME)
          ).text();
        }
        if (!inline && item.types.includes(TYPESET_INLINE_CLIPBOARD_MIME)) {
          inline = decodeInlineClipboard(
            await (await item.getType(TYPESET_INLINE_CLIPBOARD_MIME)).text()
          );
        }
        if (!html && item.types.includes("text/html")) {
          html = await (await item.getType("text/html")).text();
        }
        if (!text && item.types.includes("text/plain")) {
          text = await (await item.getType("text/plain")).text();
        }
      }
    } catch {
      // Permission or unsupported rich read: use readText below.
    }
  }
  if (!inline && !html && !text && navigator.clipboard.readText) {
    try {
      text = await navigator.clipboard.readText();
    } catch {
      return null;
    }
  }
  return { inline, selectionPayload, html, text };
}
