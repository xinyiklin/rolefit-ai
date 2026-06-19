// Types for the shared section-model (sections.mjs). Hand-written because the
// implementation is plain ESM (.mjs) so node can import it at runtime.
import type { ResumeSectionType } from "../lib/resumeData";

export const BULLET_GLYPHS: string;

/** Trim + strip a trailing colon + lowercase — the section-name key (a.k.a. sectionName). */
export function normalize(line: string): string;

/** Parser-level: is this line a section header (top-level OR sub-section)? */
export function isSectionHeader(line: string): boolean;

/** Scorer/rewrite-level: is this an exact top-level section name (boundary)? */
export function isTopLevelSectionHeader(line: string): boolean;

/** Editor section type inferred from a heading. */
export function inferSectionType(heading: string): ResumeSectionType;

/** Summary-but-not-skills heading (renders as plain paragraphs). */
export function isSummaryHeading(heading: string): boolean;

/** Education heading (scorer date-shield trigger), with job-entry/year guards. */
export function isEducationHeading(line: string): boolean;
