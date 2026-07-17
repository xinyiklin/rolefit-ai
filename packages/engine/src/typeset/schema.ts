// Exact input contract for the deterministic layout engine. ResumeData remains
// the editable domain model; toTypesetSchema below is the sole adapter into
// this provenance-bearing, renderer-ready shape.

import type { ResumeData, ResumeSectionType } from "../lib/resumeData.ts";

export type TypesetSectionType = ResumeSectionType;

export type TypesetSchemaEntry = {
  id: string;
  titleLeft: string;
  titleRight: string;
  subtitleLeft: string;
  subtitleRight: string;
  bullets: string[];
  bulletIds: string[];
};

export type TypesetSchemaSection = {
  id: string;
  heading: string;
  type: TypesetSectionType;
  items: TypesetSchemaEntry[];
};

export type TypesetSchema = {
  name: string;
  contact: string[];
  sections: TypesetSchemaSection[];
};

// The single adapter from the editable domain model into layout input. Empty
// fields and provenance ids stay present so direct editing remains addressable.
export function toTypesetSchema(data: ResumeData): TypesetSchema {
  return {
    name: data.name.trimStart(),
    contact: data.contact.map((item) => item.trimStart()),
    sections: data.sections.map((section) => ({
      id: section.id,
      heading: section.heading.trimStart(),
      type: section.type,
      items: section.items.map((item) => ({
        id: item.id,
        titleLeft: section.type === "summary" ? "" : item.titleLeft.trimStart(),
        titleRight: section.type === "summary" ? "" : item.titleRight.trimStart(),
        subtitleLeft: section.type === "summary" ? "" : item.subtitleLeft.trimStart(),
        subtitleRight: section.type === "summary" ? "" : item.subtitleRight.trimStart(),
        bullets: item.bullets.map((bullet) => bullet.text.trimStart()),
        bulletIds: item.bullets.map((bullet) => bullet.id)
      }))
    }))
  };
}
