import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function base64ToBuffer(value) {
  const base64 = String(value ?? "").replace(/^data:[^,]+,/, "");
  if (!base64 || !/^[a-z0-9+/=\s]+$/i.test(base64)) {
    throw new Error("DOCX data was not valid base64.");
  }
  return Buffer.from(base64, "base64");
}

export function bufferToBase64(buffer) {
  return Buffer.from(buffer).toString("base64");
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

export function applyTextToDocumentXml(documentXml, polishedText) {
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
export function assertSafeZipEntries(listing) {
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

export async function withUnpackedDocx(docxBase64, callback) {
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

export async function extractDocxResume(docxBase64) {
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

export { execFileAsync };
