// The tools the local MCP server offers an agent. Each one is a thin client of
// the running RoleFit server's loopback routes: the server owns validation,
// locking and storage, so this process never touches the workspace itself.

import { parseResumeFile } from "@typeset/engine/lib/resumeFile.ts";
import { MAX_APPENDED_ANSWERS } from "../server/applications/answerService.ts";
import { COMMIT_STATUSES, MAX_ACKNOWLEDGED_DUPLICATES } from "../server/applications/commitService.ts";
import { APPLICATION_EVENT_TYPES } from "../server/applications/eventService.ts";
import { APPLICATION_SOURCES } from "../server/applications/schema.ts";
import { INTERVIEW_KINDS, STAGE_HISTORY_NOTE_MAX_LENGTH } from "../shared/applicationStageHistoryContract.ts";
import { FIT_ASSESSMENT_VERDICTS } from "../shared/fitAssessmentContract.ts";
import { APPLICATION_STATUSES } from "../src/lib/applicationStatusTransitions.ts";
import {
  findDuplicateApplications,
  normalizeCompanyName,
  type DuplicateCandidate
} from "../src/lib/jobIdentity.ts";
import { LEGACY_NOT_APPLYING_REASONS, NOT_APPLYING_REASONS } from "../src/lib/notApplying.ts";
import { serializeResumeData } from "../src/lib/resumeText.ts";

export type ToolResult = { ok: boolean; value: unknown };

export type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<ToolResult>;
};

type TrackerRecord = DuplicateCandidate & {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  appliedAt?: string;
  notApplyingAt?: string;
};

const SEARCH_LIMIT_MAX = 100;
const REQUEST_TIMEOUT_MS = 60_000;
const OFFERED_SKIP_REASONS = NOT_APPLYING_REASONS.filter((reason) => !LEGACY_NOT_APPLYING_REASONS.includes(reason));
const timestamp = { type: "string", description: "Canonical ISO timestamp, e.g. 2026-10-23T14:05:00.000Z." };
// These writes have no request id, so a lost reply must not become a blind retry.
const CHECK_BEFORE_RETRY =
  " A refusal saved nothing and can be corrected and resent. If the call times out or returns no reply, it may " +
  "have saved: read the record (search_applications or get_application) before retrying, or it can be saved twice.";
const answerList = (description: string) => ({
  type: "array",
  description: `${description} A plain {question, answer} pair is enough; savedAt defaults to now.`,
  items: {
    type: "object",
    required: ["question", "answer"],
    properties: { question: { type: "string" }, answer: { type: "string" }, savedAt: timestamp }
  }
});

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

export function createTools(baseUrl: string, fetchImpl: typeof fetch = fetch): Tool[] {
  async function request(method: "GET" | "POST", path: string, body?: unknown): Promise<ToolResult> {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
    } catch (error) {
      return {
        ok: false,
        value: {
          error: error instanceof Error && error.name === "TimeoutError"
            ? `RoleFit at ${baseUrl} did not answer within ${REQUEST_TIMEOUT_MS / 1000} seconds.`
            : `RoleFit is not reachable at ${baseUrl}. Start it (npm run dev:rolefit or the desktop companion) or set ROLEFIT_URL to its port.`
        }
      };
    }
    const value = await response.json().catch(() => ({ error: `RoleFit answered ${response.status} without JSON.` }));
    return { ok: response.ok, value };
  }

  return [
    {
      name: "search_applications",
      title: "Search applications",
      description:
        "Find tracker records before committing a new one or changing a stage. `posting` runs the tracker's own " +
        "duplicate matcher (posting id, requisition id, URL, company + role, description similarity) and returns " +
        "matches strongest first with their evidence; `company`, `query` and `status` filter. Returns summaries, " +
        "including each record's id and updatedAt.",
      inputSchema: {
        type: "object",
        properties: {
          posting: {
            type: "object",
            description: "A job to check for duplicates. Give as many fields as you have.",
            properties: {
              jobUrl: { type: "string" },
              jobText: { type: "string", description: "Raw posting text." },
              company: { type: "string" },
              role: { type: "string" },
              location: { type: "string" }
            },
            additionalProperties: false
          },
          company: { type: "string", description: "Company name; legal suffixes and case are ignored." },
          query: { type: "string", description: "Case-insensitive text in title, company, role, or job URL." },
          status: { type: "string", enum: [...APPLICATION_STATUSES] },
          limit: { type: "integer", minimum: 1, maximum: SEARCH_LIMIT_MAX, default: 20 }
        },
        additionalProperties: false
      },
      async run(args) {
        const listed = await request("GET", "/api/applications");
        if (!listed.ok) return listed;
        const applications = (listed.value as { applications: TrackerRecord[] }).applications;
        const posting = args.posting === undefined ? null : args.posting;
        if (posting !== null && (!posting || typeof posting !== "object" || Array.isArray(posting)
          || Object.values(posting).some((value) => typeof value !== "string"))) {
          return { ok: false, value: { error: "posting: must be an object of text fields (jobUrl, jobText, company, role, location)." } };
        }
        let results: { record: TrackerRecord; match?: Record<string, unknown> }[] = posting
          ? findDuplicateApplications(posting as Record<string, string>, applications).map(({ application, level, confidence, evidence }) => ({
              record: application,
              match: { level, confidence, evidence }
            }))
          : [...applications]
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .map((record) => ({ record }));
        const company = typeof args.company === "string" ? normalizeCompanyName(args.company) : "";
        if (company) results = results.filter(({ record }) => normalizeCompanyName(record.company).includes(company));
        const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
        if (query) {
          results = results.filter(({ record }) =>
            [record.title, record.company, record.role, record.jobUrl].some((field) => field?.toLowerCase().includes(query))
          );
        }
        if (typeof args.status === "string") results = results.filter(({ record }) => record.status === args.status);
        const limit = Number.isInteger(args.limit) ? Math.min(Math.max(args.limit as number, 1), SEARCH_LIMIT_MAX) : 20;
        return {
          ok: true,
          value: {
            total: results.length,
            applications: results.slice(0, limit).map(({ record, match }) => ({
              id: record.id,
              title: record.title,
              company: record.company,
              role: record.role,
              status: record.status,
              jobUrl: record.jobUrl,
              location: record.location,
              appliedAt: record.appliedAt,
              notApplyingAt: record.notApplyingAt,
              createdAt: record.createdAt,
              updatedAt: record.updatedAt,
              ...(match ? { match } : {})
            }))
          }
        };
      }
    },
    {
      name: "get_application",
      title: "Get application",
      description:
        "Read one tracker record in full: job details and description, notes, Fit Assessment snapshot, saved " +
        "answers, timeline (stageHistory), and which documents were saved. Use it before a follow-up, interview " +
        "prep, or any change that sends baseUpdatedAt.",
      inputSchema: {
        type: "object",
        required: ["id"],
        additionalProperties: false,
        properties: { id: { type: "string", description: "The record id from search_applications." } }
      },
      async run({ id }) {
        const listed = await request("GET", "/api/applications");
        if (!listed.ok) return listed;
        const record = (listed.value as { applications: TrackerRecord[] }).applications.find((application) => application.id === id);
        return record ? { ok: true, value: record } : { ok: false, value: { error: `No application has id ${String(id)}.` } };
      }
    },
    {
      name: "commit_application",
      title: "Commit application",
      description:
        "Create one tracker record, with its tailored resume and cover letter, in a single atomic save. Use status " +
        "`applied` for a submitted application, `not_applying` for a job you decided to skip, or `draft` for one " +
        "you started but have not submitted (no documents or dates; submit it later with update_application_status). " +
        "The server runs the tracker's duplicate matcher and refuses with status 409 and `duplicates` while any " +
        "match is not listed in acknowledgedDuplicates; if the match is the same application (often your own " +
        "draft), change that record instead. Send dryRun: true to get the same answer without saving anything. " +
        "The server assigns id, createdAt and updatedAt, builds the document metadata, and stamps applicationId " +
        "on full answer revisions. Every value you send is stored exactly as sent or the whole commit is refused " +
        "with `issues` naming each field; nothing is saved on a refusal. Omit a field rather than sending null. " +
        "Unlisted tracker fields (location, salaryMin, contacts, aiUsage, ...) are accepted under the same rule." +
        CHECK_BEFORE_RETRY,
      inputSchema: {
        type: "object",
        required: ["application"],
        additionalProperties: false,
        properties: {
          application: {
            type: "object",
            required: ["title", "status"],
            additionalProperties: true,
            properties: {
              title: { type: "string", maxLength: 200, description: "Usually \"<role> at <company>\"." },
              company: { type: "string", maxLength: 200 },
              role: { type: "string", maxLength: 200 },
              status: { type: "string", enum: [...COMMIT_STATUSES] },
              jobUrl: { type: "string", maxLength: 2000 },
              source: { type: "string", enum: [...APPLICATION_SOURCES] },
              jobDescription: { type: "string", description: "The prepared job brief." },
              rawJobDescription: { type: "string", description: "The original posting text." },
              appliedAt: { ...timestamp, description: "When it was submitted (applied only). Defaults to now." },
              notApplyingAt: { ...timestamp, description: "When you decided to skip (not_applying only). Defaults to now." },
              notApplyingReasons: {
                type: "array",
                items: { type: "string", enum: OFFERED_SKIP_REASONS },
                uniqueItems: true,
                description: "Stored in the listed order whatever order you send."
              },
              notApplyingNote: { type: "string", maxLength: 2000 },
              notes: { type: "string" },
              resumeUsed: { type: "string", enum: ["base", "tailored"], description: "Which resume was sent (applied only)." },
              fitAssessment: {
                type: "object",
                description: "The Fit Assessment snapshot: `result` is the fitAssessment object from /api/job-analysis, unchanged.",
                required: ["result", "resumeLabel"],
                properties: {
                  result: {
                    type: "object",
                    properties: { status: { type: "string" }, verdict: { type: "string", enum: [...FIT_ASSESSMENT_VERDICTS] } }
                  },
                  resumeLabel: { type: "string", description: "Which resume was assessed." },
                  assessedAt: timestamp,
                  provider: { type: "string" },
                  model: { type: "string" },
                  reasoningEffort: { type: "string" },
                  attempts: { type: "integer", minimum: 1, maximum: 9 },
                  promptVersion: { type: "string", description: "e.g. fit-assessment-direct-rubric-v7" }
                }
              },
              applicationAnswers: answerList("Answers given in the application.")
            }
          },
          dryRun: { type: "boolean", description: "Validate everything, including documents and duplicates, and save nothing." },
          acknowledgedDuplicates: {
            type: "array",
            maxItems: MAX_ACKNOWLEDGED_DUPLICATES,
            items: { type: "string" },
            description: "Ids of matching records you reviewed and are keeping separate from this one."
          },
          documents: {
            type: "object",
            description: "Editable sources sent with an applied application. PDFs are not accepted here.",
            additionalProperties: false,
            properties: {
              resume: {
                type: "object",
                required: ["sourceText"],
                additionalProperties: false,
                properties: {
                  sourceText: { type: "string", description: "The complete .resume file text." },
                  fileName: { type: "string", maxLength: 200 }
                }
              },
              cover: {
                type: "object",
                required: ["sourceText"],
                additionalProperties: false,
                properties: {
                  sourceText: { type: "string", description: "The complete .cover file text." },
                  fileName: { type: "string", maxLength: 200 }
                }
              }
            }
          }
        }
      },
      run: (args) => request("POST", "/api/applications/commit", args)
    },
    {
      name: "update_application_status",
      title: "Update application status",
      description:
        "Move a tracker record to a new stage, as the tracker row's stage menu would: the server applies the change " +
        "to the latest saved record and adds the stage-history entry. Moves the menu does not offer are refused " +
        "with the allowed list. Setting the current stage again changes nothing, so a retry after a lost reply is safe.",
      inputSchema: {
        type: "object",
        required: ["id", "status"],
        additionalProperties: false,
        properties: {
          id: { type: "string", description: "The record id from search_applications." },
          status: { type: "string", enum: [...APPLICATION_STATUSES] },
          date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Calendar day of the change (YYYY-MM-DD), between the application date and today; " +
              "defaults to today. Only a move between submitted stages takes one: submitting a Draft or a " +
              "skipped job, or moving to not_applying, is dated now." },
          baseUpdatedAt: {
            ...timestamp,
            description: "The updatedAt you read; if the record changed since, the change is refused and the current record returned."
          }
        }
      },
      run: ({ id, ...body }) => typeof id === "string"
        ? request("POST", `/api/applications/${encodeURIComponent(id)}/status`, body)
        : Promise.resolve({ ok: false, value: { error: "id: required string" } })
    },
    {
      name: "log_application_event",
      title: "Log application event",
      description:
        "Add an interview, employer response, or follow-up sent to a submitted application's timeline, as the " +
        "tracker's Log buttons do. Logging a new interview on an Applied or Ghosted record also moves it to " +
        "Interviewing (statusChanged in the result). A record with no application date has no timeline. For a " +
        "rejection or an offer, use update_application_status instead." + CHECK_BEFORE_RETRY,
      inputSchema: {
        type: "object",
        required: ["id", "type"],
        additionalProperties: false,
        properties: {
          id: { type: "string", description: "The record id from search_applications." },
          type: { type: "string", enum: [...APPLICATION_EVENT_TYPES], description: "followup means a follow-up you sent." },
          kind: { type: "string", enum: [...INTERVIEW_KINDS], description: "Required for an interview; omit otherwise." },
          date: {
            type: "string",
            pattern: "^\\d{4}-\\d{2}-\\d{2}$",
            description: "Calendar day (YYYY-MM-DD), defaults to today. A future interview date is a scheduled interview."
          },
          note: { type: "string", maxLength: STAGE_HISTORY_NOTE_MAX_LENGTH, description: "Short context, e.g. the interviewer's name." },
          baseUpdatedAt: {
            ...timestamp,
            description: "The updatedAt you read; if the record changed since, nothing is saved and the current record is returned."
          }
        }
      },
      run: ({ id, ...body }) => typeof id === "string"
        ? request("POST", `/api/applications/${encodeURIComponent(id)}/events`, body)
        : Promise.resolve({ ok: false, value: { error: "id: required string" } })
    },
    {
      name: "add_application_answers",
      title: "Add application answers",
      description:
        "Append answers to a saved tracker record, for questions answered after commit_application (a follow-up " +
        "form, a recruiter's questions). Saved answers are never changed; a corrected answer is a new entry. The " +
        "server stamps applicationId on full answer revisions. If any answer is invalid, nothing is saved and " +
        "`issues` says why." + CHECK_BEFORE_RETRY,
      inputSchema: {
        type: "object",
        required: ["id", "answers"],
        additionalProperties: false,
        properties: {
          id: { type: "string", description: "The record id from search_applications." },
          answers: { ...answerList("The new answers."), minItems: 1, maxItems: MAX_APPENDED_ANSWERS },
          baseUpdatedAt: {
            ...timestamp,
            description: "The updatedAt you read; if the record changed since, nothing is saved and the current record is returned."
          }
        }
      },
      run: ({ id, ...body }) => typeof id === "string"
        ? request("POST", `/api/applications/${encodeURIComponent(id)}/answers`, body)
        : Promise.resolve({ ok: false, value: { error: "id: required string" } })
    },
    {
      name: "list_resumes",
      title: "List resumes",
      description:
        "List the base resumes saved in the RoleFit workspace (default.resume first), by fileName and label. " +
        "Read one with get_resume.",
      inputSchema: { type: "object", additionalProperties: false, properties: {} },
      async run() {
        const workspace = await request("GET", "/api/workspace");
        if (!workspace.ok) return workspace;
        const { baseResumeOptions } = workspace.value as { baseResumeOptions: { fileName: string; label: string }[] };
        return { ok: true, value: { resumes: baseResumeOptions.map(({ fileName, label }) => ({ fileName, label })) } };
      }
    },
    {
      name: "get_resume",
      title: "Get resume",
      description:
        "Read one saved base resume. `text` is the plain text RoleFit itself sends to Fit Assessment and Polish " +
        "(headings, entry rows, bullets; no formatting markup); `sourceText` is the complete .resume file, the " +
        "starting point for a tailored copy to send with commit_application.",
      inputSchema: {
        type: "object",
        required: ["fileName"],
        additionalProperties: false,
        properties: { fileName: { type: "string", description: "A fileName from list_resumes, e.g. default.resume." } }
      },
      async run({ fileName }) {
        if (typeof fileName !== "string" || !fileName) return { ok: false, value: { error: "fileName: required string" } };
        const read = await request("POST", "/api/workspace/base-resume/candidates", { fileNames: [fileName] });
        if (!read.ok) return read;
        const [resume] = (read.value as { candidates: { fileName: string; label: string; text: string }[] }).candidates;
        if (!resume) return { ok: false, value: { error: `No readable saved resume is named ${fileName}. List them with list_resumes.` } };
        return {
          ok: true,
          value: {
            fileName: resume.fileName,
            label: resume.label,
            text: serializeResumeData(parseResumeFile(resume.text).data),
            sourceText: resume.text
          }
        };
      }
    }
  ];
}
