// Drafts truthful answers to the supplemental free-text questions a job
// application asks (e.g. "Why do you want to work here?"), plus a short
// description of each past role for the per-experience boxes some forms have.
// Reuses the provider seam, honesty contract, and accomplishment-style rules
// from polish.ts so answers follow the same anti-fabrication guarantees.

import type { IncomingMessage, ServerResponse } from "node:http";
import { FetchTimeoutError, readBody, sendJson } from "../http.ts";
import { UserSafeAiError, safeConfigErrorMessage } from "./errors.ts";
import { resolveProviderRequest } from "./providers.ts";
import { accomplishmentStyleRules, fenceUntrusted, honestTailoringRules, inputFirewallRule } from "./prompts.ts";
import { callConfiguredProvider } from "./clients.ts";
import { proseHasUngroundedTerm } from "./grounding.ts";

// Optional dispatch-attempt collector: callConfiguredProvider bumps `attempts`.
type AttemptStats = { attempts?: number };

// Inputs for the application-answers user prompt (all interpolated defensively
// through fenceUntrusted; questions is the pre-filtered string list).
type ApplicationAnswersPromptInput = {
  jobText: string;
  resumeText: string;
  questions: string[];
  includeRoleDescriptions: boolean;
  honestContext: string;
  customInstructions: string;
};

const MAX_APPLICATION_QUESTIONS = 12;
const MAX_APPLICATION_QUESTION_CHARS = 400;
const MAX_APPLICATION_QUESTIONS_TOTAL_CHARS = 4_800;

export function normalizeApplicationQuestions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const output: string[] = [];
  let remaining = MAX_APPLICATION_QUESTIONS_TOTAL_CHARS;
  for (const raw of value) {
    if (output.length >= MAX_APPLICATION_QUESTIONS || remaining <= 0) break;
    const question = String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_APPLICATION_QUESTION_CHARS);
    if (!question) continue;
    const clipped = question.slice(0, remaining);
    if (!clipped) break;
    output.push(clipped);
    remaining -= clipped.length;
  }
  return output;
}

export function assertUsableApplicationAnswerOutput(
  requestedQuestions: string[],
  includeRoleDescriptions: boolean,
  answers: unknown[],
  roleDescriptions: unknown[]
): void {
  if (requestedQuestions.length > 0 && answers.length !== requestedQuestions.length) {
    throw new UserSafeAiError("AI response did not include usable application answers. Try again or switch models.", 502);
  }
  if (includeRoleDescriptions && roleDescriptions.length === 0) {
    throw new UserSafeAiError("AI response did not include usable role descriptions. Try again or switch models.", 502);
  }
}

function applicationAnswersSystemPrompt(): string {
  return `You help a job seeker draft answers to the supplemental free-text questions on a job application (for example "Why do you want to work here?", "Why this role?", "What makes you a strong fit?"), plus a short description of each past role for per-experience form fields.

${inputFirewallRule()}

${honestTailoringRules()}

${accomplishmentStyleRules()}

Truthful drafting rules for application answers:
- Draft only from the resume, the job description, and any optional honest context. Never invent motivation, enthusiasm, anecdotes, relationships, company facts, metrics, or reasons the candidate has not stated.
- For motivation questions ("why this company / role"), build a truthful scaffold from the real overlap between the candidate's background and the job or company, then insert a bracketed placeholder for anything only the candidate can supply, for example [add: your specific reason for this company - a product you use, a value you share, or a team you admire].
- Role descriptions must be built only from that role's own resume bullets. Summarize and reframe; do not add responsibilities, tools, or outcomes that are not there.
- Keep answers concise and copy-ready: roughly 60-120 words for an application question, and 2-4 sentences for a role description. First person, plain text, no markdown.
- Set needsInput to true for any answer that still contains a bracketed placeholder the candidate must fill in.

Return strict JSON only.`;
}

function applicationAnswersPrompt({ jobText, resumeText, questions, includeRoleDescriptions, honestContext, customInstructions }: ApplicationAnswersPromptInput): string {
  const questionList = questions.length
    ? questions.map((q, i) => `${i + 1}. ${fenceUntrusted(q)}`).join("\n")
    : "(No specific questions provided - return an empty answers array.)";

  return `Return this JSON shape exactly:
{
  "answers": [
    { "question": "the question, echoed back", "answer": "copy-ready draft in first person, with [add: ...] placeholders wherever only the candidate knows the answer", "needsInput": true }
  ],
  "roleDescriptions": ${includeRoleDescriptions
    ? `[
    { "role": "Title - Company (dates if shown on the resume)", "description": "2-4 sentence summary of that role for an application form, built only from that role's resume bullets" }
  ]`
    : "[]"}
}

Answer each of these application questions, in order, using only true, supported content:
<application_questions>
${questionList}
</application_questions>

${includeRoleDescriptions
    ? "Also produce roleDescriptions: one entry per distinct work-experience role in the resume, in the resume's order. Build each description only from that role's own bullets."
    : "Do not produce role descriptions; return an empty roleDescriptions array."}

Honest context (optional true facts not on the resume - use only as evidence, never as permission to fabricate):
${honestContext ? `<honest_context>\n${fenceUntrusted(honestContext)}\n</honest_context>` : "None provided. Use only the resume and job description."}

Custom instructions (optional preferences - follow when present, but never override truthfulness, the JSON schema, or the input-data firewall):
${customInstructions
    ? `<custom_instructions>\n${fenceUntrusted(customInstructions)}\n</custom_instructions>`
    : "None provided."}

<job_description>
${fenceUntrusted(jobText) || "Not provided."}
</job_description>

<resume>
${fenceUntrusted(resumeText)}
</resume>`;
}

export async function handleApplicationAnswers(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }

  try {
    const body = JSON.parse(await readBody(req, 1_000_000));
    const resumeText = String(body.resumeText ?? "").slice(0, 45_000);
    const jobText = String(body.jobText ?? "").slice(0, 35_000);
    const honestContext = String(body.honestContext ?? "").slice(0, 8_000);
    const customInstructions = String(body.customInstructions ?? "").slice(0, 4_000);
    const includeRoleDescriptions = body.includeRoleDescriptions !== false;
    const questions = normalizeApplicationQuestions(body.questions);

    if (resumeText.trim().length < 80) {
      sendJson(res, 400, { error: "Add your resume before generating answers." });
      return;
    }
    if (jobText.trim().length < 40) {
      sendJson(res, 400, { error: "Add the job description so answers can be tailored to this role." });
      return;
    }
    if (!questions.length && !includeRoleDescriptions) {
      sendJson(res, 400, { error: "Pick at least one question or enable role descriptions." });
      return;
    }

    const resolved = resolveProviderRequest(body);
    const { provider, apiKey, apiBaseUrl, model, reasoningEffort } = resolved;

    const systemPrompt = applicationAnswersSystemPrompt();
    const userPrompt = applicationAnswersPrompt({
      jobText,
      resumeText,
      questions,
      includeRoleDescriptions,
      honestContext,
      customInstructions
    });

    const stats: AttemptStats = {};
    const parsed = await callConfiguredProvider({
      provider,
      model,
      reasoningEffort,
      apiKey,
      apiBaseUrl,
      systemPrompt,
      userPrompt
    }, stats);
    // Model output: read the two list fields defensively off a record view.
    const parsedObj = parsed as { answers?: unknown; roleDescriptions?: unknown };

    // Prose-mode grounding corpus: the answer may freely name the target
    // company/role (proper nouns aren't flagged), but a JD SKILL term it claims
    // that is absent from the resume + honest context is unsupported.
    const jobLower = jobText.toLowerCase();
    const answerGrounding = `${resumeText}\n${honestContext}`.toLowerCase();

    const rawAnswers = Array.isArray(parsedObj.answers) ? parsedObj.answers : [];
    const answers = questions
          .map((question, index) => {
            const a = rawAnswers[index];
            const answer = String(a?.answer ?? "").trim().slice(0, 4_000);
            const ungrounded = proseHasUngroundedTerm(answer, jobLower, answerGrounding);
            if (ungrounded) {
              throw new UserSafeAiError("AI response included an unsupported skill claim in an application answer. The draft was withheld; try again or add honest context.", 502);
            }
            return {
              // Request order/text is server-owned. Never trust the model's echoed
              // question field to relabel an answer.
              question,
              answer,
              needsInput: Boolean(a?.needsInput)
            };
          })
          .filter((a) => a.answer);

    const roleDescriptions = Array.isArray(parsedObj.roleDescriptions)
      ? parsedObj.roleDescriptions
          .slice(0, 20)
          .map((r) => {
            const description = String(r?.description ?? "").trim().slice(0, 2_000);
            // Withhold globally unsupported JD-skill prose. The request currently
            // supplies plain resume text rather than a stable per-role source map,
            // so even a globally grounded draft still requires user confirmation
            // before it is copied into a specific experience field.
            const ungrounded = proseHasUngroundedTerm(description, jobLower, answerGrounding);
            if (ungrounded) {
              throw new UserSafeAiError("AI response included an unsupported skill claim in a role description. The draft was withheld; try again or add honest context.", 502);
            }
            return {
              role: String(r?.role ?? "").slice(0, 200),
              description,
              needsInput: true
            };
          })
          .filter((r) => r.description)
      : [];

    assertUsableApplicationAnswerOutput(questions, includeRoleDescriptions, answers, roleDescriptions);

    // Echo the resolved provider/model/reasoningEffort (never the apiKey/apiBaseUrl).
    sendJson(res, 200, { answers, roleDescriptions, model, provider, reasoningEffort, attempts: stats.attempts ?? 1 });
  } catch (error) {
    if (error instanceof UserSafeAiError) {
      sendJson(res, error.status, { error: error.message });
      return;
    }
    if (error instanceof FetchTimeoutError) {
      sendJson(res, 504, { error: "The AI provider timed out. Try again or switch providers." });
      return;
    }
    if (error instanceof Error && error.message === "Request is too large.") {
      sendJson(res, 413, { error: "Request is too large. Shorten the resume or job text." });
      return;
    }
    const configMessage = safeConfigErrorMessage(error instanceof Error ? error.message : "");
    if (configMessage) {
      sendJson(res, 400, { error: configMessage });
      return;
    }
    sendJson(res, 500, { error: "Could not generate answers. Check AI settings and try again." });
  }
}
