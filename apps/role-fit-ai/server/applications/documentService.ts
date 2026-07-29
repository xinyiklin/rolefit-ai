import { readFile, rm, rmdir } from "node:fs/promises";
import { join } from "node:path";

import { documentSourceFingerprint } from "../../src/lib/documentSourceFingerprint.ts";
import {
  ApplicationDocumentError,
  DOCUMENT_SOURCE_EXTENSION,
  writeApplicationFile,
  type ApplicationDocumentKind
} from "./documents.ts";
import {
  readApplications,
  withApplicationsLock,
  writeApplications
} from "./storage.ts";
import {
  applicationDocumentDir,
  nextApplicationRevision,
  readOptionalApplicationFile,
  requireApplicationRevision,
  restoreApplicationFile
} from "./routeSupport.ts";

type PersistApplicationDocumentOptions = {
  workspaceDir: string;
  id: string;
  kind: ApplicationDocumentKind;
  baseUpdatedAt: unknown;
  fileName: string;
  sourceOrigin: "editor" | "upload";
  sourceText: string;
  sourceBuffer: Buffer | null;
  pdfBuffer: Buffer | null;
  remove: boolean;
};

// File bytes and tracker metadata form one application-revision transaction.
// Capture the previous slot before mutation and restore it if metadata commit
// fails; callers must not reorder these operations independently.
export async function persistApplicationDocument({
  workspaceDir,
  id,
  kind,
  baseUpdatedAt,
  fileName,
  sourceOrigin,
  sourceText,
  sourceBuffer,
  pdfBuffer,
  remove
}: PersistApplicationDocumentOptions) {
  const dir = applicationDocumentDir(id, workspaceDir);
  if (!dir) {
    throw new ApplicationDocumentError("Invalid application id.", 400);
  }
  const sourceFileName = `${kind}.${DOCUMENT_SOURCE_EXTENSION[kind]}`;
  return withApplicationsLock(async () => {
    const existing = await readApplications(workspaceDir);
    const current = requireApplicationRevision(existing, id, baseUpdatedAt);
    const pdfFileName = `${kind}.pdf`;
    const previousPdf = await readOptionalApplicationFile(
      join(dir, pdfFileName)
    );
    const previousSource = await readOptionalApplicationFile(
      join(dir, sourceFileName)
    );
    const artifacts = remove
      ? undefined
      : {
          hasPdf: Boolean(pdfBuffer),
          hasSource: Boolean(sourceBuffer),
          ...(sourceText
            ? { sourceFingerprint: documentSourceFingerprint(sourceText) }
            : {}),
          fileName,
          savedAt: new Date().toISOString()
        };
    const nextApplication = {
      ...current,
      ...(kind === "resume"
        ? {
            ...(remove || sourceOrigin === "upload"
              ? { resumeUsed: undefined }
              : {}),
            resumeArtifacts: artifacts
          }
        : { coverLetterArtifacts: artifacts }),
      updatedAt: nextApplicationRevision(current.updatedAt)
    };
    const nextApplications = existing.map((application) =>
      application.id === id ? nextApplication : application
    );

    try {
      if (remove) {
        await Promise.all([
          rm(join(dir, pdfFileName), { force: true }),
          rm(join(dir, sourceFileName), { force: true })
        ]);
      } else {
        if (pdfBuffer) {
          await writeApplicationFile(dir, pdfFileName, pdfBuffer);
        } else {
          await rm(join(dir, pdfFileName), { force: true });
        }
        if (sourceBuffer) {
          await writeApplicationFile(dir, sourceFileName, sourceBuffer);
        } else {
          await rm(join(dir, sourceFileName), { force: true });
        }
      }
      const applications = await writeApplications(
        workspaceDir,
        nextApplications
      );
      if (remove) await rmdir(dir).catch(() => undefined);
      return {
        applications,
        application: applications.find(
          (application) => application.id === id
        ),
        artifacts
      };
    } catch (error) {
      await Promise.all([
        restoreApplicationFile(dir, pdfFileName, previousPdf),
        restoreApplicationFile(dir, sourceFileName, previousSource)
      ]).catch(() => undefined);
      throw error;
    }
  });
}

export async function readApplicationDocument(
  workspaceDir: string,
  id: string,
  kind: ApplicationDocumentKind,
  format: string
): Promise<Buffer> {
  const dir = applicationDocumentDir(id, workspaceDir);
  if (!dir) {
    throw new ApplicationDocumentError("Invalid application id.", 400);
  }
  const fileName = `${kind}.${format}`;
  return withApplicationsLock(async () => {
    const applications = await readApplications(workspaceDir);
    const application = applications.find((candidate) => candidate.id === id);
    const artifacts =
      kind === "resume"
        ? application?.resumeArtifacts
        : application?.coverLetterArtifacts;
    const isTracked =
      format === "pdf" ? artifacts?.hasPdf : artifacts?.hasSource;
    if (!application || !isTracked) {
      throw new ApplicationDocumentError("Saved document not found.", 404);
    }
    return readFile(join(dir, fileName));
  });
}
