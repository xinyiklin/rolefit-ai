import { graphemeClusters } from "@typeset/engine/typeset/linebreak.ts";
import { lineOf } from "./domSelection.ts";

export function isWrappedEntryField(host: HTMLElement, key: string): boolean {
  if (!key.startsWith("entry|")) return false;
  const peer = key.endsWith("Left") ? key.replace(/Left$/, "Right") : key.replace(/Right$/, "Left");
  return [key, peer].some((field) => {
    const spans = host.querySelectorAll<HTMLElement>(`[data-tsdf="${CSS.escape(field)}"]:not([data-tsdm])`);
    return spans.length > 1 && lineOf(spans[0]) !== lineOf(spans[spans.length - 1]);
  });
}

export function textStep(display: string, offset: number, direction: -1 | 1, word = false): number {
  if (word) {
    const units = /\s+|[\p{L}\p{N}\p{M}_]+|[^\s\p{L}\p{N}\p{M}_]+/gu;
    if (direction < 0) {
      const parts = Array.from(display.slice(0, offset).matchAll(units));
      while (parts.length && /^\s+$/.test(parts[parts.length - 1][0])) parts.pop();
      return parts.length ? parts[parts.length - 1].index! : 0;
    }
    const rest = display.slice(offset);
    const parts = Array.from(rest.matchAll(units));
    const part = parts.find((match) => !/^\s+$/.test(match[0]));
    return part ? offset + part.index! + part[0].length : display.length;
  }
  let previous = 0;
  for (const cluster of graphemeClusters(display)) {
    const next = previous + cluster.length;
    if (direction < 0 && next >= offset) return previous;
    if (direction > 0 && next > offset) return next;
    previous = next;
  }
  return display.length;
}
