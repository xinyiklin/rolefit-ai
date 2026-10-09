// Reads a PDF's text layer into positioned spans. pdf.js is injected so the
// browser can pass React-PDF's configured worker build and Node evals the
// legacy build; nothing here touches the DOM or the network.

import { MAX_IMPORT_PDF_BYTES, MAX_IMPORT_PDF_PAGES, PdfImportError, pdfImportError, type PdfImportErrorKind } from "./importErrors.ts";

export type PdfSpan = {
  id: string;
  page: number;
  text: string;
  // Page-space points with the origin at the top-left; `y` is the baseline.
  x: number;
  y: number;
  width: number;
  size: number;
  font: string;
  bold: boolean;
  italic: boolean;
  // Dingbat faces (ZapfDingbats, Wingdings, Webdings) map glyphs to arbitrary
  // letters ("l" for a ZapfDingbats bullet), so their text is a marker, never
  // content. Symbol fonts map to real characters ("≥", "•") and stay text.
  dingbat: boolean;
  smallCaps: boolean;
};

export type PdfRule = { page: number; x0: number; x1: number; y: number };

export type PdfLayout = {
  pages: { width: number; height: number; hasImages: boolean }[];
  spans: PdfSpan[];
  rules: PdfRule[];
};

// The slice of the pdf.js API this module reads.
type PdfTextItemLike = { str?: unknown; transform?: unknown; width?: unknown; fontName?: unknown };
type PdfPageLike = {
  getViewport(params: { scale: number }): { width: number; height: number; transform: number[] };
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[] }>;
  getTextContent(): Promise<{ items: unknown[] }>;
  getAnnotations?(): Promise<unknown[]>;
  commonObjs: { has?(id: string): boolean; get(id: string): unknown };
  cleanup?(): unknown;
};
type PdfDocumentLike = { numPages: number; getPage(pageNumber: number): Promise<PdfPageLike> };
export type PdfJsLike = {
  getDocument(source: {
    data: Uint8Array;
    isEvalSupported: boolean;
    useWorkerFetch?: boolean;
    verbosity?: number;
  }): { promise: Promise<PdfDocumentLike>; destroy(): Promise<void> };
  OPS: Record<string, number>;
};

type Matrix = [number, number, number, number, number, number];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5]
  ];
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function asMatrix(value: unknown): Matrix | null {
  if (!value || typeof (value as ArrayLike<number>).length !== "number") return null;
  const list = Array.from(value as ArrayLike<number>);
  return list.length === 6 && list.every(Number.isFinite) ? (list as Matrix) : null;
}

const PDF_MAGIC = "%PDF-";

function looksLikePdf(bytes: Uint8Array): boolean {
  const head = String.fromCharCode(...bytes.subarray(0, 1024));
  return head.includes(PDF_MAGIC);
}

// Subset prefixes ("ABCDEF+") and the engine's per-document suffixes
// ("-8659") carry no family information.
function fontBaseName(raw: string): string {
  return raw.replace(/^[A-Z]{6}\+/, "").replace(/-\d+$/, "");
}

type FontFacts = { name?: unknown; bold?: unknown; black?: unknown; italic?: unknown };

function fontFacts(page: PdfPageLike, id: string): { name: string; bold: boolean; italic: boolean } {
  const facts = (page.commonObjs.has?.(id) ?? true) ? (page.commonObjs.get(id) as FontFacts | null) : null;
  const name = typeof facts?.name === "string" ? fontBaseName(facts.name) : "";
  return {
    name,
    bold: facts?.bold === true || facts?.black === true || /bold|black|heavy|semibold|demi/i.test(name),
    italic: facts?.italic === true || /italic|oblique|-(?:bold)?it$/i.test(name)
  };
}

const DINGBAT_FONT_RE = /dingbat|wingding|webding/i;
const SMALL_CAPS_FONT_RE = /caps|(?:^|[-_])sc(?:$|[-_])/i;

// A filled text or choice field, or a text box added in a viewer (FreeText),
// paints its text from the annotation, not the page content pdf.js reads as
// text, so importing would silently miss it.
function paintsOwnText(annotation: unknown): boolean {
  const note = annotation as {
    subtype?: unknown;
    fieldType?: unknown;
    fieldValue?: unknown;
    hasAppearance?: unknown;
    contentsObj?: { str?: unknown };
  } | null;
  const filled = (value: unknown) => typeof value === "string" && value.trim() !== "";
  if (note?.subtype === "FreeText") return note.hasAppearance === true || filled(note.contentsObj?.str);
  if (note?.subtype !== "Widget" || (note.fieldType !== "Tx" && note.fieldType !== "Ch")) return false;
  return (Array.isArray(note.fieldValue) ? note.fieldValue : [note.fieldValue]).some(filled);
}

function errorKind(error: unknown): PdfImportErrorKind {
  const name = (error as { name?: unknown } | null)?.name;
  return name === "PasswordException" ? "encrypted" : "malformed";
}

// Characters that mean the text layer is garbage rather than words: the
// replacement character, private-use glyph codes, and C0 controls.
const UNREADABLE_RE = /[\uFFFD\uE000-\uF8FF\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu;
const LONE_PRIVATE_USE_RE = /^\s*[\uE000-\uF8FF]\s*$/u;

export async function readPdfLayout(bytes: Uint8Array, pdfjs: PdfJsLike): Promise<PdfLayout> {
  if (bytes.byteLength > MAX_IMPORT_PDF_BYTES) throw pdfImportError("too-large");
  if (!looksLikePdf(bytes)) throw pdfImportError("not-pdf");

  // pdf.js transfers the buffer to its worker and refuses Node Buffers; hand it
  // a plain copy so the caller's bytes stay intact.
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useWorkerFetch: false, verbosity: 0 });
  let doc: PdfDocumentLike;
  try {
    doc = await task.promise;
  } catch (error) {
    await task.destroy();
    throw pdfImportError(errorKind(error));
  }

  try {
    if (doc.numPages < 1) throw pdfImportError("malformed");
    if (doc.numPages > MAX_IMPORT_PDF_PAGES) throw pdfImportError("too-many-pages");
    const layout: PdfLayout = { pages: [], spans: [], rules: [] };
    const opName = Object.fromEntries(Object.entries(pdfjs.OPS).map(([name, code]) => [code, name]));

    for (let pageIndex = 0; pageIndex < doc.numPages; pageIndex += 1) {
      let page: PdfPageLike;
      let operators: { fnArray: number[]; argsArray: unknown[] };
      let content: { items: unknown[] };
      try {
        page = await doc.getPage(pageIndex + 1);
        operators = await page.getOperatorList();
        content = await page.getTextContent();
        if ((await page.getAnnotations?.())?.some(paintsOwnText)) throw pdfImportError("overlay-text");
      } catch (error) {
        throw error instanceof PdfImportError ? error : pdfImportError(errorKind(error));
      }
      const viewport = page.getViewport({ scale: 1 });
      const toPage = asMatrix(viewport.transform) ?? [1, 0, 0, -1, 0, viewport.height];
      let hasImages = false;

      let ctm: Matrix = [1, 0, 0, 1, 0, 0];
      const stack: Matrix[] = [];
      operators.fnArray.forEach((fn, index) => {
        const op = opName[fn];
        const args = operators.argsArray[index] as unknown[] | null;
        if (op === "save") stack.push(ctm);
        else if (op === "restore") ctm = stack.pop() ?? ctm;
        else if (op === "transform") ctm = multiply(ctm, asMatrix(args) ?? [1, 0, 0, 1, 0, 0]);
        else if (op === "paintImageXObject" || op === "paintInlineImageXObject" || op === "paintImageMaskXObject") hasImages = true;
        else if (op === "constructPath") {
          const box = args?.[2] as ArrayLike<number> | undefined;
          if (!box || box.length !== 4) return;
          const corners = [apply(ctm, box[0], box[1]), apply(ctm, box[2], box[3])].map(([x, y]) => apply(toPage, x, y));
          const x0 = Math.min(corners[0][0], corners[1][0]);
          const x1 = Math.max(corners[0][0], corners[1][0]);
          const y0 = Math.min(corners[0][1], corners[1][1]);
          const y1 = Math.max(corners[0][1], corners[1][1]);
          if (y1 - y0 <= 2.5 && x1 - x0 >= 24) layout.rules.push({ page: pageIndex, x0, x1, y: (y0 + y1) / 2 });
        }
      });

      for (const raw of content.items as PdfTextItemLike[]) {
        const text = typeof raw.str === "string" ? raw.str : "";
        if (!text.trim()) continue;
        const itemMatrix = asMatrix(raw.transform);
        if (!itemMatrix) continue;
        const m = multiply(toPage, itemMatrix);
        const font = fontFacts(page, typeof raw.fontName === "string" ? raw.fontName : "");
        layout.spans.push({
          id: `s${layout.spans.length + 1}`,
          page: pageIndex,
          text,
          x: m[4],
          y: m[5],
          width: Number(raw.width) || 0,
          size: Math.hypot(m[2], m[3]) || Math.hypot(m[0], m[1]),
          font: font.name,
          bold: font.bold,
          italic: font.italic,
          dingbat: DINGBAT_FONT_RE.test(font.name),
          smallCaps: SMALL_CAPS_FONT_RE.test(font.name)
        });
      }
      layout.pages.push({ width: viewport.width, height: viewport.height, hasImages });
      page.cleanup?.();
    }

    // Some exporters paint one glyph per run, so single characters count. A
    // lone private-use glyph between readable runs is an icon or bullet; a
    // string of them is unmapped text painted a glyph at a time.
    const text = layout.spans.filter((span) => !span.dingbat);
    const characters = text.reduce((total, span) => total + span.text.replace(/\s/g, "").length, 0);
    if (characters < 20) throw pdfImportError("no-text");
    const lone = text.map((span) => LONE_PRIVATE_USE_RE.test(span.text));
    const unreadable = text.reduce(
      (total, span, index) =>
        total + (lone[index] && !lone[index - 1] && !lone[index + 1] ? 0 : span.text.match(UNREADABLE_RE)?.length ?? 0),
      0
    );
    if (unreadable / characters > 0.1) throw pdfImportError("unreadable");
    return layout;
  } finally {
    await task.destroy();
  }
}
