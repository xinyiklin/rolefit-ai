import type { IncomingMessage, ServerResponse } from "node:http";
import {
  RESUME_IMPORT_PROMPT_VERSION,
  ResumeImportContractError,
  parseResumeImportLines,
  resumeImportPieceText,
  validateResumeImportStructure,
  type ResumeImportLine,
  type ResumeImportStructure
} from "../../shared/resumeImportContract.ts";
import { isRequestAborted, requestAbortSignal, sendJson } from "../http.ts";
import { UserSafeAiError, safeConfigErrorMessage } from "./errors.ts";
import { readAiJsonBody } from "./json.ts";
import { callConfiguredProvider } from "./clients.ts";
import { RESUME_IMPORT_FENCE_NAMES, fenceUntrusted, inputFirewallRule } from "./prompts.ts";
import { resolveProviderRequest } from "./providers.ts";

// Resume import interprets structure only. The model answers with references
// to the pieces it was sent, never with text, so it has no way to reword,
// correct, or invent anything; the shared validator rejects any reference or
// quoted substring that is not in the PDF.
export function resumeImportSystemPrompt(): string {
  return `You rebuild the structure of a resume from the text lines extracted from its PDF. You never write text. Every field you return is a list of references to the numbered source pieces, in reading order.

How to reference text:
- A whole piece: its id, for example "p12".
- Part of a piece, when one piece holds text for two fields (for example a role and its dates in one run): {"piece": "p12", "text": "exact substring"}. Copy the substring character for character from that piece. When you split a piece, reference every part of it, in its original order and in different fields; only spaces, separators such as | or •, and a label's colon may fall between the parts.
- Within a field, keep the pieces in the order they appear in the PDF.
- Never reword, correct, complete, translate, summarize, or invent text, and never reference the same text twice.
- Leave out page numbers, running headers or footers, and anything you cannot place, always as whole pieces. The user is shown every piece you leave out, so leaving text out is safe; guessing is not.

Shape:
- name: the person's name.
- contact: one list per contact detail (email, phone, location, profile link). Split at separators such as | or • and leave the separator characters out.
- sections, in reading order, each with heading, type, and entries:
  - "standard" (experience, education, projects, certifications, and similar): each entry has titleLeft (organization, school, project, or role), titleRight (text aligned right on that row, usually dates or a location), subtitleLeft (the second row, usually the role or degree), subtitleRight (the right side of the second row), and bullets (one list per bullet, including its wrapped lines; a line with marker true starts a bullet).
  - "skills": one entry per row; titleLeft is the category label without its colon, subtitleLeft is the list. Leave the other fields empty.
  - "summary": one entry per paragraph, with that paragraph as the entry's only bullet. Leave the title fields empty.
- Use the line geometry to decide structure: page and region (two-column pages read the left column, then the right), x position, font size, bold, italic, and marker. Standalone lines that are larger, bold, or all capitals usually start sections.

${inputFirewallRule(RESUME_IMPORT_FENCE_NAMES)}

Return only JSON: {"name":[ref],"contact":[[ref]],"sections":[{"heading":[ref],"type":"standard | skills | summary","entries":[{"titleLeft":[ref],"titleRight":[ref],"subtitleLeft":[ref],"subtitleRight":[ref],"bullets":[[ref]]}]}]}`;
}

export function resumeImportUserPrompt(lines: readonly ResumeImportLine[]): string {
  return `<resume_source_lines>${fenceUntrusted(JSON.stringify(lines))}</resume_source_lines>`;
}

export async function interpretResumeImport({
  lines,
  body,
  signal,
  stats
}: {
  lines: readonly ResumeImportLine[];
  body: Parameters<typeof resolveProviderRequest>[0];
  signal?: AbortSignal;
  stats?: Parameters<typeof callConfiguredProvider>[1];
}): Promise<ResumeImportStructure> {
  const raw = await callConfiguredProvider(
    {
      ...resolveProviderRequest(body),
      signal,
      retryUnreadableOutput: false,
      systemPrompt: resumeImportSystemPrompt(),
      userPrompt: resumeImportUserPrompt(lines)
    },
    stats
  );
  try {
    return validateResumeImportStructure(raw, resumeImportPieceText(lines));
  } catch (error) {
    if (error instanceof ResumeImportContractError) {
      throw new UserSafeAiError(`The AI interpretation was not usable: ${error.message} The local reading was kept.`, 422);
    }
    throw error;
  }
}

export async function handleResumeImport(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }
  const request = requestAbortSignal(req, res);
  try {
    const body = await readAiJsonBody(req, 1_000_000);
    let lines: ResumeImportLine[];
    try {
      lines = parseResumeImportLines(body.lines);
    } catch (error) {
      if (error instanceof ResumeImportContractError) throw new UserSafeAiError(error.message, 400);
      throw error;
    }
    const structure = await interpretResumeImport({ lines, body, signal: request.signal });
    sendJson(res, 200, { structure, promptVersion: RESUME_IMPORT_PROMPT_VERSION });
  } catch (error) {
    if (isRequestAborted(error, req, res)) return;
    const message =
      error instanceof UserSafeAiError
        ? error.message
        : safeConfigErrorMessage(error instanceof Error ? error.message : "") ||
          "Resume import could not interpret this PDF. Check AI settings and retry.";
    sendJson(res, error instanceof UserSafeAiError ? error.status : 500, { error: message });
  } finally {
    request.dispose();
  }
}
