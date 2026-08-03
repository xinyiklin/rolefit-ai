import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { HistoryClock } from "@typeset/editor/hooks/historyClock.ts";
import { useResumeEditor as useTypesetResumeEditor } from "@typeset/editor/hooks/useResumeEditor.ts";
import type { TextEditOptions } from "@typeset/editor/hooks/useResumeEditor.ts";
import type { EntryTextField } from "@typeset/engine/lib/styleFieldFormatting.ts";
import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";
import { createBlankResumeData } from "../lib/blankResume.ts";
import { parseResumeData, serializeResumeData } from "../lib/resumeText.ts";

// RoleFit's thin adapter over the shared Typeset editor state. The package owns
// the document, history, and mutations; RoleFit adds only the two pipeline
// concepts the standalone editor does not have: plain-text AI seeding and the
// provenance bit that distinguishes a user's free-form edit from accepting a
// reviewed suggestion.
export function useResumeEditor(historyClock?: HistoryClock) {
  const initialResume = useMemo(createBlankResumeData, []);
  const editor = useTypesetResumeEditor(initialResume, historyClock);
  const [manualEdited, setManualEdited] = useState(false);

  // A wrapped mutator below fires BEFORE the shared reducer has actually
  // applied its action, so a no-op (e.g. clearAlignmentOverrides with nothing
  // to clear) must not flip manualEdited — the reducer early-returns the SAME
  // `editedResume` reference for a no-op. This ref records whether the most
  // recently dispatched action was a manual gesture; the effect below only
  // commits it to `manualEdited` once `editedResume` actually changes
  // reference, and every non-manual path (accepted suggestion, seed, undo,
  // redo) explicitly clears it first so a stale `true` left behind by an
  // earlier no-op can never be misattributed to a later, unrelated change.
  const pendingManualRef = useRef(false);

  const seedData = useCallback(
    (data: ResumeData) => {
      pendingManualRef.current = false;
      setManualEdited(false);
      editor.seedData(data);
    },
    [editor.seedData]
  );

  const seed = useCallback(
    (text: string, sourceText?: string) => {
      const trimmed = text?.trim();
      seedData(trimmed ? parseResumeData(text, sourceText) : createBlankResumeData());
    },
    [seedData]
  );

  // Commits the deferred flag only when the document actually changed — never
  // on a no-op dispatch, which leaves `editedResume`'s reference untouched.
  useEffect(() => {
    if (pendingManualRef.current) setManualEdited(true);
    pendingManualRef.current = false;
  }, [editor.editedResume]);

  const actions = useMemo(() => {
    const markManual = () => { pendingManualRef.current = true; };
    const clearPendingManual = () => { pendingManualRef.current = false; };
    const shared = editor.actions;

    return {
      createHeader: () => { markManual(); shared.createHeader(); },
      setHeaderVisible: (visible: boolean) => { markManual(); shared.setHeaderVisible(visible); },
      setHeaderName: (...args: Parameters<typeof shared.setHeaderName>) => {
        markManual();
        shared.setHeaderName(...args);
      },
      removeHeaderName: () => { markManual(); shared.removeHeaderName(); },
      replaceHeader: (...args: Parameters<typeof shared.replaceHeader>) => {
        markManual();
        shared.replaceHeader(...args);
      },
      replaceDocument: (...args: Parameters<typeof shared.replaceDocument>) => {
        markManual();
        shared.replaceDocument(...args);
      },
      updateContact: (...args: Parameters<typeof shared.updateContact>) => {
        markManual();
        shared.updateContact(...args);
      },
      insertContact: (index: number) => { markManual(); shared.insertContact(index); },
      removeContact: (index: number) => { markManual(); shared.removeContact(index); },
      addSection: (...args: Parameters<typeof shared.addSection>) => { markManual(); shared.addSection(...args); },
      insertSection: (...args: Parameters<typeof shared.insertSection>) => { markManual(); shared.insertSection(...args); },
      removeSection: (sectionId: string) => { markManual(); shared.removeSection(sectionId); },
      reorderSections: (from: number, to: number) => { markManual(); shared.reorderSections(from, to); },
      setHeading: (...args: Parameters<typeof shared.setHeading>) => {
        markManual();
        shared.setHeading(...args);
      },
      insertEntry: (...args: Parameters<typeof shared.insertEntry>) => { markManual(); shared.insertEntry(...args); },
      removeEntry: (sectionId: string, entryId: string) => { markManual(); shared.removeEntry(sectionId, entryId); },
      reorderEntries: (sectionId: string, from: number, to: number) => {
        markManual();
        shared.reorderEntries(sectionId, from, to);
      },
      updateEntry: (
        sectionId: string,
        entryId: string,
        field: EntryTextField,
        value: string,
        viaSuggestionOrOptions?: boolean | TextEditOptions
      ) => {
        const viaSuggestion = viaSuggestionOrOptions === true;
        // Accepting a reviewed suggestion is not a free edit; it also
        // overrides any pending flag left by an earlier no-op manual action
        // so that unrelated change is never misattributed to this one.
        if (viaSuggestion) clearPendingManual();
        else markManual();
        shared.updateEntry(
          sectionId,
          entryId,
          field,
          value,
          typeof viaSuggestionOrOptions === "object"
            ? viaSuggestionOrOptions
            : { coalesce: !viaSuggestion }
        );
      },
      updateSkillsRow: (...args: Parameters<typeof shared.updateSkillsRow>) => {
        markManual();
        shared.updateSkillsRow(...args);
      },
      setStyleFieldMark: (...args: Parameters<typeof shared.setStyleFieldMark>) => {
        markManual();
        shared.setStyleFieldMark(...args);
      },
      setStyleFieldFont: (...args: Parameters<typeof shared.setStyleFieldFont>) => {
        markManual();
        shared.setStyleFieldFont(...args);
      },
      setStyleFieldSize: (...args: Parameters<typeof shared.setStyleFieldSize>) => {
        markManual();
        shared.setStyleFieldSize(...args);
      },
      resetStyleFieldFormatting: () => { markManual(); shared.resetStyleFieldFormatting(); },
      clearAlignmentOverrides: (...args: Parameters<typeof shared.clearAlignmentOverrides>) => {
        markManual();
        shared.clearAlignmentOverrides(...args);
      },
      addBullet: (sectionId: string, entryId: string) => { markManual(); shared.addBullet(sectionId, entryId); },
      insertBullet: (...args: Parameters<typeof shared.insertBullet>) => { markManual(); shared.insertBullet(...args); },
      removeBullet: (sectionId: string, entryId: string, bulletId: string) => {
        markManual();
        shared.removeBullet(sectionId, entryId, bulletId);
      },
      reorderBullets: (sectionId: string, entryId: string, from: number, to: number) => {
        markManual();
        shared.reorderBullets(sectionId, entryId, from, to);
      },
      updateBullet: (
        sectionId: string,
        entryId: string,
        bulletId: string,
        value: string,
        viaSuggestionOrOptions?: boolean | TextEditOptions
      ) => {
        const viaSuggestion = viaSuggestionOrOptions === true;
        if (viaSuggestion) clearPendingManual();
        else markManual();
        shared.updateBullet(
          sectionId,
          entryId,
          bulletId,
          value,
          typeof viaSuggestionOrOptions === "object"
            ? viaSuggestionOrOptions
            : { coalesce: !viaSuggestion }
        );
      },
      // A selection crossing fields (Select All, a drag across paragraphs) is a
      // free-form edit like any other typing.
      applyFieldEdits: (...args: Parameters<typeof shared.applyFieldEdits>) => {
        markManual();
        shared.applyFieldEdits(...args);
      },
      breakTextHistoryGroup: () => shared.breakTextHistoryGroup(),
      splitBullet: (...args: Parameters<typeof shared.splitBullet>) => { markManual(); shared.splitBullet(...args); },
      mergeBulletUp: (...args: Parameters<typeof shared.mergeBulletUp>) => { markManual(); shared.mergeBulletUp(...args); },
      splitSummaryParagraph: (...args: Parameters<typeof shared.splitSummaryParagraph>) => {
        markManual();
        shared.splitSummaryParagraph(...args);
      },
      mergeSummaryParagraphUp: (...args: Parameters<typeof shared.mergeSummaryParagraphUp>) => {
        markManual();
        shared.mergeSummaryParagraphUp(...args);
      },
      replaceBulletParagraphs: (...args: Parameters<typeof shared.replaceBulletParagraphs>) => {
        markManual();
        shared.replaceBulletParagraphs(...args);
      },
      // Undo/redo never mark the document manually edited (unchanged from
      // before this fix), but they DO change `editedResume`'s reference — so
      // each must clear a stale pending flag left by an earlier no-op manual
      // action; otherwise the effect above would misattribute this undo/redo
      // to a manual edit it didn't cause.
      undo: () => { clearPendingManual(); shared.undo(); },
      redo: () => { clearPendingManual(); shared.redo(); }
    };
  }, [editor.actions]);

  const editedResume = editor.editedResume ?? initialResume;
  const serializedResume = useMemo(() => serializeResumeData(editedResume), [editedResume]);

  return {
    ...editor,
    editedResume,
    manualEdited,
    serializedResume,
    seed,
    seedData,
    actions
  };
}

export type ResumeEditorActions = ReturnType<typeof useResumeEditor>["actions"];
