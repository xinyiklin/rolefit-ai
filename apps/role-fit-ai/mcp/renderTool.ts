// render_pdf: a .resume or .cover rendered to PDF by the engine RoleFit itself
// exports with (same layout, metrics and PDF emitter), using the font files the
// running RoleFit serves. The PDF goes to a path the agent names (D103); the
// workspace is never touched.

import { writeFile } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";

import { coverLetterStyleToDocumentStyle, parseCoverLetterFile } from "@typeset/engine/lib/coverLetter.ts";
import { parseResumeFile } from "@typeset/engine/lib/resumeFile.ts";
import { ensureLayoutMetrics, layoutCoverLetter, layoutResume, type LayoutDocument } from "@typeset/engine/typeset/layout.ts";
import { emitPdf, fetchFontBytes } from "@typeset/engine/typeset/pdf/emit.ts";
import { toTypesetSchema } from "@typeset/engine/typeset/schema.ts";
import { isToolResult, type DocumentKind, type RoleFitClient, type Tool, type ToolResult } from "./client.ts";

const fail = (error: string): ToolResult => ({ ok: false, value: { error } });

export function createRenderTool(client: RoleFitClient, baseUrl: string): Tool {
  // The document's .resume/.cover source from exactly one place.
  async function source(kind: DocumentKind, args: Record<string, unknown>): Promise<string | ToolResult> {
    const { sourceText, fileName, applicationId } = args;
    const given = [sourceText, fileName, applicationId].filter((value) => value !== undefined).length;
    if (given !== 1) return fail("Give exactly one of sourceText, fileName and applicationId.");
    if (sourceText !== undefined) {
      return typeof sourceText === "string" && sourceText ? sourceText : fail(`sourceText: required .${kind} text`);
    }
    if (fileName !== undefined) {
      const read = await client.workspaceVariant(kind, fileName);
      return read.ok ? (read.value as { sourceText: string }).sourceText : read;
    }
    const record = await client.getApplication(applicationId);
    if (isToolResult(record)) return record;
    const saved = await client.applicationDocument(record.id, kind, kind === "resume" ? record.resumeArtifacts : record.coverLetterArtifacts);
    if (!saved) return fail(`Application ${record.id} has no saved ${kind}.`);
    if (!saved.ok) return saved;
    const text = (saved.value as { sourceText?: string }).sourceText;
    return text ?? fail(`Application ${record.id} saved its ${kind} as a PDF only; that file is already the PDF.`);
  }

  return {
    name: "render_pdf",
    title: "Render PDF",
    description:
      "Render a .resume or .cover to PDF with RoleFit's own engine, exactly as RoleFit exports it, and write it to " +
      "`outputPath`. The source is a complete file as sourceText (for example apply_resume_edits' or " +
      "polish_cover_letter's sourceText), a saved one by fileName, or the one saved on a tracker record by " +
      "applicationId. The text is rendered as written; nothing is added, so a letter whose text ends with a " +
      "sign-off has it once. Returns the path, page count and size. Refuses to replace an existing file unless " +
      "overwrite is true. Needs RoleFit running (it reads RoleFit's font files). Saves nothing in RoleFit.",
    inputSchema: {
      type: "object",
      required: ["kind", "outputPath"],
      additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["resume", "cover"] },
        sourceText: { type: "string", description: "The complete .resume or .cover file text." },
        fileName: { type: "string", description: "A saved resume or cover letter (list_resumes, list_cover_letters)." },
        applicationId: { type: "string", description: "A tracker record whose saved document to render." },
        outputPath: { type: "string", description: "Absolute path of the PDF to write, ending in .pdf; its folder must exist." },
        overwrite: { type: "boolean", description: "Replace a file already at outputPath." },
        title: { type: "string", maxLength: 200, description: "The PDF's document title; defaults to the file name." }
      }
    },
    async run(args) {
      const { kind, outputPath, overwrite, title } = args;
      if (kind !== "resume" && kind !== "cover") return fail("kind: resume or cover");
      if (typeof outputPath !== "string" || !isAbsolute(outputPath) || !/\.pdf$/i.test(outputPath)) {
        return fail("outputPath: an absolute path ending in .pdf");
      }
      if (overwrite !== undefined && typeof overwrite !== "boolean") return fail("overwrite: true or false");
      if (title !== undefined && (typeof title !== "string" || title.length > 200)) return fail("title: text of at most 200 characters");
      const text = await source(kind, args);
      if (isToolResult(text)) return text;
      let document: LayoutDocument;
      try {
        if (kind === "resume") {
          const parsed = parseResumeFile(text);
          const schema = toTypesetSchema(parsed.data);
          await ensureLayoutMetrics(schema, parsed.documentStyle);
          document = layoutResume(schema, parsed.documentStyle);
        } else {
          const parsed = parseCoverLetterFile(text);
          const schema = toTypesetSchema(parsed.data);
          const style = coverLetterStyleToDocumentStyle(parsed.style);
          await ensureLayoutMetrics(schema, style);
          document = layoutCoverLetter(schema, style);
        }
      } catch (error) {
        return fail(`The .${kind} could not be read: ${error instanceof Error ? error.message : String(error)}`);
      }
      let bytes: Uint8Array;
      try {
        const fonts = await fetchFontBytes(document, `${baseUrl}/fonts`);
        bytes = await emitPdf(document, fonts, {
          title: (title as string | undefined)?.trim() || basename(outputPath).replace(/\.pdf$/i, "")
        });
      } catch (error) {
        return fail(`RoleFit's fonts could not be loaded from ${baseUrl}, so no PDF was written (${error instanceof Error ? error.message : String(error)}). Start RoleFit and try again.`);
      }
      try {
        await writeFile(outputPath, bytes, { flag: overwrite ? "w" : "wx", mode: 0o600 });
      } catch (error) {
        const code = (error as { code?: string }).code;
        return fail(code === "EEXIST"
          ? "outputPath: a file is already there; choose another path or send overwrite: true."
          : `outputPath: could not write the PDF (${code ?? (error instanceof Error ? error.message : String(error))}).`);
      }
      return { ok: true, value: { path: outputPath, kind, pages: document.pages.length, bytes: bytes.byteLength } };
    }
  };
}
