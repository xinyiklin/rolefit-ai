export type ResumePageBreaks = Record<string, number>;

export type PageBreakKind = "section" | "entry" | "bullet";

export function pageBreakId(kind: PageBreakKind, id: string) {
  return `${kind}:${id}`;
}
