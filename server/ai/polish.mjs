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

class UserSafeAiError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = "UserSafeAiError";
    this.status = status;
  }
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
  return "You are an expert resume editor for US job applications. Rewrite resumes for ATS clarity and human readability. Return one complete resume only. Include the candidate name and contact details exactly once at the top. Do not create duplicate skills sections; if the resume already has TECHNICAL SKILLS, improve that section instead of adding CORE SKILLS or another skills section. Do not invent employers, titles, dates, degrees, certifications, metrics, tools, or outcomes. If a metric would strengthen a bullet but is not provided, add a bracketed prompt such as [add metric: volume, percentage, dollars, time saved, or adoption]. Keep each role to no more than five bullets. If asked for a cover letter, write a concise truthful letter grounded only in the provided resume and job text, using bracketed placeholders for missing company, role, manager, or metric facts. Use strong action verbs, concise bullets, and role-relevant keywords only when supported by the resume. Return strict JSON only.";
}

function aiStrictReviewInstructions() {
  return "You are a senior technical recruiter and hiring manager with 10+ years of experience screening software engineering candidates. You are NOT a cheerleader — give a blunt, honest assessment. NEVER suggest fabricating experience. If a gap cannot be honestly filled with evidence the user has provided, mark it as cannot-add and recommend skipping. Don't pad with generic advice. Don't praise the resume. If the resume is genuinely a bad fit, say DON'T APPLY with a reason. DEAL-PRIORITIZE soft skills (communication, teamwork, ownership) — only note them as required if the JD explicitly demands them. Compare on these dimensions in order: 1) required technical skills, 2) required experience domains, 3) required years/seniority, 4) preferred/nice-to-have. Also polish the resume to align with the JD using only facts present in the resume or the honest context. Keep each role to no more than five bullets. Use bracketed prompts like [add metric: volume, percentage, dollars, time saved] for unverifiable claims. Return strict JSON only.";
}

function strictReviewPrompt({ includeCoverLetter, jobUrl, jobText, preserveFormat, sourceFormat, resumeText, roleAppliedAs, honestContext, customInstructions }) {
  return `Return this JSON shape exactly:
{
  "polishedText": "full polished resume text",
  "coverLetterText": ${includeCoverLetter ? "\"copy-ready cover letter, <350 words\"" : "\"\""},
  "strengths": ["2-4 concise strengths"],
  "fixes": ["2-4 concise next fixes"],
  "strictReview": {
    "verdict": "STRONG FIT" | "REASONABLE FIT" | "STRETCH" | "DON'T APPLY",
    "verdictReason": "one-sentence reason",
    "coverage": [
      { "category": "Required tech" | "Required experience" | "Required years" | "Preferred", "keyword": "...", "status": "covered" | "missing" | "adjacent", "where": "where in the resume, or 'Not in resume'" }
    ],
    "gaps": [
      { "gap": "missing keyword", "severity": "BLOCKER" | "HIGH" | "MEDIUM" | "LOW", "canHonestlyAdd": true|false, "evidence": "what evidence from honest context supports adding it, or 'No evidence'", "suggestedEdit": "exact bullet rewrite if can add, or 'skip — apply anyway' if cannot" }
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
- Use ✓ "covered", ✗ "missing", ⚠ "adjacent" (use the literal status strings exactly).
- Coverage entries: 4-12 most important JD keywords across the four categories.
- Gaps: only for ✗ missing keywords from required categories (skip preferred-only gaps unless severity is HIGH+).
- Rewrites: 2-4 of the weakest CURRENT bullets for this JD, using only facts present in the resume or honest context.
- Risk flags: 1-3 bullets that interviewers could probe in a way the candidate couldn't defend confidently.
- topEdits: ordered by impact, max 3.
- If the resume is genuinely wrong for the role, set verdict to "DON'T APPLY" and applyAsIs to false.

Role applying as:
${roleAppliedAs || "Early Career / SWE I"}

Honest context (things true but not on the resume — use only as evidence for canHonestlyAdd):
${honestContext || "None provided. Treat any gap not supported by the resume as canHonestlyAdd=false."}

Generate cover letter:
${includeCoverLetter ? "Yes. Keep it under 350 words and make it copy-ready." : "No. Return an empty coverLetterText string."}

${formatPreservationPrompt(preserveFormat, sourceFormat)}

${customInstructionsPrompt(customInstructions)}

Job URL:
${jobUrl || "Not provided"}

Job description:
${jobText || "Use the job URL text only if it contains useful role clues."}

Current resume:
${resumeText}`;
}

function buildPolishPrompts({ strictReview, includeCoverLetter, jobUrl, jobText, preserveFormat, sourceFormat, resumeText, roleAppliedAs, honestContext, customInstructions }) {
  if (strictReview) {
    return {
      systemPrompt: aiStrictReviewInstructions(),
      userPrompt: strictReviewPrompt({ includeCoverLetter, jobUrl, jobText, preserveFormat, sourceFormat, resumeText, roleAppliedAs, honestContext, customInstructions })
    };
  }
  return {
    systemPrompt: aiInstructions(),
    userPrompt: polishPrompt({ includeCoverLetter, jobUrl, jobText, preserveFormat, sourceFormat, resumeText, customInstructions })
  };
}

function customInstructionsPrompt(customInstructions) {
  return `Custom instructions (optional — follow when present, but never fabricate facts or override the rules above):
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

function polishPrompt({ includeCoverLetter, jobUrl, jobText, preserveFormat, sourceFormat, resumeText, customInstructions }) {
  return `Return this JSON shape exactly:
{
  "polishedText": "full polished resume text",
  "coverLetterText": ${includeCoverLetter ? "\"copy-ready cover letter text\"" : "\"\""},
  "strengths": ["2-4 concise strengths"],
  "fixes": ["2-4 concise next fixes"]
}

Generate cover letter:
${includeCoverLetter ? "Yes. Keep it under 350 words and make it copy-ready." : "No. Return an empty coverLetterText string."}

${formatPreservationPrompt(preserveFormat, sourceFormat)}

${customInstructionsPrompt(customInstructions)}

Job URL:
${jobUrl || "Not provided"}

Job description:
${jobText || "Use the job URL text only if it contains useful role clues."}

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
    const jobUrl = String(body.jobUrl ?? "").slice(0, 2_000);
    provider = normalizeProvider(body.provider || getDefaultProvider());
    const requestApiKey = String(body.apiKey ?? "").trim();
    const apiKey = providerApiKey(provider, requestApiKey);
    const apiBaseUrl = providerBaseUrl(provider, body.apiBaseUrl);
    const requestedModel = String(body.model ?? "").trim().slice(0, 80);
    const model = requestedModel || providerDefaultModel(provider);
    const reasoningEffort = normalizeCliReasoningEffort(provider, body.reasoningEffort);
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

    if (!apiKey && !isCliProvider(provider)) {
      sendJson(res, 401, {
        error: `Add an API key in AI settings or set the ${provider.toUpperCase()} API key in .env before starting the app.`
      });
      return;
    }

    if (model && !/^[a-z0-9_.:/@+-]+$/i.test(model)) {
      sendJson(res, 400, {
        error: "Model name can only use letters, numbers, dots, dashes, underscores, slashes, at signs, pluses, or colons."
      });
      return;
    }

    if (reasoningEffort === null) {
      sendJson(res, 400, { error: "Unsupported reasoning effort for the selected CLI provider." });
      return;
    }

    const { systemPrompt, userPrompt } = buildPolishPrompts({
      strictReview,
      includeCoverLetter,
      jobUrl,
      jobText,
      preserveFormat,
      sourceFormat,
      resumeText,
      roleAppliedAs,
      honestContext,
      customInstructions
    });

    let parsed;
    if (provider === "claude-cli") {
      const raw = await callClaudeCli({ model, reasoningEffort, systemPrompt, userPrompt });
      parsed = parseAiJson(raw);
    } else if (provider === "codex-cli") {
      const raw = await callCodexCli({ model, reasoningEffort, systemPrompt, userPrompt });
      parsed = parseAiJson(raw);
    } else if (provider === "gemini-cli") {
      const raw = await callGeminiCli({ model, systemPrompt, userPrompt });
      parsed = parseAiJson(raw);
    } else if (provider === "anthropic") {
      parsed = await callAnthropicMessages({ apiKey, model, systemPrompt, userPrompt });
    } else if (provider === "gemini") {
      parsed = await callGeminiGenerateContent({ apiKey, model, systemPrompt, userPrompt });
    } else if (provider === "openai") {
      parsed = await callOpenAiResponses({ apiKey, model, systemPrompt, userPrompt });
    } else {
      parsed = await callOpenAiCompatibleChat({ provider, apiKey, apiBaseUrl, model, systemPrompt, userPrompt });
    }

    sendJson(res, 200, {
      polishedText: String(parsed.polishedText ?? "").trim(),
      coverLetterText: String(parsed.coverLetterText ?? "").trim(),
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths.map(String).slice(0, 4) : [],
      fixes: Array.isArray(parsed.fixes) ? parsed.fixes.map(String).slice(0, 4) : [],
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

    const message = error instanceof Error ? error.message : "";
    const safeConfigMessages = new Set([
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
    if (safeConfigMessages.has(message)) {
      sendJson(res, 400, { error: message });
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
