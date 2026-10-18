// Files saved before per-field text sizes carried one document size (a
// resume's baseFontSizePt, a letter's fontSizePt) that every text role scaled
// from, and painted the name bold whatever its marks said. Reading such a file
// writes those sizes, and the name's bold, onto the fields themselves, so its
// text keeps its sizes and it saves without the retired key. Geometry the old
// size also scaled (bullet gap, first baseline, rule offset) is now fixed;
// D081 records that drift.
import { effectiveFieldSize, fieldMarkState, setFieldMark, stripInlineMarks } from "./inlineMarksText.ts";
import { TEXT_SIZES_PT } from "./documentTypography.ts";
import type { ResumeData } from "./resumeData.ts";

type Role = keyof typeof TEXT_SIZES_PT;

// The retired scale's ratios, kept only to reproduce what old files showed.
function legacySizePt(role: Role, legacySizeBasePt: number): number {
  if (role === "name") return Math.round(legacySizeBasePt * 2.487905);
  if (role === "sectionHeading") return Math.round(legacySizeBasePt * 1.19994);
  if (role === "titleLeft" || role === "titleRight") return Math.round(legacySizeBasePt * 1.094951);
  return legacySizeBasePt;
}

function withLegacySize(value: string, role: Role, legacySizeBasePt: number): string {
  const size = legacySizePt(role, legacySizeBasePt);
  if (size === TEXT_SIZES_PT[role] || !stripInlineMarks(value).trim()) return value;
  const whole = effectiveFieldSize(value, -1);
  if (whole !== null && whole > 0) return value;
  return `<size=${size}>${value}</size>`;
}

function withLegacyBold(value: string): string {
  if (!stripInlineMarks(value).trim() || fieldMarkState(value, "bold") === true) return value;
  return setFieldMark(value, "bold", true);
}

export function upgradeLegacyTextSizes(data: ResumeData, legacySizeBasePt: number): ResumeData {
  const sized = (value: string, role: Role) => withLegacySize(value, role, legacySizeBasePt);
  const sizedOrNull = (value: string | null, role: Role) => (value === null ? null : sized(value, role));
  return {
    header: data.header && {
      ...data.header,
      name: data.header.name === null ? null : withLegacyBold(sized(data.header.name, "name")),
      contact: data.header.contact.map((piece) => sized(piece, "contact"))
    },
    sections: data.sections.map((section) => ({
      ...section,
      heading: sized(section.heading, "sectionHeading"),
      items: section.items.map((item) => ({
        ...item,
        ...(section.type === "skills"
          ? {
              titleLeft: sizedOrNull(item.titleLeft, "skillLabel"),
              subtitleLeft: sizedOrNull(item.subtitleLeft, "body")
            }
          : section.type === "summary"
            ? {}
            : {
                titleLeft: sizedOrNull(item.titleLeft, "titleLeft"),
                titleRight: sizedOrNull(item.titleRight, "titleRight"),
                subtitleLeft: sizedOrNull(item.subtitleLeft, "subtitleLeft"),
                subtitleRight: sizedOrNull(item.subtitleRight, "subtitleRight")
              }),
        bullets: item.bullets.map((bullet) => ({ ...bullet, text: sized(bullet.text, "body") }))
      }))
    }))
  };
}
