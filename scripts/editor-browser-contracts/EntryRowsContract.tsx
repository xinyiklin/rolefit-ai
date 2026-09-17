import { selectContractRange, readContractSelection } from "./selection-fixture.ts";
import { ResumePrintLayer } from "../../packages/editor/src/sections/ResumePrintLayer.tsx";
import { useEffect, useMemo } from "react";
import { createHistoryClock } from "../../packages/editor/src/hooks/historyClock.ts";
import { useResumeEditor } from "../../packages/editor/src/hooks/useResumeEditor.ts";
import { useDocStyle } from "../../packages/editor/src/hooks/useDocStyle.ts";
import { TypesetEditor } from "../../packages/editor/src/sections/editor/TypesetEditor.tsx";
import { useResumeEditor as useRoleFitResumeEditor } from "../../apps/role-fit-ai/src/hooks/useResumeEditor.ts";
import { parseResumeFile, serializeResumeFile } from "../../packages/engine/src/lib/resumeFile.ts";
import { layoutResume } from "../../packages/engine/src/typeset/layout.ts";
import { toTypesetSchema } from "../../packages/engine/src/typeset/schema.ts";
import { DOC_STYLE_BOUNDS, FONT_FAMILY_OPTIONS, type DocStyle } from "../../packages/engine/src/lib/documentStyle.ts";
import type { ResumeData } from "../../packages/engine/src/lib/resumeData.ts";

export const ENTRY_ROWS_FIXTURE: ResumeData = {
  header: { visible: true, name: "Entry row contract", contact: [] },
  sections: [{ id: "section", heading: "Experience", type: "standard", items: [
    { id: "entry", titleLeft: "<b>Engineer</b>", titleRight: "2026", subtitleLeft: "<i>Company</i>", subtitleRight: "Remote", bullets: [{ id: "bullet", text: "Built an accessible editor." }] },
    { id: "other", titleLeft: "<b>Earlier role</b>", titleRight: "2025", subtitleLeft: "Company", subtitleRight: "", bullets: [] }
  ] }]
};

declare global {
  interface Window {
    __rowContract?: {
      data: ResumeData;
      style: DocStyle;
      bounds: typeof DOC_STYLE_BOUNDS;
      fonts: typeof FONT_FAMILY_OPTIONS;
      applyStyle(style: Partial<DocStyle>): void;
      layout(): ReturnType<typeof layoutResume>;
      pdf(): Promise<number[]>;
      select(anchorKey: string, anchor: number, focusKey?: string, focus?: number): void;
      selection(): { anchor: { key: string; offset: number | null } | null; focus: { key: string; offset: number | null } | null };
      reset(data: ResumeData): void;
      undo(): void;
      redo(): void;
      reopen(): void;
      manualEdited?: boolean;
    };
  }
}

type Editor = ReturnType<typeof useResumeEditor>;
function RowsSurface({ editor, clock, host, manualEdited }: {
  editor: Pick<Editor, "editedResume" | "actions" | "canUndo" | "canRedo" | "undoSequence" | "redoSequence"> & { seedData(data: ResumeData): void };
  clock: ReturnType<typeof createHistoryClock>;
  host: string;
  manualEdited?: boolean;
}) {
  const docStyle = useDocStyle(clock);
  const data = editor.editedResume;
  useEffect(() => {
    if (!data) return;
    window.__rowContract = {
      data, style: docStyle.style, bounds: DOC_STYLE_BOUNDS, fonts: FONT_FAMILY_OPTIONS, applyStyle: docStyle.applyStyle,
      layout: () => layoutResume(toTypesetSchema(data), docStyle.style),
      pdf: async () => {
        const { emitPdf, fetchFontBytes } = await import("../../packages/engine/src/typeset/pdf/emit.ts");
        const layout = layoutResume(toTypesetSchema(data), docStyle.style);
        return Array.from(await emitPdf(layout, await fetchFontBytes(layout, "/fonts"), { title: "Wrapped row contract" }));
      },
      select: (anchorKey, anchor, focusKey = anchorKey, focus = anchor) => selectContractRange(data, anchorKey, anchor, focusKey, focus),
      selection: () => readContractSelection(data),
      reset: editor.seedData, undo: editor.actions.undo, redo: editor.actions.redo,
      manualEdited,
      reopen: () => editor.seedData(parseResumeFile(serializeResumeFile(data, docStyle.style)).data)
    };
  }, [data, docStyle.style, editor.actions, editor.seedData, manualEdited]);
  return data ? <><ResumePrintLayer resume={data} docStyle={docStyle.style} /><main data-row-host={host} style={{ padding: 24 }}>
    <TypesetEditor data={data} actions={editor.actions} docStyle={docStyle}
      canUndo={editor.canUndo} canRedo={editor.canRedo}
      contentUndoSequence={editor.undoSequence} contentRedoSequence={editor.redoSequence}
      structureCapabilities={{ header: true, sections: true }} />
  </main></> : null;
}

export function TypesetEntryRowsContract() {
  const clock = useMemo(createHistoryClock, []);
  const editor = useResumeEditor(ENTRY_ROWS_FIXTURE, clock);
  return <RowsSurface editor={editor} clock={clock} host="typeset" />;
}

export function RoleFitEntryRowsContract() {
  const clock = useMemo(createHistoryClock, []);
  const editor = useRoleFitResumeEditor(clock);
  useEffect(() => editor.seedData(ENTRY_ROWS_FIXTURE), [editor.seedData]);
  return <RowsSurface editor={editor} clock={clock} host="rolefit" manualEdited={editor.manualEdited} />;
}
