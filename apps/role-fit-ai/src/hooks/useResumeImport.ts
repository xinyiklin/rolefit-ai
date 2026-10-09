import { useCallback, useEffect, useRef, useState } from "react";

import { DOC_STYLE_DEFAULTS } from "@typeset/engine/lib/documentStyle.ts";
import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";
import type { ConfirmOptions } from "./useDialog";
import type { ImportedResumeDocument, ResumeDocumentSnapshot } from "./useWorkspaceResume";
import type { AiRequestFields } from "../lib/aiRequest.ts";
import type { AiStageState } from "../lib/aiWorkflow.ts";
import { prepareResumePdfImport } from "../lib/documentOpenFiles.ts";
import { resumeDocumentVersion } from "../lib/resumeDocumentVersion.ts";
import { importDocumentTitle, runResumeImport } from "../lib/resumeImportSession.ts";
import type { ContentAudit } from "../resume/pdfImport/importAudit.ts";
import type { PdfImportResult } from "../resume/pdfImport/importResumePdf.ts";
import type { ImportFinding } from "../resume/pdfImport/resumeFromLayout.ts";

export type ResumeImportReview = {
  fileName: string;
  previewUrl: string;
  findings: ImportFinding[];
  audit: ContentAudit;
  // Which reading the editor shows: the local one, or an AI interpretation.
  source: "local" | "ai";
};

export type ResumeImportStatus =
  | { kind: "idle" }
  | { kind: "reading"; fileName: string }
  | { kind: "refused"; fileName: string; message: string };

type Session = ResumeImportReview & {
  original: Blob;
  seedRevision: number;
  snapshot: ResumeDocumentSnapshot;
  // The document exactly as last placed by the import; any difference means
  // the user edited it.
  importedVersion: string;
  local: PdfImportResult;
};

type UseResumeImportArgs = {
  // The editor's seed revision: the review lasts only while the document seeded
  // by the import is still the one in the editor. Saving, opening anything
  // else, restoring a draft, or Discard all reseed and so end it.
  seedRevision: number;
  getSeedRevision: () => number;
  commit: (imported: ImportedResumeDocument, readSnapshot: () => ResumeDocumentSnapshot) => Promise<ResumeDocumentSnapshot | null>;
  replaceContent: (data: ResumeData) => void;
  restore: (snapshot: ResumeDocumentSnapshot) => void;
  readSnapshot: () => ResumeDocumentSnapshot;
  currentVersion: () => string;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  // Read when the user asks for an interpretation, never earlier.
  interpretRequestFields: () => AiRequestFields;
};

async function extractInBrowser(bytes: Uint8Array): Promise<PdfImportResult> {
  const [{ importResumePdf }, { pdfjs }] = await Promise.all([
    import("../resume/pdfImport/importResumePdf.ts"),
    import("../lib/browserPdfjs.ts")
  ]);
  return importResumePdf(bytes, pdfjs);
}

const versionOf = (data: ResumeData, local: PdfImportResult) => resumeDocumentVersion(data, { ...DOC_STYLE_DEFAULTS, ...local.style });

// Owns one PDF import: reading it locally, committing the draft through the
// workspace's guarded replacement, the review session beside the editor, the
// optional AI interpretation, and Discard. Nothing here writes a workspace
// file, and resume text reaches a provider only from `interpret`.
export function useResumeImport({
  seedRevision,
  getSeedRevision,
  commit,
  replaceContent,
  restore,
  readSnapshot,
  currentVersion,
  confirm,
  interpretRequestFields
}: UseResumeImportArgs) {
  const [status, setStatus] = useState<ResumeImportStatus>({ kind: "idle" });
  const [session, setSession] = useState<Session | null>(null);
  const [interpretation, setInterpretation] = useState<AiStageState>({ status: "idle" });
  const runRef = useRef(0);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const abortRef = useRef<AbortController | null>(null);

  const reviewOpen = session !== null && session.seedRevision === seedRevision;
  const isCurrent = useCallback(
    (candidate: Session) => sessionRef.current === candidate && candidate.seedRevision === getSeedRevision(),
    [getSeedRevision]
  );

  // A refusal raised during a review belongs to it, so it ends with the review.
  const endSession = useCallback(() => {
    abortRef.current?.abort();
    setSession(null);
    setInterpretation({ status: "idle" });
    setStatus((current) => (current.kind === "refused" ? { kind: "idle" } : current));
  }, []);

  useEffect(() => {
    if (session && !reviewOpen) endSession();
  }, [endSession, reviewOpen, session]);

  useEffect(() => {
    const url = session?.previewUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [session?.previewUrl]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const importFile = useCallback(
    async (file: File) => {
      const run = (runRef.current += 1);
      setStatus({ kind: "reading", fileName: file.name });
      const outcome = await runResumeImport({
        read: () => prepareResumePdfImport(file),
        extract: extractInBrowser,
        commit: (result) =>
          commit({ data: result.data, style: result.style, fileName: file.name, title: importDocumentTitle(file.name) }, () => {
            // An import replaced before it was saved is not worth returning to;
            // Discard goes back to the document from before the first import.
            const open = sessionRef.current;
            return open && open.seedRevision === getSeedRevision() ? open.snapshot : readSnapshot();
          }),
        isCurrent: () => run === runRef.current
      });
      if (run !== runRef.current) return;
      if (outcome.kind === "refused") {
        setStatus({ kind: "refused", fileName: file.name, message: outcome.message });
        return;
      }
      setStatus({ kind: "idle" });
      if (outcome.kind !== "committed") return;
      abortRef.current?.abort();
      const { result, snapshot } = outcome;
      setInterpretation({ status: "idle" });
      setSession({
        fileName: file.name,
        original: file,
        previewUrl: URL.createObjectURL(file),
        findings: result.findings,
        audit: result.audit,
        source: "local",
        seedRevision: getSeedRevision(),
        snapshot,
        importedVersion: versionOf(result.data, result),
        local: result
      });
    },
    [commit, getSeedRevision, readSnapshot]
  );

  const confirmReplacingEdits = useCallback(
    async (current: Session, title: string, confirmLabel: string) =>
      currentVersion() === current.importedVersion ||
      confirm({
        title,
        message: "Your corrections to the imported resume will be replaced. The original PDF and the other reading stay available.",
        confirmLabel
      }),
    [confirm, currentVersion]
  );

  const show = useCallback(
    (current: Session, result: PdfImportResult, source: Session["source"]) => {
      replaceContent(result.data);
      const next: Session = {
        ...current,
        findings: result.findings,
        audit: result.audit,
        source,
        seedRevision: getSeedRevision(),
        importedVersion: versionOf(result.data, current.local)
      };
      sessionRef.current = next;
      setSession(next);
    },
    [getSeedRevision, replaceContent]
  );

  const interpret = useCallback(async () => {
    const current = sessionRef.current;
    if (!current || !isCurrent(current) || abortRef.current) return;
    if (!(await confirmReplacingEdits(current, "Replace your corrections?", "Interpret"))) return;
    if (!isCurrent(current)) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setInterpretation({ status: "running" });
    try {
      const [{ importRequestLines, interpretedImport }, { parseResumeImportLines }] = await Promise.all([
        import("../resume/pdfImport/importStructure.ts"),
        import("../../shared/resumeImportContract.ts")
      ]);
      // Over the limits, nothing is sent; the server would refuse it anyway.
      const lines = parseResumeImportLines(importRequestLines(current.local.lines).lines);
      const response = await fetch("/api/resume-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...interpretRequestFields(), lines }),
        signal: controller.signal
      });
      const payload = (await response.json().catch(() => null)) as { structure?: unknown; error?: unknown } | null;
      if (!response.ok) {
        throw new Error(typeof payload?.error === "string" ? payload.error : `Resume import could not interpret this PDF (${response.status}).`);
      }
      const outcome = interpretedImport(payload?.structure, current.local);
      if (!isCurrent(current)) return;
      if (!outcome.ok) {
        setInterpretation({ status: "failed", errorHeadline: "Not used", error: `${outcome.reason} The local reading was kept.` });
        return;
      }
      // Edits made while the request ran are the user's newest work.
      if (!(await confirmReplacingEdits(current, "Replace your corrections?", "Use interpretation")) || !isCurrent(current)) {
        setInterpretation({ status: "idle" });
        return;
      }
      show(current, outcome.result, "ai");
      setInterpretation({ status: "done", note: "Text checked against the PDF; check where it was placed.", noteTone: "ok" });
    } catch (error) {
      if (controller.signal.aborted) {
        if (isCurrent(current)) setInterpretation({ status: "stopped", error: "The local reading was kept." });
        return;
      }
      setInterpretation({
        status: "failed",
        error: error instanceof Error ? error.message : "Resume import could not interpret this PDF. The local reading was kept."
      });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [confirmReplacingEdits, interpretRequestFields, isCurrent, show]);

  const stopInterpretation = useCallback(() => abortRef.current?.abort(), []);
  const dismissInterpretation = useCallback(() => setInterpretation({ status: "idle" }), []);

  const showLocalReading = useCallback(async () => {
    const current = sessionRef.current;
    if (!current || current.source !== "ai" || !isCurrent(current)) return;
    if (!(await confirmReplacingEdits(current, "Use the local reading?", "Use local reading")) || !isCurrent(current)) return;
    show(current, current.local, "local");
    setInterpretation({ status: "idle" });
  }, [confirmReplacingEdits, isCurrent, show]);

  const discard = useCallback(async () => {
    const current = sessionRef.current;
    if (!current || !isCurrent(current)) return;
    if (
      currentVersion() !== current.importedVersion &&
      !(await confirm({
        title: "Discard import?",
        message: "Your changes to the imported resume will be lost, and the resume you had open before this import review comes back.",
        confirmLabel: "Discard import",
        tone: "danger"
      }))
    ) {
      return;
    }
    if (!isCurrent(current)) return;
    abortRef.current?.abort();
    restore(current.snapshot);
    endSession();
  }, [confirm, currentVersion, endSession, isCurrent, restore]);

  const dismissRefusal = useCallback(() => setStatus({ kind: "idle" }), []);

  return {
    status,
    reviewOpen,
    review: reviewOpen ? (session as ResumeImportReview) : null,
    original: reviewOpen ? { blob: session!.original, fileName: session!.fileName } : null,
    interpretation,
    importFile,
    interpret,
    stopInterpretation,
    dismissInterpretation,
    showLocalReading,
    discard,
    dismissRefusal
  };
}
