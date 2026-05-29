import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { lookup as dnsLookup } from "node:dns/promises";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { createServer as createViteServer } from "vite";
import {
  listTemplates,
  renderResumeTex,
  extractPlainTextFromLatex,
  checkTectonicAvailability,
  compileTexToPdf,
  defaultTemplateId
} from "./server/latex/index.mjs";
import {
  callClaudeCli,
  callCodexCli
} from "./server/ai-cli/index.mjs";
import {
  readApplications,
  writeApplications,
  applicationsFilePath
} from "./server/applications/index.mjs";

const root = process.cwd();
const isProduction = process.env.NODE_ENV === "production";
const maxRequestBytes = 8_000_000;
const execFileAsync = promisify(execFile);
const jobWorkspaceDir = join(root, "job-search-workspace");
const baseResumeCandidates = ["base-resume.docx", "base-resume.txt", "base-resume.md", "base-resume.csv"];

async function loadLocalEnv() {
  try {
    const env = await readFile(join(root, ".env"), "utf8");
    for (const line of env.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key]) continue;
      process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
    }
  } catch {
    // Local .env is optional.
  }
}

await loadLocalEnv();
await ensureJobWorkspace();

const defaultProvider = normalizeProvider(process.env.AI_PROVIDER);
const defaultModel = process.env.AI_MODEL ?? providerDefaultModel(defaultProvider);
const defaultCompatibleBaseUrl = process.env.AI_BASE_URL ?? process.env.OPENAI_COMPATIBLE_BASE_URL ?? "";
const port = Number(process.env.PORT ?? 5174);

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function base64ToBuffer(value) {
  const base64 = String(value ?? "").replace(/^data:[^,]+,/, "");
  if (!base64 || !/^[a-z0-9+/=\s]+$/i.test(base64)) {
    throw new Error("DOCX data was not valid base64.");
  }
  return Buffer.from(base64, "base64");
}

function bufferToBase64(buffer) {
  return Buffer.from(buffer).toString("base64");
}

async function ensureJobWorkspace() {
  await mkdir(jobWorkspaceDir, { recursive: true });
}

function decodeXmlText(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapeXmlText(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripListMarker(line) {
  return line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "");
}

function paragraphText(paragraphXml) {
  return Array.from(paragraphXml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g))
    .map((match) => decodeXmlText(match[1]))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function extractDocumentText(documentXml) {
  const lines = Array.from(documentXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g))
    .map((match) => {
      const text = paragraphText(match[0]);
      if (!text) return "";
      const isListItem = /<w:numPr\b[\s\S]*?<\/w:numPr>/.test(match[0]);
      return isListItem ? `- ${text}` : text;
    })
    .filter(Boolean);

  return lines.join("\n");
}

function replaceParagraphText(paragraphXml, replacementText) {
  let wroteText = false;
  const escapedText = escapeXmlText(replacementText);
  return paragraphXml.replace(/<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/g, (match, attributes) => {
    if (wroteText) return `<w:t${attributes}></w:t>`;
    wroteText = true;
    const hasSpacePreserve = /\bxml:space=/.test(attributes);
    const needsSpacePreserve = /^\s|\s$/.test(replacementText);
    const nextAttributes = needsSpacePreserve && !hasSpacePreserve ? `${attributes} xml:space="preserve"` : attributes;
    return `<w:t${nextAttributes}>${escapedText}</w:t>`;
  });
}

function applyTextToDocumentXml(documentXml, polishedText) {
  const replacementLines = String(polishedText ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!replacementLines.length) throw new Error("Polished resume text is empty.");

  let textParagraphIndex = 0;
  let lastTextParagraph = "";
  const nextXml = documentXml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraphXml) => {
    if (!paragraphText(paragraphXml)) return paragraphXml;

    const isListItem = /<w:numPr\b[\s\S]*?<\/w:numPr>/.test(paragraphXml);
    const rawReplacement = replacementLines[textParagraphIndex] ?? "";
    const replacement = isListItem ? stripListMarker(rawReplacement) : rawReplacement;
    textParagraphIndex += 1;
    lastTextParagraph = paragraphXml;
    return replaceParagraphText(paragraphXml, replacement);
  });

  if (textParagraphIndex >= replacementLines.length || !lastTextParagraph) {
    return {
      documentXml: nextXml,
      replacedParagraphs: textParagraphIndex,
      appendedParagraphs: 0
    };
  }

  const appended = replacementLines
    .slice(textParagraphIndex)
    .map((line) => replaceParagraphText(lastTextParagraph, stripListMarker(line)))
    .join("");
  const documentXmlWithAppend = /<w:sectPr\b/.test(nextXml)
    ? nextXml.replace(/(<w:sectPr\b[\s\S]*?<\/w:sectPr>|<w:sectPr\b[^>]*\/>)(\s*<\/w:body>)/, `${appended}$1$2`)
    : nextXml.replace(/<\/w:body>/, `${appended}</w:body>`);

  return {
    documentXml: documentXmlWithAppend,
    replacedParagraphs: textParagraphIndex,
    appendedParagraphs: replacementLines.length - textParagraphIndex
  };
}

// Rejects archive entry names that are absolute or contain a `..` traversal
// segment, so a malicious .docx can't escape the unpack directory (zip-slip).
function assertSafeZipEntries(listing) {
  const entries = listing.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const entry of entries) {
    const normalized = entry.replace(/\\/g, "/");
    if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
      throw new Error("Archive contains an absolute path entry.");
    }
    if (normalized.split("/").some((segment) => segment === "..")) {
      throw new Error("Archive contains a path traversal entry.");
    }
  }
}

async function withUnpackedDocx(docxBase64, callback) {
  const workspace = await mkdtemp(join(tmpdir(), "resume-polisher-docx-"));
  const sourcePath = join(workspace, "source.docx");
  const unpackedPath = join(workspace, "docx");

  try {
    await writeFile(sourcePath, base64ToBuffer(docxBase64));
    const { stdout: listing } = await execFileAsync("unzip", ["-Z1", sourcePath]);
    assertSafeZipEntries(listing);
    await execFileAsync("unzip", ["-qq", sourcePath, "-d", unpackedPath]);
    return await callback({ workspace, unpackedPath });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function extractDocxResume(docxBase64) {
  return withUnpackedDocx(docxBase64, async ({ unpackedPath }) => {
    const documentXml = await readFile(join(unpackedPath, "word", "document.xml"), "utf8");
    const text = extractDocumentText(documentXml);
    if (text.trim().length < 80) {
      throw new Error("DOCX did not expose enough readable resume text.");
    }
    return {
      text: text.slice(0, 45_000),
      paragraphs: text.split(/\r?\n/).filter(Boolean).length
    };
  });
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxRequestBytes) {
        reject(new Error("Request is too large."));
        req.destroy();
      }
    });

    req.on("end", () => resolveBody(body));
    req.on("error", reject);
  });
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

function parseAiJson(text) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("AI response was empty.");
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  return JSON.parse(fenced ?? trimmed);
}

function normalizeProvider(provider) {
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
    "codex-cli"
  ].includes(normalized)
    ? normalized
    : "openai";
}

function isCliProvider(provider) {
  return provider === "claude-cli" || provider === "codex-cli";
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
      "codex-cli": process.env.CODEX_CLI_MODEL ?? ""
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
      "openai-compatible": defaultCompatibleBaseUrl
    }[provider] ||
    defaultCompatibleBaseUrl
  );
}

function isLocalHost(hostname) {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

// Returns true for any IPv4 literal in a loopback/private/link-local/CGNAT/unspecified range.
function isPrivateIPv4(ip) {
  const octets = ip.split(".");
  if (octets.length !== 4) return false;
  const parts = octets.map((part) => Number(part));
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local 169.254.0.0/16 (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  return false;
}

// Returns true for IPv6 loopback, ULA (fc00::/7), link-local (fe80::/10),
// unspecified, or IPv4-mapped addresses that map to a private IPv4.
function isPrivateIPv6(ip) {
  const host = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "::1" || host === "::") return true;
  const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  const head = host.split(":")[0];
  if (!head) return false;
  const block = Number.parseInt(head, 16);
  if (Number.isNaN(block)) return false;
  if ((block & 0xfe00) === 0xfc00) return true; // fc00::/7 (ULA)
  if ((block & 0xffc0) === 0xfe80) return true; // fe80::/10 (link-local)
  return false;
}

function isPrivateIpLiteral(value) {
  const host = String(value).replace(/^\[|\]$/g, "");
  if (host.includes(":")) return isPrivateIPv6(host);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return isPrivateIPv4(host);
  return false;
}

function isPrivateHost(hostname) {
  const host = hostname.toLowerCase();
  return (
    isLocalHost(host) ||
    host.endsWith(".local") ||
    isPrivateIpLiteral(host)
  );
}

// Resolves a hostname and rejects if it is a private literal or any resolved
// address is private/link-local/loopback. Throws a tagged error otherwise.
async function assertPublicHost(hostname) {
  const host = String(hostname).toLowerCase();
  if (isPrivateHost(host)) {
    throw new BlockedHostError("Private or local hosts are not allowed.");
  }
  let resolved;
  try {
    resolved = await dnsLookup(host.replace(/^\[|\]$/g, ""), { all: true });
  } catch {
    throw new DnsError("Could not resolve the host for that URL.");
  }
  if (!resolved.length) {
    throw new DnsError("Could not resolve the host for that URL.");
  }
  for (const { address } of resolved) {
    if (isPrivateIpLiteral(address)) {
      throw new BlockedHostError("That URL resolves to a private or local address.");
    }
  }
}

function isPublicHttpUrl(url) {
  if (!["http:", "https:"].includes(url.protocol)) return false;

  return !isPrivateHost(url.hostname);
}

class BlockedHostError extends Error {}
class DnsError extends Error {}
class FetchTimeoutError extends Error {}

// Shared fetch wrapper that aborts after `timeoutMs` so a hung peer never
// holds a request open forever. Surfaces a tagged FetchTimeoutError on abort.
async function fetchWithTimeout(input, init = {}, timeoutMs = 120_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new FetchTimeoutError("The request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function chatCompletionsEndpoint(rawBaseUrl) {
  const raw = String(rawBaseUrl ?? "").trim();
  if (!raw) throw new Error("Add an OpenAI-compatible base URL.");

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Enter a valid OpenAI-compatible base URL.");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("AI base URL must start with http:// or https://.");
  }

  if (url.protocol === "http:" && !isLocalHost(url.hostname)) {
    throw new Error("Use https:// for remote AI providers. http:// is only allowed for localhost.");
  }

  if (url.protocol === "https:" && isPrivateHost(url.hostname) && !isLocalHost(url.hostname)) {
    throw new Error("Private-network AI base URLs are blocked. Use localhost for local AI or a public https provider URL.");
  }

  url.hash = "";
  url.search = "";
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/chat/completions") ? path : `${path || "/v1"}/chat/completions`;
  return url;
}

function aiInstructions() {
  return "You are an expert resume editor for US job applications. Rewrite resumes for ATS clarity and human readability. Return one complete resume only. Include the candidate name and contact details exactly once at the top. Do not create duplicate skills sections; if the resume already has TECHNICAL SKILLS, improve that section instead of adding CORE SKILLS or another skills section. Do not invent employers, titles, dates, degrees, certifications, metrics, tools, or outcomes. If a metric would strengthen a bullet but is not provided, add a bracketed prompt such as [add metric: volume, percentage, dollars, time saved, or adoption]. Keep each role to no more than five bullets. If asked for a cover letter, write a concise truthful letter grounded only in the provided resume and job text, using bracketed placeholders for missing company, role, manager, or metric facts. Use strong action verbs, concise bullets, and role-relevant keywords only when supported by the resume. Return strict JSON only.";
}

function aiStrictReviewInstructions() {
  return "You are a senior technical recruiter and hiring manager with 10+ years of experience screening software engineering candidates. You are NOT a cheerleader — give a blunt, honest assessment. NEVER suggest fabricating experience. If a gap cannot be honestly filled with evidence the user has provided, mark it as cannot-add and recommend skipping. Don't pad with generic advice. Don't praise the resume. If the resume is genuinely a bad fit, say DON'T APPLY with a reason. DEAL-PRIORITIZE soft skills (communication, teamwork, ownership) — only note them as required if the JD explicitly demands them. Compare on these dimensions in order: 1) required technical skills, 2) required experience domains, 3) required years/seniority, 4) preferred/nice-to-have. Also polish the resume to align with the JD using only facts present in the resume or the honest context. Keep each role to no more than five bullets. Use bracketed prompts like [add metric: volume, percentage, dollars, time saved] for unverifiable claims. Return strict JSON only.";
}

function strictReviewPrompt({ includeCoverLetter, jobUrl, jobText, preserveFormat, resumeText, roleAppliedAs, honestContext }) {
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

Format-preserving DOCX export:
${preserveFormat ? "Yes. Rewrite text only, keep the resume in the same order, and return one line per original resume paragraph where practical." : "No. A clean text/PDF output is acceptable."}

Job URL:
${jobUrl || "Not provided"}

Job description:
${jobText || "Use the job URL text only if it contains useful role clues."}

Current resume:
${resumeText}`;
}

function buildPolishPrompts({ strictReview, includeCoverLetter, jobUrl, jobText, preserveFormat, resumeText, roleAppliedAs, honestContext }) {
  if (strictReview) {
    return {
      systemPrompt: aiStrictReviewInstructions(),
      userPrompt: strictReviewPrompt({ includeCoverLetter, jobUrl, jobText, preserveFormat, resumeText, roleAppliedAs, honestContext })
    };
  }
  return {
    systemPrompt: aiInstructions(),
    userPrompt: polishPrompt({ includeCoverLetter, jobUrl, jobText, preserveFormat, resumeText })
  };
}

function polishPrompt({ includeCoverLetter, jobUrl, jobText, preserveFormat, resumeText }) {
  return `Return this JSON shape exactly:
{
  "polishedText": "full polished resume text",
  "coverLetterText": ${includeCoverLetter ? "\"copy-ready cover letter text\"" : "\"\""},
  "strengths": ["2-4 concise strengths"],
  "fixes": ["2-4 concise next fixes"]
}

Generate cover letter:
${includeCoverLetter ? "Yes. Keep it under 350 words and make it copy-ready." : "No. Return an empty coverLetterText string."}

Format-preserving DOCX export:
${preserveFormat ? "Yes. Rewrite text only, keep the resume in the same order, and return one line per original resume paragraph where practical." : "No. A clean text/PDF output is acceptable."}

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
    throw new Error(data.error?.message ?? "OpenAI API request failed.");
  }

  return parseAiJson(extractOutputText(data));
}

async function callOpenAiCompatibleChat({ apiKey, apiBaseUrl, model, systemPrompt, userPrompt }) {
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
    throw new Error(data.error?.message ?? data.message ?? "OpenAI-compatible AI request failed.");
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
    throw new Error(data.error?.message ?? "Claude API request failed.");
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
    throw new Error(data.error?.message ?? "Gemini API request failed.");
  }

  return parseAiJson(extractGeminiText(data));
}

async function handlePolish(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }

  try {
    const body = JSON.parse(await readBody(req));
    const resumeText = String(body.resumeText ?? "").slice(0, 45_000);
    const jobText = String(body.jobText ?? "").slice(0, 35_000);
    const jobUrl = String(body.jobUrl ?? "").slice(0, 2_000);
    const provider = normalizeProvider(body.provider || defaultProvider);
    const requestApiKey = String(body.apiKey ?? "").trim();
    const apiKey = providerApiKey(provider, requestApiKey);
    const apiBaseUrl = providerBaseUrl(provider, body.apiBaseUrl);
    const requestedModel = String(body.model ?? "").trim().slice(0, 80);
    const model = requestedModel || providerDefaultModel(provider);
    const includeCoverLetter = Boolean(body.includeCoverLetter);
    const preserveFormat = Boolean(body.preserveFormat);
    const strictReview = Boolean(body.strictReview);
    const roleAppliedAs = String(body.roleAppliedAs ?? "").slice(0, 80);
    const honestContext = String(body.honestContext ?? "").slice(0, 8_000);

    if (resumeText.trim().length < 80 || (jobText.trim().length < 40 && jobUrl.trim().length < 8)) {
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

    const { systemPrompt, userPrompt } = buildPolishPrompts({
      strictReview,
      includeCoverLetter,
      jobUrl,
      jobText,
      preserveFormat,
      resumeText,
      roleAppliedAs,
      honestContext
    });

    let parsed;
    if (provider === "claude-cli") {
      const raw = await callClaudeCli({ model, systemPrompt, userPrompt });
      parsed = parseAiJson(raw);
    } else if (provider === "codex-cli") {
      const raw = await callCodexCli({ model, systemPrompt, userPrompt });
      parsed = parseAiJson(raw);
    } else if (provider === "anthropic") {
      parsed = await callAnthropicMessages({ apiKey, model, systemPrompt, userPrompt });
    } else if (provider === "gemini") {
      parsed = await callGeminiGenerateContent({ apiKey, model, systemPrompt, userPrompt });
    } else if (provider === "openai") {
      parsed = await callOpenAiResponses({ apiKey, model, systemPrompt, userPrompt });
    } else {
      parsed = await callOpenAiCompatibleChat({ apiKey, apiBaseUrl, model, systemPrompt, userPrompt });
    }

    sendJson(res, 200, {
      polishedText: String(parsed.polishedText ?? "").trim(),
      coverLetterText: String(parsed.coverLetterText ?? "").trim(),
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths.map(String).slice(0, 4) : [],
      fixes: Array.isArray(parsed.fixes) ? parsed.fixes.map(String).slice(0, 4) : [],
      strictReview: parsed.strictReview ?? null,
      model,
      provider
    });
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : "AI polish failed." });
  }
}

async function handleImportResumeDocx(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }

  try {
    const { docxBase64 } = JSON.parse(await readBody(req));
    const result = await extractDocxResume(docxBase64);

    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : "DOCX import failed." });
  }
}

async function readWorkspaceFiles() {
  try {
    const entries = await readdir(jobWorkspaceDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => name !== ".DS_Store")
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

async function readWorkspaceBaseResume() {
  for (const fileName of baseResumeCandidates) {
    const filePath = join(jobWorkspaceDir, fileName);
    try {
      const data = await readFile(filePath);
      const extension = extname(fileName).toLowerCase();
      if (extension === ".docx") {
        const docxBase64 = bufferToBase64(data);
        const parsed = await extractDocxResume(docxBase64);
        return {
          exists: true,
          fileName,
          kind: "docx",
          text: parsed.text,
          paragraphs: parsed.paragraphs,
          docxBase64
        };
      }

      const text = data.toString("utf8").slice(0, 45_000);
      if (text.trim().length < 80) continue;
      return {
        exists: true,
        fileName,
        kind: extension.replace(".", "") || "text",
        text
      };
    } catch {
      // Try the next supported base-resume file.
    }
  }

  return { exists: false };
}

async function handleWorkspace(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Use GET." });
    return;
  }

  try {
    await ensureJobWorkspace();
    sendJson(res, 200, {
      path: jobWorkspaceDir,
      baseResume: await readWorkspaceBaseResume(),
      files: await readWorkspaceFiles()
    });
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : "Workspace check failed." });
  }
}

async function handleWorkspaceBaseResume(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }

  try {
    await ensureJobWorkspace();
    const body = JSON.parse(await readBody(req));
    const fileName = String(body.fileName ?? "").trim();
    const extension = extname(fileName).toLowerCase();

    if (extension === ".docx") {
      const docxBase64 = String(body.fileBase64 ?? "");
      const parsed = await extractDocxResume(docxBase64);
      await writeFile(join(jobWorkspaceDir, "base-resume.docx"), base64ToBuffer(docxBase64));
      sendJson(res, 200, {
        saved: true,
        path: jobWorkspaceDir,
        baseResume: {
          exists: true,
          fileName: "base-resume.docx",
          kind: "docx",
          text: parsed.text,
          paragraphs: parsed.paragraphs,
          docxBase64
        },
        files: await readWorkspaceFiles()
      });
      return;
    }

    if (![".txt", ".md", ".csv", ""].includes(extension)) {
      sendJson(res, 400, { error: "Save a DOCX, TXT, MD, or CSV resume as the base resume." });
      return;
    }

    const text = String(body.text ?? "").slice(0, 45_000);
    if (text.trim().length < 80) {
      sendJson(res, 400, { error: "Base resume text is too short to save." });
      return;
    }

    await writeFile(join(jobWorkspaceDir, "base-resume.txt"), text, "utf8");
    sendJson(res, 200, {
      saved: true,
      path: jobWorkspaceDir,
      baseResume: {
        exists: true,
        fileName: "base-resume.txt",
        kind: "txt",
        text
      },
      files: await readWorkspaceFiles()
    });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : "Base resume save failed." });
  }
}

async function handleExportResumeDocx(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }

  try {
    const { docxBase64, polishedText } = JSON.parse(await readBody(req));
    const result = await withUnpackedDocx(docxBase64, async ({ workspace, unpackedPath }) => {
      const documentPath = join(unpackedPath, "word", "document.xml");
      const documentXml = await readFile(documentPath, "utf8");
      const applied = applyTextToDocumentXml(documentXml, polishedText);
      const outputPath = join(workspace, "polished.docx");

      await writeFile(documentPath, applied.documentXml);
      // Confine the re-zip to the unpack dir, then re-verify the resulting entry
      // names so a crafted source archive can't smuggle traversal paths through.
      await execFileAsync("zip", ["-qr", outputPath, "."], { cwd: unpackedPath });
      const { stdout: repackListing } = await execFileAsync("unzip", ["-Z1", outputPath]);
      assertSafeZipEntries(repackListing);

      return {
        docxBase64: bufferToBase64(await readFile(outputPath)),
        replacedParagraphs: applied.replacedParagraphs,
        appendedParagraphs: applied.appendedParagraphs
      };
    });

    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : "DOCX export failed." });
  }
}

async function handleListTemplates(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Use GET." });
    return;
  }

  try {
    const tectonic = await checkTectonicAvailability();
    sendJson(res, 200, {
      templates: listTemplates(),
      defaultTemplateId,
      tectonic
    });
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : "Template list failed." });
  }
}

async function handleRenderResumeLatex(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }

  try {
    const body = JSON.parse(await readBody(req));
    const resumeText = String(body.resumeText ?? "");
    const templateId = String(body.templateId ?? defaultTemplateId);
    const wantsPdf = Boolean(body.wantsPdf);

    if (!resumeText.trim()) {
      sendJson(res, 400, { error: "Resume text is empty." });
      return;
    }

    const { tex, templateId: resolvedTemplateId } = renderResumeTex({ resumeText, templateId });

    let pdfBase64 = null;
    let pdfError = null;
    if (wantsPdf) {
      try {
        const pdfBuffer = await compileTexToPdf(tex);
        pdfBase64 = pdfBuffer.toString("base64");
      } catch (error) {
        pdfError = {
          code: error?.code ?? "COMPILE_FAILED",
          message: error instanceof Error ? error.message : "PDF compile failed."
        };
      }
    }

    sendJson(res, 200, { tex, templateId: resolvedTemplateId, pdfBase64, pdfError });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : "LaTeX render failed." });
  }
}

async function handleImportResumeTex(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }

  try {
    const body = JSON.parse(await readBody(req));
    const tex = String(body.tex ?? "");
    if (!tex.trim()) {
      sendJson(res, 400, { error: "LaTeX source is empty." });
      return;
    }
    const text = extractPlainTextFromLatex(tex);
    if (!text.trim()) {
      sendJson(res, 422, { error: "Could not extract text from the LaTeX source. Paste the resume content directly instead." });
      return;
    }
    sendJson(res, 200, { text });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : "LaTeX import failed." });
  }
}

async function handleListApplications(req, res) {
  try {
    const applications = await readApplications(jobWorkspaceDir);
    sendJson(res, 200, {
      applications,
      path: applicationsFilePath(jobWorkspaceDir)
    });
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : "Application list failed." });
  }
}

async function handleSaveApplications(req, res) {
  try {
    const body = JSON.parse(await readBody(req));
    const incoming = Array.isArray(body.applications) ? body.applications : [];
    const applications = await writeApplications(jobWorkspaceDir, incoming);
    sendJson(res, 200, { applications });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : "Application save failed." });
  }
}

// Fetches a job page, following redirects manually and re-validating the
// host + resolved IP of every hop. Rejects private/blocked targets instead of
// auto-following them, so a public URL can't bounce to an internal address.
async function fetchPublicHtml(startUrl) {
  let current = startUrl;
  for (let hop = 0; hop < 5; hop += 1) {
    if (!isPublicHttpUrl(current)) {
      throw new BlockedHostError("Only public http or https URLs are allowed.");
    }
    await assertPublicHost(current.hostname);

    const response = await fetchWithTimeout(
      current,
      {
        headers: { "User-Agent": "Mozilla/5.0 ResumePolisher/0.1" },
        redirect: "manual"
      },
      10_000
    );

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new BlockedHostError("The site redirected without a destination.");
      current = new URL(location, current);
      continue;
    }

    return response;
  }
  throw new BlockedHostError("The site redirected too many times.");
}

async function handleImportJob(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }

  let jobUrl;
  try {
    const { url } = JSON.parse(await readBody(req));
    jobUrl = new URL(String(url ?? ""));
  } catch {
    sendJson(res, 400, { error: "Enter a valid job posting URL." });
    return;
  }

  if (!isPublicHttpUrl(jobUrl)) {
    sendJson(res, 400, { error: "Enter a public http or https job posting URL." });
    return;
  }

  try {
    const response = await fetchPublicHtml(jobUrl);

    if (!response.ok) {
      sendJson(res, 400, {
        error: `The job page returned HTTP ${response.status}. Paste the job description text instead.`
      });
      return;
    }

    const html = await response.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (text.length < 200) {
      sendJson(res, 400, { error: "Job page did not expose enough readable text. Paste it instead." });
      return;
    }
    sendJson(res, 200, { text: text.slice(0, 12_000) });
  } catch (error) {
    if (error instanceof BlockedHostError) {
      sendJson(res, 400, { error: `${error.message} Paste the job description text instead.` });
      return;
    }
    if (error instanceof DnsError) {
      sendJson(res, 400, { error: "Could not resolve that URL's host. Check the link or paste the text instead." });
      return;
    }
    if (error instanceof FetchTimeoutError) {
      sendJson(res, 504, { error: "Fetching the job page timed out. Paste the job description text instead." });
      return;
    }
    sendJson(res, 400, { error: "This site blocked direct import. Paste the job description text instead." });
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = resolve(join(root, "dist", pathname));

  if (!filePath.startsWith(resolve(join(root, "dist")))) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const data = await readFile(filePath);
    const type =
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml"
      }[extname(filePath)] ?? "application/octet-stream";

    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  } catch {
    const index = await readFile(join(root, "dist", "index.html"));
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(index);
  }
}

const vite = isProduction
  ? null
  : await createViteServer({
      root,
      appType: "spa",
      server: {
        middlewareMode: true
      }
    });

const server = createServer((req, res) => {
  const pathname = new URL(req.url ?? "/", `http://${req.headers.host}`).pathname;

  if (pathname === "/api/polish") {
    void handlePolish(req, res);
    return;
  }

  if (pathname === "/api/import-job") {
    void handleImportJob(req, res);
    return;
  }

  if (pathname === "/api/workspace") {
    void handleWorkspace(req, res);
    return;
  }

  if (pathname === "/api/workspace/base-resume") {
    void handleWorkspaceBaseResume(req, res);
    return;
  }

  if (pathname === "/api/import-resume-docx") {
    void handleImportResumeDocx(req, res);
    return;
  }

  if (pathname === "/api/export-resume-docx") {
    void handleExportResumeDocx(req, res);
    return;
  }

  if (pathname === "/api/templates") {
    void handleListTemplates(req, res);
    return;
  }

  if (pathname === "/api/render-resume-latex") {
    void handleRenderResumeLatex(req, res);
    return;
  }

  if (pathname === "/api/import-resume-tex") {
    void handleImportResumeTex(req, res);
    return;
  }

  if (pathname === "/api/applications") {
    if (req.method === "GET") {
      void handleListApplications(req, res);
    } else if (req.method === "PUT" || req.method === "POST") {
      void handleSaveApplications(req, res);
    } else {
      sendJson(res, 405, { error: "Use GET or PUT." });
    }
    return;
  }

  if (vite) {
    vite.middlewares(req, res, () => {
      res.writeHead(404);
      res.end("Not found");
    });
    return;
  }

  void serveStatic(req, res);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`RoleFit AI running at http://localhost:${port}/`);
  console.log(`Default AI model: ${defaultModel}`);
});
