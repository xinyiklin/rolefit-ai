import type { ResumeData, ResumeEntry } from "@typeset/engine/lib/resumeData.ts";
import type {
  CoverLetterPreparationValues,
  CoverLetterSourceMode,
  MissingCoverLetterField
} from "./coverLetterPreflight.ts";

export type CoverLetterEvidenceSource = "resume" | "honest_context" | "user_answer";

export type CoverLetterEvidenceItem = {
  id: string;
  source: CoverLetterEvidenceSource;
  text: string;
  section?: string;
  entry?: string;
};

export type EvidenceDecision = {
  evidenceId: string;
  decision: "use" | "skip" | "needs_clarification";
  relevance: "direct" | "supporting" | "weak";
  reason: string;
  targetRequirement?: string;
  question?: string;
  userOverridden?: boolean;
};

export type CoverLetterVoicePlan = {
  formality: "conversational-professional" | "formal" | "direct";
  confidence: "restrained" | "confident";
  sentenceStyle: "direct" | "varied" | "concise";
};

export type CoverLetterPlan = {
  openingAngle: string;
  decisions: EvidenceDecision[];
  voice: CoverLetterVoicePlan;
};

export type CoverLetterPreparation = {
  status: "ready" | "needs_input";
  sourceMode: CoverLetterSourceMode;
  missingFields: MissingCoverLetterField[];
  clarifications: CoverLetterClarificationField[];
  plan: CoverLetterPlan;
  provider?: string;
  model?: string;
  reasoningEffort?: string;
  attempts?: number;
};

export type CoverLetterClarificationField = {
  evidenceId: string;
  label: string;
  reason: string;
  required: true;
};

export type CoverLetterProposalBlock = {
  kind: "date" | "greeting" | "body" | "signoff";
  text: string;
  evidenceIds: string[];
};

export type CoverLetterProposal = {
  status: "ready";
  coverLetterText: string;
  blocks: CoverLetterProposalBlock[];
  changeSummary: string[];
  preservedFromSource: string[];
  warnings: string[];
  readyToSend: true;
  selectedEvidence: CoverLetterEvidenceItem[];
  provider?: string;
  model?: string;
  reasoningEffort?: string;
  attempts?: number;
};

type BuildCoverLetterEvidenceInput = {
  resumeData?: ResumeData | null;
  honestContext: string;
  preparationValues?: CoverLetterPreparationValues;
  clarificationAnswers?: Record<string, string>;
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

function entryLabel(entry: ResumeEntry): string {
  return [entry.titleLeft, entry.titleRight, entry.subtitleLeft, entry.subtitleRight]
    .map(compact)
    .filter(Boolean)
    .join(" · ");
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
    if (!line || /^[A-Za-z][A-Za-z ]{1,40}:$/.test(line)) continue;
    items.push(line.replace(/^[-*•]\s+/, "").trim());
  }
  return items.filter(Boolean);
}

export function buildCoverLetterEvidence({
  resumeData,
  honestContext,
  preparationValues = {},
  clarificationAnswers = {}
}: BuildCoverLetterEvidenceInput): CoverLetterEvidenceItem[] {
  const items: CoverLetterEvidenceItem[] = [];
  const occurrences = new Map<string, number>();

  for (const section of resumeData?.sections ?? []) {
    const sectionLabel = compact(section.heading) || "Untitled section";
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
        const skillsText = entry.subtitleLeft.trim() || entry.subtitleRight.trim() || entry.titleLeft.trim();
        pushEvidence(items, occurrences, {
          source: "resume",
          text: skillsText,
          section: sectionLabel,
          ...(entry.titleLeft.trim() && skillsText !== entry.titleLeft.trim()
            ? { entry: entry.titleLeft.trim() }
            : {})
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
          entry: label ? `${fieldLabel} · ${label}` : fieldLabel
        });
      }
    }
  }

  for (const text of splitHonestContextEvidence(honestContext)) {
    pushEvidence(items, occurrences, { source: "honest_context", text });
  }

  for (const [key, label] of [
    ["why_role", "Why this role"],
    ["lead_experience", "Experience to lead with"]
  ] as const) {
    const text = preparationValues[key]?.trim();
    if (text) {
      pushEvidence(items, occurrences, {
        source: "user_answer",
        text,
        section: "Guided answers",
        entry: label
      });
    }
  }

  for (const [evidenceId, answer] of Object.entries(clarificationAnswers)) {
    if (!answer.trim()) continue;
    pushEvidence(items, occurrences, {
      source: "user_answer",
      text: answer,
      section: "Clarifications",
      entry: `Clarifies ${evidenceId}`
    });
  }

  return items;
}

export function selectedEvidenceForPlan(
  plan: CoverLetterPlan,
  evidence: CoverLetterEvidenceItem[]
): CoverLetterEvidenceItem[] {
  const selectedIds = new Set(
    plan.decisions
      .filter((decision) => decision.decision === "use")
      .map((decision) => decision.evidenceId)
  );
  return evidence.filter((item) => selectedIds.has(item.id));
}

export function clarificationFieldsForPlan(
  plan: CoverLetterPlan,
  evidence: CoverLetterEvidenceItem[]
): CoverLetterClarificationField[] {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  return plan.decisions
    .filter((decision) => decision.decision === "needs_clarification")
    .map((decision) => {
      const item = evidenceById.get(decision.evidenceId);
      return {
        evidenceId: decision.evidenceId,
        label: item?.entry || item?.section || "Clarify this evidence",
        required: true,
        reason: decision.question || decision.reason
      };
    });
}
