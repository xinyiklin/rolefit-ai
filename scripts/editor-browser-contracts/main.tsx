import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import TypesetApp from "../../apps/typeset/src/App.tsx";
import "../../packages/editor/src/styles/index.css";
import "../../apps/typeset/src/styles/app.css";
import { DocumentStructureControls } from "../../packages/editor/src/components/toolbar/DocumentStructureControls.tsx";
import { createHistoryClock } from "../../packages/editor/src/hooks/historyClock.ts";
import { useDocStyle } from "../../packages/editor/src/hooks/useDocStyle.ts";
import { useResumeEditor } from "../../packages/editor/src/hooks/useResumeEditor.ts";
import {
  TypesetEditor,
  type TypesetEditorCommands
} from "../../packages/editor/src/sections/editor/TypesetEditor.tsx";
import { coverLetterResumeData } from "../../packages/engine/src/lib/coverLetter.ts";
import type { ResumeData } from "../../packages/engine/src/lib/resumeData.ts";
import {
  adoptWorkspaceRestoreDrafts,
  keyForTab
} from "../../apps/role-fit-ai/src/lib/autosaveDraftRegistry.ts";
import { saveTabDraft } from "../../apps/role-fit-ai/src/lib/autosaveDraftStorage.ts";
import {
  getTabId,
  publishPresence,
  subscribeWorkspaceRestoreAdoption
} from "../../apps/role-fit-ai/src/lib/tabPresence.ts";

type EditorContract = {
  data: ResumeData | null;
  spacing: {
    nameContactGapPt: number;
    contactGapPt: number;
    headerSectionGapPt: number;
  };
  setDisabled(value: boolean): void;
  undo(): void;
  pasteAsDocument(): Promise<void>;
};

declare global {
  interface Window {
    __editorContract?: EditorContract;
    __recoveryContract?: {
      tabId(): string;
      publish(): string;
      saveResumeDraft(): { key: string; value: string | null };
      adopt(): void;
      read(key: string): string | null;
      adoptionCount(): number;
    };
  }
}

function EditorContractApp() {
  const historyClock = useMemo(createHistoryClock, []);
  const initialData = useMemo(
    () =>
      coverLetterResumeData(
        ["Initial paragraph"],
        {
          visible: true,
          name: "<b>Jane</b> <i>Doe</i>",
          contact: [
            "<link=mailto%3Ajane%40example.com>jane@example.com</link> · <i>New York</i>"
          ]
        }
      ),
    []
  );
  const editor = useResumeEditor(initialData, historyClock);
  const docStyle = useDocStyle(historyClock);
  const editorRef = useRef<TypesetEditorCommands>(null);
  const [disabled, setDisabled] = useState(false);
  const [spacing, setSpacing] = useState({
    nameContactGapPt: docStyle.style.nameContactGapPt,
    contactGapPt: docStyle.style.contactGapPt,
    headerSectionGapPt: docStyle.style.headerSectionGapPt
  });

  useEffect(() => {
    window.__editorContract = {
      data: editor.editedResume,
      spacing,
      setDisabled,
      undo: editor.actions.undo,
      pasteAsDocument: () =>
        editorRef.current?.pasteAsDocumentFromClipboard() ?? Promise.resolve()
    };
  }, [editor.actions.undo, editor.editedResume, spacing]);

  if (!editor.editedResume) return null;

  return (
    <div style={{ padding: 16 }}>
      <DocumentStructureControls
        header={editor.editedResume.header}
        contactDivider={docStyle.style.contactDivider}
        disabled={disabled}
        headerSpacing={{
          values: spacing,
          onChange: (key, value) =>
            setSpacing((current) => ({ ...current, [key]: value }))
        }}
        onCreateHeader={() => editorRef.current?.createHeader()}
        onSetHeaderVisible={editor.actions.setHeaderVisible}
        onSetHeaderName={(value) =>
          editorRef.current?.replaceHeaderNameText(value)
        }
        onRemoveHeaderName={editor.actions.removeHeaderName}
        onUpdateContact={(index, value) =>
          editorRef.current?.replaceHeaderContactText(index, value)
        }
        onInsertContact={editor.actions.insertContact}
        onRemoveContact={editor.actions.removeContact}
        onContactDividerChange={(value) =>
          docStyle.set("contactDivider", value)
        }
        showSections={false}
      />
      <button type="button" data-testid="undo" onClick={editor.actions.undo}>
        Undo
      </button>
      <TypesetEditor
        ref={editorRef}
        data={editor.editedResume}
        actions={editor.actions}
        canUndo={editor.canUndo}
        canRedo={editor.canRedo}
        contentUndoSequence={editor.undoSequence}
        contentRedoSequence={editor.redoSequence}
        docStyle={docStyle}
        documentKind="cover-letter"
        structureCapabilities={{ header: true, sections: false }}
      />
    </div>
  );
}

function RecoveryContractApp() {
  const adoptionCountRef = useRef(0);

  useEffect(
    () =>
      subscribeWorkspaceRestoreAdoption(() => {
        adoptionCountRef.current += 1;
      }),
    []
  );

  useEffect(() => {
    window.__recoveryContract = {
      tabId: getTabId,
      publish: () => {
        publishPresence("Browser contract", "editing", Date.now());
        return getTabId();
      },
      saveResumeDraft: () => {
        const id = getTabId();
        const draft = {
          savedAt: new Date().toISOString(),
          resumeSource: "strict-source-owned-by-live-tab"
        };
        saveTabDraft("resume", draft);
        const key = keyForTab("resume", id);
        return { key, value: localStorage.getItem(key) };
      },
      adopt: adoptWorkspaceRestoreDrafts,
      read: (key) => localStorage.getItem(key),
      adoptionCount: () => adoptionCountRef.current
    };
  }, []);

  return <p>Recovery browser contract</p>;
}

const hash = window.location.hash;
const app =
  hash === "#typeset" ? (
    <TypesetApp />
  ) : hash === "#recovery" ? (
    <RecoveryContractApp />
  ) : (
    <EditorContractApp />
  );

createRoot(document.getElementById("root")!).render(
  <StrictMode>{app}</StrictMode>
);
