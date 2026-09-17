import type { ResumeData } from '../../packages/engine/src/lib/resumeData.ts';
import { parseFieldKey } from '../../packages/engine/src/typeset/types.ts';
import { valueForField } from '../../packages/editor/src/sections/editor/resumeFieldAdapter.ts';
import { buildDisplayMap } from '../../packages/editor/src/sections/editor/inlineTextEditing.ts';
import { caretToDisplayIndex, displayIndexToCaret, fieldCaretOf } from '../../packages/editor/src/sections/editor/domSelection.ts';

function display(data: ResumeData, key: string) {
  return buildDisplayMap(valueForField(data, parseFieldKey(key)!), { preserveWhitespace: true }).display;
}

export function selectContractRange(data: ResumeData, anchorKey: string, anchor: number, focusKey = anchorKey, focus = anchor) {
  const host = document.querySelector<HTMLElement>('[contenteditable=true]')!;
  const a = displayIndexToCaret(host, anchorKey, display(data, anchorKey), anchor)!;
  const f = displayIndexToCaret(host, focusKey, display(data, focusKey), focus)!;
  host.focus();
  window.getSelection()!.setBaseAndExtent(a.node, a.offset, f.node, f.offset);
}

export function readContractSelection(data: ResumeData) {
  const selection = window.getSelection()!;
  const host = document.querySelector<HTMLElement>('[contenteditable=true]')!;
  const endpoint = (node: Node | null, offset: number) => {
    const point = node ? fieldCaretOf(host, node, offset) : null;
    if (!point) return null;
    return { key: point.key, offset: caretToDisplayIndex(host, point.key, display(data, point.key), point.node, point.offset) };
  };
  return { anchor: endpoint(selection.anchorNode, selection.anchorOffset), focus: endpoint(selection.focusNode, selection.focusOffset) };
}
