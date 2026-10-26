// The MCP server's view of the running RoleFit server: loopback requests and
// the reads several tools share. The server owns validation, locking and
// storage, so this process never touches the workspace itself.

import { coverLetterPlainText, parseCoverLetterFile } from "@typeset/engine/lib/coverLetter.ts";
import { parseResumeFile } from "@typeset/engine/lib/resumeFile.ts";
import { buildCandidateFactsContext } from "../src/lib/candidateFacts.ts";
import type { DuplicateCandidate } from "../src/lib/jobIdentity.ts";
import { serializeResumeData } from "../src/lib/resumeText.ts";
import type { PersistedSettings } from "../src/lib/settings.ts";

export type ToolResult = { ok: boolean; value: unknown };

export type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  // `signal` aborts when the client cancels the call.
  run: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<ToolResult>;
};

export type SavedAnswer = { question: string; answer: string; savedAt: string; questionId?: string; status?: string; warnings?: string[] };
type DocumentArtifacts = { hasPdf: boolean; hasSource: boolean; fileName: string; savedAt: string };

export type TrackerRecord = DuplicateCandidate & {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  appliedAt?: string;
  notApplyingAt?: string;
  jobDescription?: string;
  rawJobDescription?: string;
  resumeUsed?: string;
  fitAssessment?: unknown;
  applicationAnswers?: SavedAnswer[];
  resumeArtifacts?: DocumentArtifacts;
  coverLetterArtifacts?: DocumentArtifacts;
};

export type DocumentKind = "resume" | "cover";
export type ReadDocument = { fileName: string; savedAt?: string; label?: string; text: string; sourceText: string };

const REQUEST_TIMEOUT_MS = 60_000;

// Loopback only: the tracker holds personal data and this server has no
// business sending it anywhere else.
export function roleFitBaseUrl(raw = "http://127.0.0.1:5181"): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`ROLEFIT_URL is not a URL: ${raw}`);
  }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.pathname !== "/" || url.search || url.username) {
    throw new Error("ROLEFIT_URL must be a loopback origin such as http://127.0.0.1:5181.");
  }
  return url.origin;
}

// Plain text as the app reads it; a file that does not parse is an error.
export function documentText(kind: DocumentKind, sourceText: string, name: string): ToolResult {
  try {
    return {
      ok: true,
      value: kind === "resume"
        ? serializeResumeData(parseResumeFile(sourceText).data)
        : coverLetterPlainText(parseCoverLetterFile(sourceText).data)
    };
  } catch (error) {
    return { ok: false, value: { error: `${name} could not be read: ${error instanceof Error ? error.message : String(error)}` } };
  }
}

// The standing facts RoleFit sends its AI stages: unset facts are
// "unspecified", as in Settings, and claim nothing.
export function candidateProfile(settings: PersistedSettings) {
  const declared = <T extends string>(value: T | undefined) => value ?? ("unspecified" as T);
  return {
    profileBackground: settings.profileBackground ?? "",
    declaredFacts: buildCandidateFactsContext({
      citizenshipStatus: declared(settings.citizenshipStatus),
      legallyAuthorizedToWork: declared(settings.legallyAuthorizedToWork),
      requiresSponsorship: declared(settings.requiresSponsorship),
      educationLevel: declared(settings.educationLevel),
      major: settings.major ?? "",
      gpa: settings.gpa,
      availabilityNotice: declared(settings.availabilityNotice),
      availabilityDate: settings.availabilityDate || undefined
    })
  };
}

export function createClient(baseUrl: string, fetchImpl: typeof fetch = fetch) {
  async function request(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    { as = "json", timeoutMs = REQUEST_TIMEOUT_MS, signal }: { as?: "json" | "text"; timeoutMs?: number; signal?: AbortSignal } = {}
  ): Promise<ToolResult> {
    let response: Response;
    try {
      // Closing the request makes RoleFit stop the work it started for it.
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal ? AbortSignal.any([AbortSignal.timeout(timeoutMs), signal]) : AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      if (signal?.aborted) return { ok: false, value: { error: "Cancelled." } };
      return {
        ok: false,
        value: {
          error: error instanceof Error && error.name === "TimeoutError"
            ? `RoleFit at ${baseUrl} did not answer within ${timeoutMs / 1000} seconds.`
            : `RoleFit is not reachable at ${baseUrl}. Start it (npm run dev:rolefit or the desktop companion) or set ROLEFIT_URL to its port.`
        }
      };
    }
    if (as === "text" && response.ok) return { ok: true, value: await response.text() };
    const value = await response.json().catch(() => ({ error: `RoleFit answered ${response.status} without JSON.` }));
    return { ok: response.ok, value };
  }

  async function listApplications(): Promise<TrackerRecord[] | ToolResult> {
    const listed = await request("GET", "/api/applications");
    return listed.ok ? (listed.value as { applications: TrackerRecord[] }).applications : listed;
  }

  async function getApplication(id: unknown): Promise<TrackerRecord | ToolResult> {
    if (typeof id !== "string" || !id) return { ok: false, value: { error: "id: required string" } };
    const applications = await listApplications();
    if (!Array.isArray(applications)) return applications;
    return applications.find((application) => application.id === id)
      ?? { ok: false, value: { error: `No application has id ${id}.` } };
  }

  // One document saved on an application, as source and plain text.
  async function applicationDocument(id: string, kind: DocumentKind, artifacts: DocumentArtifacts | undefined) {
    if (!artifacts) return null;
    const { fileName, savedAt } = artifacts;
    if (!artifacts.hasSource) return { ok: true, value: { fileName, savedAt, pdfOnly: true } };
    const read = await request("GET", `/api/applications/${encodeURIComponent(id)}/documents/${kind}.${kind}`, undefined, { as: "text" });
    if (!read.ok) return read;
    const sourceText = read.value as string;
    const text = documentText(kind, sourceText, `The saved ${kind}.${kind} of application ${id}`);
    return text.ok ? { ok: true, value: { fileName, savedAt, text: text.value, sourceText } } : text;
  }

  // A saved base resume or cover-letter variant from the workspace.
  async function workspaceVariant(kind: DocumentKind, fileName: unknown): Promise<ToolResult> {
    if (typeof fileName !== "string" || !fileName) return { ok: false, value: { error: "fileName: required string" } };
    const read = await request(
      "POST",
      kind === "resume" ? "/api/workspace/base-resume/candidates" : "/api/workspace/cover-letter/candidates",
      { fileNames: [fileName] }
    );
    if (!read.ok) return read;
    const [variant] = (read.value as { candidates: { fileName: string; label: string; text: string }[] }).candidates;
    if (!variant) {
      const [noun, lister] = kind === "resume" ? ["resume", "list_resumes"] : ["cover letter", "list_cover_letters"];
      return { ok: false, value: { error: `No readable saved ${noun} is named ${fileName}. List them with ${lister}.` } };
    }
    const text = documentText(kind, variant.text, fileName);
    return text.ok
      ? { ok: true, value: { fileName: variant.fileName, label: variant.label, text: text.value, sourceText: variant.text } }
      : text;
  }

  // The saved Settings; a missing file reads as the defaults.
  async function readSettings(): Promise<{ saved: boolean; settings: PersistedSettings } | ToolResult> {
    const read = await request("GET", "/api/workspace/preferences");
    if (!read.ok) return read;
    const snapshot = read.value as { exists: boolean; invalid?: boolean; newer?: boolean; settings?: PersistedSettings };
    if (snapshot.newer) {
      return { ok: false, value: { error: "RoleFit's settings were saved by a newer version of RoleFit. Update RoleFit to read them." } };
    }
    if (snapshot.invalid) {
      return { ok: false, value: { error: "RoleFit's saved settings are invalid. Open RoleFit to repair or restore them." } };
    }
    return { saved: snapshot.exists, settings: snapshot.settings ?? {} };
  }

  return { request, listApplications, getApplication, applicationDocument, workspaceVariant, readSettings };
}

export type RoleFitClient = ReturnType<typeof createClient>;

export const isToolResult = (value: unknown): value is ToolResult =>
  Boolean(value && typeof value === "object" && "ok" in value && "value" in value);
