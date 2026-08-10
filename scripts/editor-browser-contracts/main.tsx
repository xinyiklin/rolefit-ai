import {
  StrictMode,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type RefObject
} from "react";
import { createRoot } from "react-dom/client";

import TypesetApp from "../../apps/typeset/src/App.tsx";
import "../../packages/editor/src/styles/index.css";
import "../../apps/typeset/src/styles/app.css";
import "../../apps/role-fit-ai/src/styles/tokens.css";
import "../../apps/role-fit-ai/src/styles/document-workbench.css";
import { DocumentStructureControls } from "../../packages/editor/src/components/toolbar/DocumentStructureControls.tsx";
import { ZoomControl } from "../../packages/editor/src/components/toolbar/ZoomControl.tsx";
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
import { useWorkspaceResume } from "../../apps/role-fit-ai/src/hooks/useWorkspaceResume.ts";
import { useRestoredScroll } from "../../apps/role-fit-ai/src/hooks/useRestoredScroll.ts";
import {
  DocumentWorkbench,
  DocumentWorkbenchEditorPane
} from "../../apps/role-fit-ai/src/sections/document/DocumentWorkbench.tsx";
import { toDocumentStyle } from "../../packages/engine/src/lib/documentStyle.ts";

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
    __workspaceResumeContract?: {
      makeStyleDirty(): void;
      makeContentDirty(): void;
      markClean(): void;
      setConfirmAllowed(value: boolean): void;
      resetStats(): void;
      startLoadWorkspace(applyBaseResume: boolean): Promise<{
        taskId: number;
        requestId: number;
      }>;
      startLoadStarter(): Promise<{ taskId: number; requestId: number }>;
      startTextUpload(): { taskId: number };
      resolveRequest(requestId: number, payload: unknown, ok?: boolean): void;
      waitTask(taskId: number): Promise<void>;
      snapshot(): {
        dirty: boolean;
        confirmCount: number;
        appliedCount: number;
        recoveryCommitCount: number;
        baseResumeName: string;
        uploadInputValue: string;
      };
    };
    __documentWorkbenchContract?: {
      setWidth(value: number): void;
      setResultVersion(value: number): void;
      setWorkbenchMounted(value: boolean): void;
      savedScrollTop(): number;
      fitSnapshot(): { calls: number; zoom: number };
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

type PendingFetch = {
  id: number;
  resolve: (response: Response) => void;
};

function WorkspaceResumeContractApp() {
  const historyClock = useMemo(createHistoryClock, []);
  const docStyle = useDocStyle(historyClock);
  const [contentVersion, setContentVersion] = useState("clean-content");
  const [contentDirty, setContentDirty] = useState(false);
  const [fileName, setFileName] = useState("");
  const replacementStateRef = useRef({ dirty: false, version: "" });
  replacementStateRef.current = {
    dirty: contentDirty || docStyle.dirty,
    version: `${contentVersion}\u0000${JSON.stringify(
      toDocumentStyle(docStyle.style)
    )}`
  };

  const confirmAllowedRef = useRef(false);
  const confirmCountRef = useRef(0);
  const appliedCountRef = useRef(0);
  const recoveryCommitCountRef = useRef(0);
  const pendingFetchesRef = useRef<PendingFetch[]>([]);
  const nextRequestIdRef = useRef(1);
  const tasksRef = useRef(new Map<number, Promise<void>>());
  const nextTaskIdRef = useRef(1);
  const uploadInputValueRef = useRef("");

  const workspace = useWorkspaceResume({
    confirm: async () => true,
    replacementGuard: {
      isDirtyNow: () => replacementStateRef.current.dirty,
      currentVersion: () => replacementStateRef.current.version,
      confirmReplacement: async () => {
        confirmCountRef.current += 1;
        return confirmAllowedRef.current;
      },
      onReplacementCommitted: () => {
        recoveryCommitCountRef.current += 1;
      }
    },
    seedResumeEditor: () => {
      appliedCountRef.current += 1;
    },
    fileName,
    setResumeText: () => undefined,
    setFileName,
    setResult: () => undefined,
    resetCoverWorkflow: () => undefined,
    setFileError: () => undefined,
    setFileStatus: () => undefined,
    setPolishStatus: () => undefined,
    resetExportStatuses: () => undefined,
    setExportStatus: () => undefined,
    seedResumeData: () => {
      appliedCountRef.current += 1;
    },
    currentResumeText: contentVersion,
    resumeText: contentVersion,
    editedResume: null,
    docStyle
  });

  useEffect(() => {
    const originalFetch = window.fetch;
    window.fetch = () =>
      new Promise<Response>((resolve) => {
        pendingFetchesRef.current.push({
          id: nextRequestIdRef.current,
          resolve
        });
        nextRequestIdRef.current += 1;
      });
    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  useEffect(() => {
    const startTask = async (start: () => Promise<unknown>) => {
      const requestIndex = pendingFetchesRef.current.length;
      const task = start();
      const taskId = nextTaskIdRef.current;
      nextTaskIdRef.current += 1;
      tasksRef.current.set(taskId, task.then(() => undefined));
      const deadline = Date.now() + 2_000;
      while (pendingFetchesRef.current.length <= requestIndex) {
        if (Date.now() >= deadline) {
          throw new Error("Expected the hook to start a fetch.");
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      const request = pendingFetchesRef.current[requestIndex];
      return { taskId, requestId: request.id };
    };

    window.__workspaceResumeContract = {
      makeStyleDirty: () => {
        docStyle.set("lineHeight", docStyle.style.lineHeight + 0.01);
      },
      makeContentDirty: () => {
        setContentVersion((current) => `${current}-edited`);
        setContentDirty(true);
      },
      markClean: () => {
        setContentDirty(false);
        docStyle.markClean();
      },
      setConfirmAllowed: (value) => {
        confirmAllowedRef.current = value;
      },
      resetStats: () => {
        confirmCountRef.current = 0;
        appliedCountRef.current = 0;
        recoveryCommitCountRef.current = 0;
        uploadInputValueRef.current = "";
      },
      startLoadWorkspace: (applyBaseResume) =>
        startTask(() => workspace.loadWorkspace(applyBaseResume)),
      startLoadStarter: () => startTask(() => workspace.loadStarterTemplate()),
      startTextUpload: () => {
        const taskId = nextTaskIdRef.current;
        nextTaskIdRef.current += 1;
        const input = {
          files: [
            {
              name: "candidate.txt",
              text: async () => "Uploaded candidate"
            }
          ],
          value: "candidate.txt"
        };
        const task = workspace.handleFileUpload({
          target: input
        } as unknown as ChangeEvent<HTMLInputElement>);
        tasksRef.current.set(
          taskId,
          task.then(() => {
            uploadInputValueRef.current = input.value;
          })
        );
        return { taskId };
      },
      resolveRequest: (requestId, payload, ok = true) => {
        const pending = pendingFetchesRef.current.find(
          (candidate) => candidate.id === requestId
        );
        if (!pending) throw new Error(`Unknown request ${requestId}.`);
        pending.resolve({
          ok,
          json: async () => payload
        } as Response);
      },
      waitTask: async (taskId) => {
        const task = tasksRef.current.get(taskId);
        if (!task) throw new Error(`Unknown task ${taskId}.`);
        await task;
      },
      snapshot: () => ({
        dirty: replacementStateRef.current.dirty,
        confirmCount: confirmCountRef.current,
        appliedCount: appliedCountRef.current,
        recoveryCommitCount: recoveryCommitCountRef.current,
        baseResumeName: workspace.baseResumeName,
        uploadInputValue: uploadInputValueRef.current
      })
    };
  }, [docStyle, workspace]);

  return <p>Workspace resume hook browser contract</p>;
}

type DocumentWorkbenchContractSurfaceProps = {
  draft: string;
  fitViewportRef: RefObject<HTMLDivElement | null>;
  initialScrollTop: number;
  onDraftChange(value: string): void;
  onScrollExit(top: number): void;
  resultVersion: number;
};

function DocumentWorkbenchContractSurface({
  draft,
  fitViewportRef,
  initialScrollTop,
  onDraftChange,
  onScrollExit,
  resultVersion
}: DocumentWorkbenchContractSurfaceProps) {
  const { editorScrollerRef, layoutScrollerRef } = useRestoredScroll(
    initialScrollTop,
    onScrollExit
  );

  return (
    <DocumentWorkbench
      layoutRef={layoutScrollerRef}
      rail={{
        id: "cover-tailoring-contract",
        label: "Tailoring",
        preferenceKey: "cover-tailoring",
        attention: { count: 2, label: "2 issues" },
        action: (
          <button type="button" className="primary-button is-compact">
            Polish
          </button>
        ),
        content: (
          <aside aria-label="Tailoring contract content">
            <label htmlFor="document-workbench-draft">Tailoring detail</label>
            <input
              id="document-workbench-draft"
              aria-label="Tailoring detail"
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
            />
            <p data-testid="document-workbench-result">Result {resultVersion}</p>
          </aside>
        )
      }}
    >
      <DocumentWorkbenchEditorPane
        ref={(node) => {
          editorScrollerRef.current = node;
          fitViewportRef.current = node;
        }}
      >
        <div data-testid="document-workbench-page" style={{ minHeight: 720 }}>
          Editor page
        </div>
      </DocumentWorkbenchEditorPane>
    </DocumentWorkbench>
  );
}

function DocumentWorkbenchContractApp() {
  const [width, setWidth] = useState(1_200);
  const [resultVersion, setResultVersion] = useState(1);
  const [draft, setDraft] = useState("");
  const [workbenchMounted, setWorkbenchMounted] = useState(true);
  const historyClock = useMemo(createHistoryClock, []);
  const docStyle = useDocStyle(historyClock);
  const fitViewportRef = useRef<HTMLDivElement>(null);
  const fitCallsRef = useRef(0);
  const fitZoomRef = useRef(docStyle.style.zoom);
  const savedScrollTopRef = useRef(0);
  fitZoomRef.current = docStyle.style.zoom;

  const fitPage = () => {
    const pane = fitViewportRef.current;
    if (!pane) return;
    fitCallsRef.current += 1;
    docStyle.set("zoom", pane.clientWidth / 1_000);
  };

  useEffect(() => {
    window.__documentWorkbenchContract = {
      setWidth,
      setResultVersion,
      setWorkbenchMounted,
      savedScrollTop: () => savedScrollTopRef.current,
      fitSnapshot: () => ({ calls: fitCallsRef.current, zoom: fitZoomRef.current })
    };
  }, []);

  return (
    <>
      <ZoomControl
        docStyle={docStyle}
        onFitZoom={fitPage}
        fitViewportRef={fitViewportRef}
      />
      <div
        data-testid="document-workbench-host"
        style={{ display: "flex", width, height: 520, overflow: "hidden" }}
      >
        {workbenchMounted ? (
          <DocumentWorkbenchContractSurface
            draft={draft}
            fitViewportRef={fitViewportRef}
            initialScrollTop={savedScrollTopRef.current}
            onDraftChange={setDraft}
            onScrollExit={(top) => {
              savedScrollTopRef.current = top;
            }}
            resultVersion={resultVersion}
          />
        ) : null}
      </div>
    </>
  );
}

const hash = window.location.hash;
const app =
  hash === "#typeset" ? (
    <TypesetApp />
  ) : hash === "#recovery" ? (
    <RecoveryContractApp />
  ) : hash === "#workspace-resume" ? (
    <WorkspaceResumeContractApp />
  ) : hash === "#document-workbench" ? (
    <DocumentWorkbenchContractApp />
  ) : (
    <EditorContractApp />
  );

createRoot(document.getElementById("root")!).render(
  <StrictMode>{app}</StrictMode>
);
