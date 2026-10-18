// Default size, in points, of every text role, shared by resumes and cover
// letters. Text without its own <size> paints at its role default; nothing
// derives one role's size from another's.
import { fieldSizePt, stripInlineMarks } from "./inlineMarksText.ts";

export const TEXT_SIZES_PT = {
  name: 25,
  contact: 10,
  sectionHeading: 12,
  titleLeft: 11,
  titleRight: 11,
  subtitleLeft: 10,
  subtitleRight: 10,
  skillLabel: 10,
  body: 10
} as const;

// The size a field is set at: the size most of its text carries (words may
// carry their own), else the role default.
export function fieldRoleSizePt(value: string, defaultSizePt: number): number {
  return fieldSizePt(value) ?? defaultSizePt;
}

// The role size of a row of fields: the largest among fields with text, so an
// empty partner (a blank date) never pulls the row back to its default.
export function rowRoleSizePt(fields: readonly (readonly [string, number])[]): number {
  const filled = fields.filter(([value]) => stripInlineMarks(value).trim());
  return Math.max(...(filled.length ? filled : fields).map(([value, size]) => fieldRoleSizePt(value, size)));
}

// The bullet dot follows its bullet's size (6 pt beside 10 pt text).
export function bulletMarkerSizePt(bulletSizePt: number): number {
  return Math.round(bulletSizePt * 0.6);
}
