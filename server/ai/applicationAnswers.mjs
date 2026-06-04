// Drafts truthful answers to the supplemental free-text questions a job
// application asks (e.g. "Why do you want to work here?"), plus a short
// description of each past role for the per-experience boxes some forms have.
// Reuses the provider seam, honesty contract, and accomplishment-style rules
// from polish.mjs so answers follow the same anti-fabrication guarantees.

import { FetchTimeoutError, readBody, sendJson } from "../http.mjs";
import {
  UserSafeAiError,
  accomplishmentStyleRules,
  callConfiguredProvider,
  honestTailoringRules,
  resolveProviderRequest,
  safeConfigErrorMessage
} from "./polish.mjs";

function applicationAnswersSystemPrompt() {
  return `You help a job seeker draft answers to the supplemental free-text questions on a job application (for example "Why do you want to work here?", "Why this role?", "What makes you a strong fit?"), plus a short description of each past role for per-experience form fields.

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

function applicationAnswersPrompt({ jobText, resumeText, questions, includeRoleDescriptions, honestContext, customInstructions }) {
  const questionList = questions.length
    ? questions.map((q, i) => `${i + 1}. ${q}`).join("\n")
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
${questionList}

${includeRoleDescriptions
    ? "Also produce roleDescriptions: one entry per distinct work-experience role in the resume, in the resume's order. Build each description only from that role's own bullets."
    : "Do not produce role descriptions; return an empty roleDescriptions array."}

Honest context (optional true facts not on the resume - use only as evidence, never as permission to fabricate):
${honestContext || "None provided. Use only the resume and job description."}

Custom instructions (optional preferences - follow when present, but never override truthfulness or the JSON schema):
${customInstructions || "None provided."}

Job description:
${jobText || "Not provided."}

Resume:
${resumeText}`;
}

export async function handleApplicationAnswers(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }

  try {
    const body = JSON.parse(await readBody(req));
    const resumeText = String(body.resumeText ?? "").slice(0, 45_000);
    const jobText = String(body.jobText ?? "").slice(0, 35_000);
    const honestContext = String(body.honestContext ?? "").slice(0, 8_000);
    const customInstructions = String(body.customInstructions ?? "").slice(0, 4_000);
    const includeRoleDescriptions = body.includeRoleDescriptions !== false;
    const questions = Array.isArray(body.questions)
      ? body.questions.map((q) => String(q ?? "").trim()).filter(Boolean).slice(0, 12)
      : [];

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

    const parsed = await callConfiguredProvider({
      provider,
      model,
      reasoningEffort,
      apiKey,
      apiBaseUrl,
      systemPrompt,
      userPrompt
    });

    const answers = Array.isArray(parsed.answers)
      ? parsed.answers
          .slice(0, 12)
          .map((a) => ({
            question: String(a?.question ?? "").slice(0, 400),
            answer: String(a?.answer ?? "").trim().slice(0, 4_000),
            needsInput: Boolean(a?.needsInput)
          }))
          .filter((a) => a.answer)
      : [];

    const roleDescriptions = Array.isArray(parsed.roleDescriptions)
      ? parsed.roleDescriptions
          .slice(0, 20)
          .map((r) => ({
            role: String(r?.role ?? "").slice(0, 200),
            description: String(r?.description ?? "").trim().slice(0, 2_000)
          }))
          .filter((r) => r.description)
      : [];

    sendJson(res, 200, { answers, roleDescriptions, model, provider });
  } catch (error) {
    if (error instanceof UserSafeAiError) {
      sendJson(res, error.status, { error: error.message });
      return;
    }
    if (error instanceof FetchTimeoutError) {
      sendJson(res, 504, { error: "The AI provider timed out. Try again or switch providers." });
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
