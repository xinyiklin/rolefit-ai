import { callClaudeCli, callCodexCli, callGeminiCli } from "../ai-cli/index.mjs";
import { FetchTimeoutError, fetchWithTimeout, readBody, sendJson } from "../http.mjs";
import { chatCompletionsEndpoint } from "../network.mjs";

export function getDefaultProvider() {
  return normalizeProvider(process.env.AI_PROVIDER);
}

export function getDefaultModel() {
  return process.env.AI_MODEL ?? providerDefaultModel(getDefaultProvider());
}

function defaultCompatibleBaseUrl() {
  return process.env.AI_BASE_URL ?? process.env.OPENAI_COMPATIBLE_BASE_URL ?? "";
}

function extractOutputText(response) {
  if (typeof response.output_text === "string") return response.output_text;

  return (
    response.output
      ?.flatMap((item) => item.content ?? [])
      .filter((part) => part.type === "output_text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n") ?? ""
  );
}

function extractChatText(response) {
  const message = response.choices?.[0]?.message?.content;
  if (typeof message === "string") return message;
  if (Array.isArray(message)) {
    return message
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  if (typeof response.choices?.[0]?.text === "string") return response.choices[0].text;
  return "";
}

function extractAnthropicText(response) {
  return (
    response.content
      ?.map((part) => (part?.type === "text" && typeof part.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n") ?? ""
  );
}

function extractGeminiText(response) {
  return (
    response.candidates?.[0]?.content?.parts
      ?.map((part) => (typeof part?.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n") ?? ""
  );
}

export class UserSafeAiError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = "UserSafeAiError";
    this.status = status;
  }
}

// Provider/CLI configuration errors that carry their own actionable, already
// user-safe wording. Routes map these to a 400 (not a generic 500) so the user
// sees the precise remediation. Shared by /api/polish and /api/application-answers.
const SAFE_CONFIG_MESSAGES = new Set([
  "Add an OpenAI-compatible base URL.",
  "Enter a valid OpenAI-compatible base URL.",
  "AI base URL must start with http:// or https://.",
  "Use https:// for remote AI providers. http:// is only allowed for localhost.",
  "Private-network AI base URLs are blocked. Use localhost for local AI or a public https provider URL.",
  "Claude Code is not authenticated. Run `claude auth login` and try again.",
  "codex is not installed or not on PATH.",
  "claude is not installed or not on PATH.",
  "gemini is not installed or not on PATH.",
  "Gemini CLI could not complete the request. Run `gemini` once to sign in, confirm the selected model is available, then try again."
]);

// Returns the message verbatim when it is a known actionable config error, else
// null. Lets each route surface a 400 with the exact remediation text.
export function safeConfigErrorMessage(message) {
  return SAFE_CONFIG_MESSAGES.has(message) ? message : null;
}

function providerLabel(provider) {
  return (
    {
      openai: "OpenAI",
      anthropic: "Claude",
      gemini: "Gemini",
      openrouter: "OpenRouter",
      groq: "Groq",
      together: "Together AI",
      mistral: "Mistral",
      local: "Local AI",
      "openai-compatible": "OpenAI-compatible provider",
      "claude-cli": "Claude Code",
      "codex-cli": "Codex CLI",
      "gemini-cli": "Gemini CLI"
    }[provider] ?? "AI provider"
  );
}

function providerErrorDebug(data) {
  const error = data?.error ?? data;
  return {
    code: typeof error?.code === "string" ? error.code : undefined,
    type: typeof error?.type === "string" ? error.type : undefined
  };
}

function providerRequestFailed(provider, response, data) {
  console.warn("[ai] provider request failed", {
    provider,
    status: response.status,
    ...providerErrorDebug(data)
  });
  throw new UserSafeAiError(
    `${providerLabel(provider)} request failed. Check the selected model, API key, and account access, then try again.`,
    502
  );
}

function clampFitScore(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

// Validate the AI's base/tailored fit numbers. Returns null when neither score
// is usable so the client falls back to the local engine.
function sanitizeAiScore(raw) {
  if (!raw || typeof raw !== "object") return null;
  const base = clampFitScore(raw.base);
  const tailored = clampFitScore(raw.tailored);
  if (base === null && tailored === null) return null;
  return {
    base: base ?? tailored,
    tailored: tailored ?? base,
    liftReason: typeof raw.liftReason === "string" ? raw.liftReason.slice(0, 300) : ""
  };
}

const EVIDENCE_TYPES = new Set(["exact", "adjacent", "none"]);

function sanitizeMissingRequiredSkills(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const keyword = String(item.keyword ?? item.skill ?? "").trim().slice(0, 120);
      if (!keyword) return null;
      const evidenceType = EVIDENCE_TYPES.has(String(item.evidenceType)) ? String(item.evidenceType) : "none";
      return {
        keyword,
        evidenceType,
        canHonestlyAdd: evidenceType === "exact" ? Boolean(item.canHonestlyAdd) : false,
        reason: String(item.reason ?? item.evidence ?? "").trim().slice(0, 300)
      };
    })
    .filter(Boolean)
    .slice(0, 8);
}

function missingRequiredSkillsFromStrictReview(strictReview) {
  if (!strictReview || !Array.isArray(strictReview.gaps)) return [];
  return sanitizeMissingRequiredSkills(
    strictReview.gaps.map((gap) => ({
      keyword: gap.gap,
      evidenceType: gap.evidenceType,
      canHonestlyAdd: gap.canHonestlyAdd,
      reason: gap.evidence || gap.suggestedEdit
    }))
  );
}

// The numeric band each strict-review verdict must fall in. Mirrors the rule in
// the strict-review prompt.
const VERDICT_SCORE_BANDS = {
  "DON'T APPLY": [0, 45],
  STRETCH: [46, 69],
  "REASONABLE FIT": [70, 84],
  "STRONG FIT": [85, 100]
};

// Enforce verdict/score agreement server-side rather than trusting the prompt:
// if the model returns e.g. "DON'T APPLY" with a tailored 82, clamp the tailored
// score into the verdict's band so the UI can't show a contradictory pair. The
// verdict is the categorical judgment, so the number defers to it.
function reconcileScoreToVerdict(aiScore, verdict) {
  if (!aiScore || typeof verdict !== "string") return aiScore;
  const band = VERDICT_SCORE_BANDS[verdict.trim().toUpperCase()];
  if (!band) return aiScore;
  const [lo, hi] = band;
  const tailored = Math.max(lo, Math.min(hi, aiScore.tailored));
  if (tailored !== aiScore.tailored) {
    console.warn("[ai] reconciled tailored fit score to verdict band", {
      verdict,
      from: aiScore.tailored,
      to: tailored
    });
  }
  return { ...aiScore, tailored };
}

function parseAiJson(text) {
  const trimmed = text.trim();
  if (!trimmed) throw new UserSafeAiError("AI returned an empty response. Try again or switch models.", 502);
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  try {
    return JSON.parse(fenced ?? trimmed);
  } catch {
    throw new UserSafeAiError("AI returned a response the app could not read. Try again or switch models.", 502);
  }
}

export function normalizeProvider(provider) {
  const normalized = String(provider ?? "").trim().toLowerCase();
  return [
    "anthropic",
    "gemini",
    "openrouter",
    "groq",
    "together",
    "mistral",
    "openai-compatible",
    "local",
    "claude-cli",
    "codex-cli",
    "gemini-cli"
  ].includes(normalized)
    ? normalized
    : "openai";
}

function isCliProvider(provider) {
  return provider === "claude-cli" || provider === "codex-cli" || provider === "gemini-cli";
}

function normalizeCliReasoningEffort(provider, effort) {
  const normalized = String(effort ?? "").trim().toLowerCase();
  if (!normalized) return "";

  const allowed = {
    "claude-cli": ["low", "medium", "high", "xhigh", "max"],
    "codex-cli": ["low", "medium", "high", "xhigh"]
  }[provider];

  return allowed?.includes(normalized) ? normalized : null;
}

function providerDefaultModel(provider) {
  return (
    {
      openai: process.env.OPENAI_MODEL ?? "gpt-5.5",
      anthropic: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
      gemini: process.env.GEMINI_MODEL ?? "gemini-3.5-flash",
      openrouter: process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4.6",
      groq: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
      together: process.env.TOGETHER_MODEL ?? "openai/gpt-oss-20b",
      mistral: process.env.MISTRAL_MODEL ?? "mistral-large-latest",
      "openai-compatible": process.env.AI_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-5.5",
      local: process.env.LOCAL_AI_MODEL ?? "llama3.2",
      "claude-cli": process.env.CLAUDE_CLI_MODEL ?? "",
      "codex-cli": process.env.CODEX_CLI_MODEL ?? "",
      "gemini-cli": process.env.GEMINI_CLI_MODEL ?? ""
    }[provider] ?? process.env.OPENAI_MODEL ?? "gpt-5.5"
  );
}

function providerApiKey(provider, requestApiKey) {
  if (requestApiKey) return requestApiKey;
  return (
    {
      openai: process.env.OPENAI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      gemini: process.env.GEMINI_API_KEY,
      openrouter: process.env.OPENROUTER_API_KEY,
      groq: process.env.GROQ_API_KEY,
      together: process.env.TOGETHER_API_KEY,
      mistral: process.env.MISTRAL_API_KEY,
      "openai-compatible": process.env.AI_API_KEY || process.env.OPENAI_API_KEY,
      local: process.env.AI_API_KEY
    }[provider] ||
    process.env.AI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    ""
  );
}

function providerBaseUrl(provider, requestBaseUrl) {
  return (
    String(requestBaseUrl ?? "").trim() ||
    {
      openrouter: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
      groq: process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
      together: process.env.TOGETHER_BASE_URL || "https://api.together.xyz/v1",
      mistral: process.env.MISTRAL_BASE_URL || "https://api.mistral.ai/v1",
      local: process.env.LOCAL_AI_BASE_URL || "http://localhost:11434/v1",
      "openai-compatible": defaultCompatibleBaseUrl()
    }[provider] ||
    defaultCompatibleBaseUrl()
  );
}

function aiInstructions() {
  return `You are an expert resume editor for US job applications. Rewrite resumes for ATS clarity and human readability. Return one complete resume only. Include the candidate name and contact details exactly once at the top. Do not create duplicate skills sections; if the resume already has TECHNICAL SKILLS, improve that section instead of adding CORE SKILLS or another skills section.

${honestTailoringRules()}

${accomplishmentStyleRules()}

Do not invent employers, titles, dates, degrees, certifications, metrics, tools, or outcomes. If a metric would strengthen a bullet but is not provided, add a bracketed prompt such as [add metric: volume, percentage, dollars, time saved, or adoption]. Keep each role to no more than five bullets. If asked for a cover letter, write a concise truthful letter grounded only in the provided resume and job text, using bracketed placeholders for missing company, role, manager, or metric facts. Use strong action verbs and concise bullets. Return strict JSON only.`;
}

// Shared, explicit anti-fabrication contract: tailor by truthful re-emphasis,
// never by importing capabilities the candidate hasn't demonstrated. The
// concrete example pins down the most common failure (padding skills with
// job-description keywords the candidate has never used).
export function honestTailoringRules() {
  return `Hard constraints:
1. Honesty overrides matching. Tailor only by rephrasing, reordering, and emphasizing experience the candidate actually has.
2. Evidence sources are the resume plus optional honest context supplied by the user. If optional honest context is blank, rely only on the resume.
3. Classify evidence before adding any JD skill/tool:
   - exact: the resume or honest context directly shows the same skill/tool/responsibility.
   - adjacent: the candidate shows clearly related experience, but not the exact JD term.
   - none: no support in the resume or honest context.
4. Add a skill, tool, technology, framework, language, platform, certification, domain, or responsibility to the resume or skills section only when evidenceType is exact. Adjacent evidence may be described truthfully, but must not be overstated into the exact missing JD skill.
5. Example: if the job asks for Kubernetes and nothing in the resume or optional honest context shows Kubernetes or clearly equivalent container-orchestration experience, do not list it, imply it, or work it into a bullet. Leave it as a missing requirement.
6. Do not pad the skills section with JD keywords the candidate has not actually used. Prefer leaving a requirement uncovered over fabricating coverage.`;
}

// Resumes must read as engineering accomplishments, not as a tour of what a
// product does. Without this rule, models tailoring a project-heavy resume
// drift into "feature brochure" copy — listing app capabilities instead of the
// candidate's engineering work. The concrete example pins down that failure.
export function accomplishmentStyleRules() {
  return `Write every bullet as an engineering accomplishment, not a product description:
- Lead with what the candidate built, changed, or decided; then how (architecture, technique, or scale); then the result.
- Never reduce a project to a tour of what the app does (e.g. "app with scheduling, billing, charting, and refills"). State the engineering behind those features instead.
- Keep tech and tool mentions minimal: cite only the few technologies the work centered on; do not append long stacks or restate the skills section inside project bullets.`;
}

function aiStrictReviewInstructions() {
  return `You are a senior technical recruiter and hiring manager with 10+ years of experience screening software engineering candidates. You are NOT a cheerleader — give a blunt, honest assessment. NEVER suggest fabricating experience. If a gap cannot be honestly filled with evidence the user has provided, mark it as cannot-add and recommend skipping. Don't pad with generic advice. Don't praise the resume. If the resume is genuinely a bad fit, say DON'T APPLY with a reason. DEAL-PRIORITIZE soft skills (communication, teamwork, ownership) — only note them as required if the JD explicitly demands them. Compare on these dimensions in order: 1) required technical skills, 2) required experience domains, 3) required years/seniority, 4) preferred/nice-to-have.

Also polish the resume to align with the JD. ${honestTailoringRules()} A missing required skill belongs in "gaps" with canHonestlyAdd=false — never silently inserted into the polished resume or its skills section to make the score look better.

${accomplishmentStyleRules()}

Keep each role to no more than five bullets. Use bracketed prompts like [add metric: volume, percentage, dollars, time saved] for unverifiable claims. Return strict JSON only.`;
}

function strictReviewPrompt({ includeCoverLetter, jobText, preserveFormat, sourceFormat, resumeText, roleAppliedAs, honestContext, customInstructions }) {
  return `Return this JSON shape exactly:
{
  "polishedText": "full polished resume text",
  "coverLetterText": ${includeCoverLetter ? "\"copy-ready cover letter, <350 words\"" : "\"\""},
  "strengths": ["2-4 concise strengths"],
  "fixes": ["2-4 concise next fixes"],
  "fitScore": { "base": 0-100 integer, "tailored": 0-100 integer, "liftReason": "one sentence on what the tailoring added" },
  "strictReview": {
    "verdict": "STRONG FIT" | "REASONABLE FIT" | "STRETCH" | "DON'T APPLY",
    "verdictReason": "one-sentence reason",
    "coverage": [
      { "category": "Required tech" | "Required experience" | "Required years" | "Preferred", "keyword": "...", "status": "covered" | "missing" | "adjacent", "where": "where in the resume, or 'Not in resume'" }
    ],
    "gaps": [
      { "gap": "missing keyword", "severity": "BLOCKER" | "HIGH" | "MEDIUM" | "LOW", "evidenceType": "exact" | "adjacent" | "none", "canHonestlyAdd": true|false, "evidence": "resume or optional honest-context evidence, or 'No evidence'", "suggestedEdit": "exact bullet rewrite if can add, or 'leave as gap — do not add' if cannot" }
    ],
    "rewrites": [
      { "original": "current bullet text", "rewrite": "rewritten bullet using only true facts", "hits": ["keyword(s) it now hits"] }
    ],
    "riskFlags": [
      { "bullet": "current bullet at risk", "risk": "what could be probed and not defended", "suggestion": "soften, cut, or rephrase as ..." }
    ],
    "recommendation": {
      "applyAsIs": true|false,
      "reason": "one-sentence reason",
      "topEdits": ["edit 1 by impact", "edit 2", "edit 3"],
      "coverLetterAngle": "one paragraph framing background for this role and company"
    }
  }
}

Strict rules:
- Coverage status must be one of these literal strings only: "covered", "missing", "adjacent". Do not include symbols in JSON status values.
- Coverage entries: 4-12 most important JD keywords across the four categories.
- Gaps: only for missing keywords from required categories (skip preferred-only gaps unless severity is HIGH+).
- Gap evidenceType must be "exact", "adjacent", or "none". canHonestlyAdd means the exact missing skill can be added to the resume; it may be true only with exact evidence from the resume or optional honest context. evidenceType "adjacent" or "none" must use canHonestlyAdd=false.
- Rewrites: 2-4 of the weakest CURRENT bullets for this JD, using only facts present in the resume or honest context.
- Risk flags: 1-3 bullets that interviewers could probe in a way the candidate couldn't defend confidently.
- topEdits: ordered by impact, max 3.
- If the resume is genuinely wrong for the role, set verdict to "DON'T APPLY" and applyAsIs to false.
- fitScore.tailored MUST be consistent with the verdict: "DON'T APPLY" <= 45, "STRETCH" 46-69, "REASONABLE FIT" 70-84, "STRONG FIT" >= 85.

${fitScoringPrompt()}

Role applying as:
${roleAppliedAs || "Early Career / SWE I"}

Honest context (things true but not on the resume — use only as evidence for canHonestlyAdd):
${honestContext || "None provided. Treat any gap not supported by the resume as canHonestlyAdd=false."}

Generate cover letter:
${includeCoverLetter ? "Yes. Keep it under 350 words and make it copy-ready." : "No. Return an empty coverLetterText string."}

${formatPreservationPrompt(preserveFormat, sourceFormat)}

${customInstructionsPrompt(customInstructions)}

Job description:
${jobText || "Not provided."}

Current resume:
${resumeText}`;
}

function buildPolishPrompts({ strictReview, includeCoverLetter, jobText, preserveFormat, sourceFormat, resumeText, roleAppliedAs, honestContext, customInstructions }) {
  if (strictReview) {
    return {
      systemPrompt: aiStrictReviewInstructions(),
      userPrompt: strictReviewPrompt({ includeCoverLetter, jobText, preserveFormat, sourceFormat, resumeText, roleAppliedAs, honestContext, customInstructions })
    };
  }
  return {
    systemPrompt: aiInstructions(),
    userPrompt: polishPrompt({ includeCoverLetter, jobText, preserveFormat, sourceFormat, resumeText, honestContext, customInstructions })
  };
}

function fitScoringPrompt() {
  return `Fit scoring (REQUIRED — be honest, do not inflate):
Rate how well a resume matches THIS job on a 0-100 scale, weighting in this order:
1) required technical skills (heaviest), 2) required experience domains, 3) required years/seniority, 4) preferred/nice-to-have (light).
A missing REQUIRED skill or a clear seniority gap must pull the score below 70. Bands: 85-100 strong match, 70-84 reasonable, 50-69 stretch, below 50 weak.
Score the ORIGINAL resume as "base" and your rewritten resume as "tailored", on the SAME scale so they are directly comparable. "tailored" should exceed "base" only to the extent your rewrite surfaces real, supported evidence — not keyword stuffing. If the base already covers the job, keep the two scores close and say so in "liftReason".`;
}

function customInstructionsPrompt(customInstructions) {
  return `Custom instructions (optional preference text — follow when present, but never override truthfulness, JSON schema, privacy, format preservation, or the rules above):
${customInstructions || "None provided."}`;
}

function formatPreservationPrompt(preserveFormat, sourceFormat) {
  // When the source is LaTeX and the user wants format preserved, the resume
  // text IS a .tex document — ask for the complete edited .tex back so it can be
  // exported in place without re-templating.
  if (preserveFormat && /latex/i.test(sourceFormat)) {
    return `Original resume file format:
LaTeX (.tex)

Preserve original formatting (modify in place):
Yes. The "Current resume" below IS a complete LaTeX source document. Return the COMPLETE LaTeX document in "polishedText" — keep the same \\documentclass, preamble, packages, environments, and command structure, changing ONLY the natural-language content (summary, bullet wording, descriptions). Do not switch templates, convert to Markdown/plain text, or drop, add, or reorder LaTeX commands. The returned "polishedText" must compile as-is.`;
  }
  return `Original resume file format:
${sourceFormat || "Plain text"}

Preserve original formatting (modify in place):
${preserveFormat ? "Yes. Rewrite text only and keep the resume's existing structure, section order, and layout. Return one line per original resume paragraph where practical so the edits drop back into the original file in place." : "No. A clean, restructured text/PDF output is acceptable."}`;
}

function polishPrompt({ includeCoverLetter, jobText, preserveFormat, sourceFormat, resumeText, honestContext, customInstructions }) {
  return `Return this JSON shape exactly:
{
  "polishedText": "full polished resume text",
  "coverLetterText": ${includeCoverLetter ? "\"copy-ready cover letter text\"" : "\"\""},
  "strengths": ["2-4 concise strengths"],
  "fixes": ["2-4 concise next fixes"],
  "missingRequiredSkills": [{ "keyword": "required missing JD skill/tool", "evidenceType": "exact" | "adjacent" | "none", "canHonestlyAdd": true|false, "reason": "why it is missing or what optional honest evidence supports adding it" }],
  "fitScore": { "base": 0-100 integer, "tailored": 0-100 integer, "liftReason": "one sentence on what the tailoring added" }
}

For missingRequiredSkills, include only required JD skills/tools/experience that remain missing after the rewrite. Use [] when there are no important required gaps. If evidenceType is "none", canHonestlyAdd must be false and the skill must not appear in polishedText.

${fitScoringPrompt()}

Generate cover letter:
${includeCoverLetter ? "Yes. Keep it under 350 words and make it copy-ready." : "No. Return an empty coverLetterText string."}

${formatPreservationPrompt(preserveFormat, sourceFormat)}

Honest context (optional user-provided evidence not already in the resume — use only as evidence, never as permission to fabricate):
${honestContext || "None provided. Treat any gap not supported by the resume as evidenceType=none and canHonestlyAdd=false."}

${customInstructionsPrompt(customInstructions)}

Job description:
${jobText || "Not provided."}

Current resume:
${resumeText}`;
}

async function callOpenAiResponses({ apiKey, model, systemPrompt, userPrompt }) {
  const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      instructions: systemPrompt,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: userPrompt }
          ]
        }
      ],
      text: { format: { type: "json_object" } }
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    providerRequestFailed("openai", response, data);
  }

  return parseAiJson(extractOutputText(data));
}

async function callOpenAiCompatibleChat({ provider, apiKey, apiBaseUrl, model, systemPrompt, userPrompt }) {
  const endpoint = chatCompletionsEndpoint(apiBaseUrl);
  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.2
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    providerRequestFailed(provider, response, data);
  }

  return parseAiJson(extractChatText(data));
}

async function callAnthropicMessages({ apiKey, model, systemPrompt, userPrompt }) {
  const response = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }]
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    providerRequestFailed("anthropic", response, data);
  }

  return parseAiJson(extractAnthropicText(data));
}

async function callGeminiGenerateContent({ apiKey, model, systemPrompt, userPrompt }) {
  const safeModel = encodeURIComponent(model.replace(/^models\//, ""));
  const response = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${safeModel}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [
        { role: "user", parts: [{ text: userPrompt }] }
      ],
      generationConfig: { temperature: 0.2 }
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    providerRequestFailed("gemini", response, data);
  }

  return parseAiJson(extractGeminiText(data));
}

// Resolve provider, key, base URL, model, and reasoning effort from a request
// body, applying the same validation handlePolish used. Throws UserSafeAiError
// (handled by each route's catch) on a missing key, bad model, or unsupported
// CLI effort. Shared by /api/polish and /api/application-answers.
export function resolveProviderRequest(body) {
  const provider = normalizeProvider(body.provider || getDefaultProvider());
  const requestApiKey = String(body.apiKey ?? "").trim();
  const apiKey = providerApiKey(provider, requestApiKey);
  const apiBaseUrl = providerBaseUrl(provider, body.apiBaseUrl);
  const requestedModel = String(body.model ?? "").trim().slice(0, 80);
  const model = requestedModel || providerDefaultModel(provider);
  const reasoningEffort = normalizeCliReasoningEffort(provider, body.reasoningEffort);

  if (!apiKey && !isCliProvider(provider)) {
    throw new UserSafeAiError(
      `Add an API key in AI settings or set the ${provider.toUpperCase()} API key in .env before starting the app.`,
      401
    );
  }
  if (model && !/^[a-z0-9_.:/@+-]+$/i.test(model)) {
    throw new UserSafeAiError(
      "Model name can only use letters, numbers, dots, dashes, underscores, slashes, at signs, pluses, or colons.",
      400
    );
  }
  if (reasoningEffort === null) {
    throw new UserSafeAiError("Unsupported reasoning effort for the selected CLI provider.", 400);
  }

  return { provider, apiKey, apiBaseUrl, model, reasoningEffort };
}

// Dispatch a built {systemPrompt, userPrompt} pair to the configured provider
// (API or CLI) and return the parsed JSON. Single source of truth for provider
// routing, shared by /api/polish and /api/application-answers.
export async function callConfiguredProvider({ provider, model, reasoningEffort, apiKey, apiBaseUrl, systemPrompt, userPrompt }) {
  if (provider === "claude-cli") return parseAiJson(await callClaudeCli({ model, reasoningEffort, systemPrompt, userPrompt }));
  if (provider === "codex-cli") return parseAiJson(await callCodexCli({ model, reasoningEffort, systemPrompt, userPrompt }));
  if (provider === "gemini-cli") return parseAiJson(await callGeminiCli({ model, systemPrompt, userPrompt }));
  if (provider === "anthropic") return callAnthropicMessages({ apiKey, model, systemPrompt, userPrompt });
  if (provider === "gemini") return callGeminiGenerateContent({ apiKey, model, systemPrompt, userPrompt });
  if (provider === "openai") return callOpenAiResponses({ apiKey, model, systemPrompt, userPrompt });
  return callOpenAiCompatibleChat({ provider, apiKey, apiBaseUrl, model, systemPrompt, userPrompt });
}

export async function handlePolish(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }

  let provider = normalizeProvider(getDefaultProvider());
  try {
    const body = JSON.parse(await readBody(req));
    const resumeText = String(body.resumeText ?? "").slice(0, 45_000);
    const jobText = String(body.jobText ?? "").slice(0, 35_000);
    const includeCoverLetter = Boolean(body.includeCoverLetter);
    const preserveFormat = Boolean(body.preserveFormat);
    const sourceFormat = String(body.sourceFormat ?? "").slice(0, 60);
    const strictReview = Boolean(body.strictReview);
    const roleAppliedAs = String(body.roleAppliedAs ?? "").slice(0, 80);
    const honestContext = String(body.honestContext ?? "").slice(0, 8_000);
    const customInstructions = String(body.customInstructions ?? "").slice(0, 4_000);

    if (resumeText.trim().length < 80 || jobText.trim().length < 40) {
      sendJson(res, 400, { error: "Add a resume and job description before polishing." });
      return;
    }

    const resolved = resolveProviderRequest(body);
    provider = resolved.provider;
    const { apiKey, apiBaseUrl, model, reasoningEffort } = resolved;

    const { systemPrompt, userPrompt } = buildPolishPrompts({
      strictReview,
      includeCoverLetter,
      jobText,
      preserveFormat,
      sourceFormat,
      resumeText,
      roleAppliedAs,
      honestContext,
      customInstructions
    });

    const parsed = await callConfiguredProvider({ provider, model, reasoningEffort, apiKey, apiBaseUrl, systemPrompt, userPrompt });

    const missingRequiredSkills = sanitizeMissingRequiredSkills(parsed.missingRequiredSkills);
    const strictMissingRequiredSkills = missingRequiredSkillsFromStrictReview(parsed.strictReview);

    sendJson(res, 200, {
      polishedText: String(parsed.polishedText ?? "").trim(),
      coverLetterText: String(parsed.coverLetterText ?? "").trim(),
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths.map(String).slice(0, 4) : [],
      fixes: Array.isArray(parsed.fixes) ? parsed.fixes.map(String).slice(0, 4) : [],
      missingRequiredSkills: missingRequiredSkills.length ? missingRequiredSkills : strictMissingRequiredSkills,
      aiScore: reconcileScoreToVerdict(sanitizeAiScore(parsed.fitScore), parsed.strictReview?.verdict),
      strictReview: parsed.strictReview ?? null,
      model,
      reasoningEffort,
      provider
    });
  } catch (error) {
    if (error instanceof UserSafeAiError) {
      sendJson(res, error.status, { error: error.message });
      return;
    }
    if (error instanceof FetchTimeoutError) {
      sendJson(res, 504, { error: `${providerLabel(provider)} timed out. Try again or switch providers.` });
      return;
    }

    const configMessage = safeConfigErrorMessage(error instanceof Error ? error.message : "");
    if (configMessage) {
      sendJson(res, 400, { error: configMessage });
      return;
    }

    console.warn("[ai] polish failed", {
      provider,
      errorName: error instanceof Error ? error.name : typeof error
    });
    sendJson(res, 500, {
      error: `${providerLabel(provider)} did not return a usable draft. Check the selected provider and model, then try again.`
    });
  }
}
