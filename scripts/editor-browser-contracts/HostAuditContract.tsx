import { useEffect, useMemo, useRef, useState } from 'react';
import { buildStarterResume } from '../../packages/engine/src/sampleResume.ts';
import { toDocumentStyle } from '../../packages/engine/src/lib/documentStyle.ts';
import { createHistoryClock } from '../../packages/editor/src/hooks/historyClock.ts';
import { useDocStyle } from '../../packages/editor/src/hooks/useDocStyle.ts';
import type { InlineFormatState, TypesetEditorHandle } from '../../packages/editor/src/sections/editor/TypesetEditor.tsx';
import { useResumeEditor } from '../../apps/role-fit-ai/src/hooks/useResumeEditor.ts';
import { useWorkspaceResume } from '../../apps/role-fit-ai/src/hooks/useWorkspaceResume.ts';
import { useResumeProposalDecisions } from '../../apps/role-fit-ai/src/hooks/useResumeProposalDecisions.ts';
import { useCoverLetterEditor } from '../../apps/role-fit-ai/src/hooks/useCoverLetterEditor.ts';
import { DialogProvider } from '../../apps/role-fit-ai/src/hooks/useDialog.tsx';
import { ResumeTab } from '../../apps/role-fit-ai/src/sections/tabs/ResumeTab.tsx';
import { CoverLetterTab } from '../../apps/role-fit-ai/src/sections/tabs/CoverLetterTab.tsx';
import { buildCoverLetterPreflight } from '../../apps/role-fit-ai/src/lib/coverLetterPreflight.ts';
import { selectContractRange } from './selection-fixture.ts';

const noop = () => {};
const initialFormat: InlineFormatState = {
  canFormat: false, bold: false, italic: false, underline: false, fontFamily: null,
  fontSizePt: null, alignment: null, alignmentScope: null, canFormatParagraph: false,
  paragraphLineHeight: null, paragraphSpaceBeforePt: null, paragraphSpaceAfterPt: null,
  entryField: null, linkHref: null, linkText: '', linkAutomatic: false,
  linkTextEditable: true, canLink: false, canClearFormatting: false
};
const syntheticHeader = {
  visible: true,
  name: 'Synthetic name words '.repeat(12),
  contact: ['Synthetic contact words '.repeat(22), 'neighbor@example.test']
};

declare global {
  interface Window {
    __hostAudit?: {
      snapshot(): unknown;
      selectName(offset: number): void;
      changeStyle(): void;
    };
  }
}

function ResumeHost() {
  const clock = useMemo(createHistoryClock, []);
  const editor = useResumeEditor(clock);
  const docStyle = useDocStyle(clock);
  const editorRef = useRef<TypesetEditorHandle>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [title, setTitle] = useState('Synthetic host resume');
  const [fileName, setFileName] = useState('synthetic.resume');
  const [fileError, setFileError] = useState('');
  const current = useRef({ dirty: false, version: '' });
  current.current = { dirty: editor.dirty || docStyle.dirty, version: JSON.stringify([editor.editedResume, toDocumentStyle(docStyle.style)]) };
  const workspace = useWorkspaceResume({
    confirm: async () => true,
    replacementGuard: { isDirtyNow: () => current.current.dirty, currentVersion: () => current.current.version, confirmReplacement: async () => true, onReplacementCommitted: noop },
    fileName, setFileName, setDocumentTitle: setTitle, setResumeText: noop, setResult: noop,
    resetCoverWorkflow: noop, setFileError, setFileStatus: noop, setPolishStatus: noop,
    resetExportStatuses: noop, setExportStatus: noop, seedResumeData: editor.seedData,
    setResumeOrigin: noop, editedResume: editor.editedResume, docStyle
  });
  const decisions = useResumeProposalDecisions({ result: null, resume: editor.editedResume, actions: editor.actions });
  useEffect(() => {
    const data = buildStarterResume();
    data.header = syntheticHeader;
    editor.seedData(data);
  }, []);
  useEffect(() => {
    window.__hostAudit = {
      snapshot: () => ({ data: editor.editedResume, style: toDocumentStyle(docStyle.style), dirty: current.current.dirty, title, fileName, error: fileError }),
      selectName: (offset) => selectContractRange(editor.editedResume, 'name', offset, 'name', offset),
      changeStyle: () => docStyle.set('lineHeight', docStyle.style.lineHeight + .01)
    };
  });
  return <>
    {fileError && <p role="alert">{fileError}</p>}
    <ResumeTab documentTitle={title} onDocumentTitleChange={setTitle}
      editedResume={editor.editedResume} actions={editor.actions} canUndo={editor.canUndo}
      canRedo={editor.canRedo} contentUndoSequence={editor.undoSequence} contentRedoSequence={editor.redoSequence}
      dirty={editor.dirty} draftAutosaveState="idle" result={null} docStyle={docStyle}
      formattingToolbar={null} editorRef={editorRef} fitViewportRef={viewportRef}
      initialCaret={null} onCaretExit={noop} initialScrollTop={0} onScrollExit={noop}
      onInlineFormatStateChange={noop} onRequestLinkEditor={noop} polishScopeModes={{}}
      onSetPolishScopeMode={noop} resumeReady jobReady={false} resumePolishProviderReady={false}
      isPolishStarting={false} isPolishing={false} polishProgress={{ polish: { status: 'idle' } }}
      proposalDecisions={decisions} onPolish={noop} onRetryPolish={noop} onStopPolish={noop}
      documentActions={<input type="file" accept=".resume" aria-label="Synthetic resume upload" onChange={workspace.handleFileUpload} />}
    />
  </>;
}

function CoverHost() {
  const editor = useCoverLetterEditor();
  const editorRef = useRef<TypesetEditorHandle>(null);
  const [format, setFormat] = useState(initialFormat);
  const initialized = useRef(false);
  useEffect(() => {
    if (editor.isWorkspaceBootstrapping || initialized.current) return;
    initialized.current = true;
    editor.startStarter();
    editor.actions.replaceHeader(syntheticHeader);
  }, [editor.isWorkspaceBootstrapping]);
  useEffect(() => {
    window.__hostAudit = {
      snapshot: () => ({ data: editor.data, style: toDocumentStyle(editor.docStyle.style), dirty: editor.dirty, title: editor.documentTitle, fileName: editor.activeCoverFileName, error: editor.status }),
      selectName: (offset) => selectContractRange(editor.data, 'name', offset, 'name', offset),
      changeStyle: () => editor.docStyle.set('lineHeight', editor.docStyle.style.lineHeight === 1.5 ? 1.6 : 1.5)
    };
  });
  return <CoverLetterTab editor={editor} editorRef={editorRef} initialCaret={null} onCaretExit={noop}
    initialScrollTop={0} onScrollExit={noop} inlineFormat={format} onInlineFormatStateChange={setFormat}
    onTailor={noop} onDocumentChoice={noop}
    applicationSync={{ state: 'no-application', title: 'No application', description: 'Synthetic fixture', disabled: true, isSaving: false, status: '', statusIsError: false, save: async () => {} }}
    draftAutosaveState="idle" pendingAutosaveDraft={null} onRestoreAutosaveDraft={noop} onDismissAutosaveDraft={noop}
    isTailoring={false} tailorStatus="" resumeReady={false} jobReady={false} providerReady={false}
    preflight={buildCoverLetterPreflight({ text: editor.text })} proposal={null} appliedResult={null} failure={null}
    slotAnswers={{}} onDetailChange={noop} onSlotAnswerChange={noop} onAcceptProposal={noop}
    onDiscardProposal={noop} onRestorePreTailor={noop} />;
}

export function HostAuditContract({ kind }: { kind: 'resume' | 'cover' }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // main.tsx also serves the standalone fixture; its app-only CSS must not leak into RoleFit.
    document.querySelectorAll('style[data-vite-dev-id$="/apps/typeset/src/styles/app.css"]').forEach(style => style.remove());
    void import('../../apps/role-fit-ai/src/styles/index.css').then(() => setReady(true));
  }, []);
  if (!ready) return <p>Loading host styles</p>;
  return <DialogProvider><main className="studio-body" data-tab={kind} style={{ height: '100vh', minWidth: 0 }}>
    {kind === 'resume' ? <ResumeHost /> : <CoverHost />}
  </main></DialogProvider>;
}
