import { stripInlineMarks } from "@typeset/engine/lib/inlineMarksText.ts";
import type { ResumeData, ResumeEntry } from "@typeset/engine/lib/resumeData.ts";

import { templateHasUnresolvedSlots } from "./coverLetterTemplate.ts";

export type CoverLetterEvidenceSource = "resume" | "honest_context" | "user_answer";

export type CoverLetterEvidenceItem = {
  id: string;
  source: CoverLetterEvidenceSource;
  text: string;
  section?: string;
  entry?: string;
};

// One finished body paragraph plus the provenance the server verifies. The model
// chooses which evidence to use; the ids exist so the choice can be checked and
// shown, not so the candidate has to approve it in advance.
export type CoverLetterBodyParagraph = {
  text: string;
  evidenceIds: string[];
  slotIds: string[];
};

export type CoverLetterTailorResult = {
  status: "ready";
  coverLetterText: string;
  bodyParagraphs: CoverLetterBodyParagraph[];
  evidenceUsed: CoverLetterEvidenceItem[];
  warnings: string[];
  provider?: string;
  model?: string;
  reasoningEffort?: string;
  attempts?: number;
  repaired?: boolean;
};

type BuildCoverLetterEvidenceInput = {
  resumeData?: ResumeData | null;
  honestContext: string;
  // Answers to the few template slots that name a private fact RoleFit cannot
  // infer. They enter the corpus as candidate evidence like anything else.
  slotAnswers?: Record<string, string>;
  slotLabels?: Record<string, string>;
};

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function stableEvidenceId(
  source: CoverLetterEvidenceSource,
  text: string,
  context: string,
  occurrences: Map<string, number>
): string {
  const fingerprint = fnv1a(`${source}\u0000${context}\u0000${compact(text).toLowerCase()}`);
  const occurrence = (occurrences.get(fingerprint) ?? 0) + 1;
  occurrences.set(fingerprint, occurrence);
  return `${source}:${fingerprint}:${occurrence}`;
}

// Attribution context for one resume entry. It stays long on purpose: for an
// entry with bullets, the dates, link, employer, and stack live ONLY here, so
// the model would lose them if this were trimmed to a name. Inline marks are
// display syntax, not content, and belong in neither the prompt nor the rail.
// The entry's own name always leads, which is the part provenance shows.
const ENTRY_LABEL_SEPARATOR = " · ";

function entryLabel(entry: ResumeEntry): string {
  return [entry.titleLeft, entry.titleRight, entry.subtitleLeft, entry.subtitleRight]
    .map((value) => compact(stripInlineMarks(value)))
    .filter(Boolean)
    .join(ENTRY_LABEL_SEPARATOR);
}

// The identifying head of an entry label. Provenance answers "which entry did
// this come from", so it wants the name, not the entry's whole serialization.
// Exported beside the label it reads so the separator has one owner.
export function evidenceEntryName(label: string | undefined): string {
  const [name] = stripInlineMarks(label ?? "").split(ENTRY_LABEL_SEPARATOR);
  return name?.trim() ?? "";
}

function pushEvidence(
  items: CoverLetterEvidenceItem[],
  occurrences: Map<string, number>,
  item: Omit<CoverLetterEvidenceItem, "id">
): void {
  const text = item.text.trim();
  if (!text) return;
  const context = [item.section, item.entry].filter(Boolean).join("\u0000");
  items.push({
    id: stableEvidenceId(item.source, text, context, occurrences),
    ...item,
    text
  });
}

export function splitHonestContextEvidence(honestContext: string): string[] {
  const lines = honestContext.replace(/\r\n/g, "\n").split("\n");
  const items: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (
      !line ||
      /^[A-Za-z][A-Za-z ]{1,40}:$/.test(line) ||
      templateHasUnresolvedSlots(line)
    ) continue;
    items.push(line.replace(/^[-*•]\s+/, "").trim());
  }
  return items.filter(Boolean);
}

export function buildCoverLetterEvidence({
  resumeData,
  honestContext,
  slotAnswers = {},
  slotLabels = {}
}: BuildCoverLetterEvidenceInput): CoverLetterEvidenceItem[] {
  const items: CoverLetterEvidenceItem[] = [];
  const occurrences = new Map<string, number>();

  for (const section of resumeData?.sections ?? []) {
    const sectionLabel = compact(stripInlineMarks(section.heading)) || "Untitled section";
    for (const entry of section.items) {
      const label = entryLabel(entry);
      if (entry.bullets.length > 0) {
        for (const bullet of entry.bullets) {
          pushEvidence(items, occurrences, {
            source: "resume",
            text: bullet.text,
            section: sectionLabel,
            ...(label ? { entry: label } : {})
          });
        }
        continue;
      }
      if (section.type === "skills") {
        const skillsText =
          entry.subtitleLeft.trim() || entry.subtitleRight.trim() || entry.titleLeft.trim();
        const category = compact(stripInlineMarks(entry.titleLeft));
        pushEvidence(items, occurrences, {
          source: "resume",
          text: skillsText,
          section: sectionLabel,
          ...(category && skillsText !== entry.titleLeft.trim() ? { entry: category } : {})
        });
        continue;
      }
      const fieldValues = [
        ["Title", entry.titleLeft],
        ["Title detail", entry.titleRight],
        ["Subtitle", entry.subtitleLeft],
        ["Subtitle detail", entry.subtitleRight]
      ] as const;
      for (const [fieldLabel, text] of fieldValues) {
        pushEvidence(items, occurrences, {
          source: "resume",
          text,
          section: sectionLabel,
          entry: label ? `${label}${ENTRY_LABEL_SEPARATOR}${fieldLabel}` : fieldLabel
        });
      }
    }
  }

  for (const text of splitHonestContextEvidence(honestContext)) {
    pushEvidence(items, occurrences, { source: "honest_context", text });
  }

  for (const [slotId, answer] of Object.entries(slotAnswers)) {
    if (!answer.trim()) continue;
    pushEvidence(items, occurrences, {
      source: "user_answer",
      text: answer,
      section: "Your answers",
      entry: slotLabels[slotId] || slotId
    });
  }

  return items;
}
