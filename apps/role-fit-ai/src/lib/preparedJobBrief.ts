import { assembleTailoringText, type ExtractedJobTracking, type TailoringParts } from "./jobExtract.ts";

export type PreparedJobBrief = {
  companyContext: string;
  responsibilities: string[];
  requiredQualifications: string[];
  preferredQualifications: string[];
  techKeywords: string[];
  senioritySignals: string[];
  domainSignals: string[];
  benefits: string[];
};

export type PreparedJobBriefField = keyof PreparedJobBrief;

const EMPTY_BRIEF: PreparedJobBrief = {
  companyContext: "",
  responsibilities: [],
  requiredQualifications: [],
  preferredQualifications: [],
  techKeywords: [],
  senioritySignals: [],
  domainSignals: [],
  benefits: []
};

const TAILORING_SECTION_FIELDS = [
  ["Company / Product Context", "companyContext"],
  ["Core Responsibilities", "responsibilities"],
  ["Required Qualifications", "requiredQualifications"],
  ["Preferred Qualifications", "preferredQualifications"],
  ["Tech Stack / Keywords", "techKeywords"],
  ["Seniority Signals", "senioritySignals"],
  ["Domain Signals", "domainSignals"]
] as const satisfies ReadonlyArray<readonly [string, Exclude<PreparedJobBriefField, "benefits">]>;

const PREPARED_BENEFITS_HEADING = "Benefits";

const PLACEHOLDER = /^\[(?:manual input needed|not specified)[^\]]*\]$|^not specified$/i;

function cleanListItem(value: string): string {
  return value
    .replace(/^\s*(?:[-*•·‣◦▪●○]|(?:\d+)[.)])\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueItems(values: string[], limit = 16): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = cleanListItem(value);
    const key = cleaned.toLowerCase();
    if (!cleaned || PLACEHOLDER.test(cleaned) || seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length >= limit) break;
  }
  return result;
}

function parseTailoringSections(tailoringText: string): Omit<PreparedJobBrief, "benefits"> {
  const lists: Record<Exclude<PreparedJobBriefField, "companyContext" | "benefits">, string[]> = {
    responsibilities: [],
    requiredQualifications: [],
    preferredQualifications: [],
    techKeywords: [],
    senioritySignals: [],
    domainSignals: []
  };
  let companyContext = "";
  let active: Exclude<PreparedJobBriefField, "benefits"> | null = null;

  for (const rawLine of String(tailoringText ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")) {
    const line = rawLine.trim();
    const section = TAILORING_SECTION_FIELDS.find(
      ([heading]) => line.replace(/:\s*$/, "").toLowerCase() === heading.toLowerCase()
    );
    if (section) {
      active = section[1];
      continue;
    }
    if (line.replace(/:\s*$/, "").toLowerCase() === PREPARED_BENEFITS_HEADING.toLowerCase()) {
      active = null;
      continue;
    }
    if (/^Job Title\s*:/i.test(line)) {
      active = null;
      continue;
    }
    if (!active || !line) continue;
    if (active === "companyContext") {
      const cleaned = cleanListItem(line);
      if (!PLACEHOLDER.test(cleaned)) {
        companyContext = [companyContext, cleaned].filter(Boolean).join(" ");
      }
      continue;
    }
    lists[active].push(line);
  }

  return {
    companyContext,
    responsibilities: uniqueItems(lists.responsibilities),
    requiredQualifications: uniqueItems(lists.requiredQualifications),
    preferredQualifications: uniqueItems(lists.preferredQualifications),
    techKeywords: uniqueItems(lists.techKeywords),
    senioritySignals: uniqueItems(lists.senioritySignals),
    domainSignals: uniqueItems(lists.domainSignals)
  };
}

const BENEFITS_HEADING =
  /^(?:benefits?|perks|our benefits|the benefits|what we offer|what['‘’]?s in it for you|what you['‘’]?(?:ll| will) (?:receive|get)|what you get|what we['‘’]?(?:ll| will) bring|compensation (?:and|&) benefits|perks (?:and|&) benefits|total rewards)(?:\s*[:\-–—]\s*(.*))?$/i;

const SECTION_BOUNDARY =
  /^(?:about (?:us|the company|the role|you)|company|job (?:description|overview)|the role|responsibilities|what you['‘’]?(?:ll| will) do|requirements|qualifications|minimum qualifications|basic qualifications|required qualifications|preferred qualifications|skills|experience|compensation|salary|pay range|how to apply|equal opportunity|privacy|accommodations?)\s*:?\s*$/i;

const BENEFIT_CUE =
  /\b(?:health|medical|dental|vision|insurance|401\s*\(?k\)?|retirement|paid time off|pto|vacation|parental leave|family leave|sick leave|wellness|tuition|education assistance|commuter|life insurance|disability|employee assistance|stock options?|equity|home office|professional development)\b/i;

export function extractBenefitsFromPosting(sourceText: string): string[] {
  const lines = String(sourceText ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const sectionItems: string[] = [];
  let collecting = false;

  for (const line of lines) {
    const heading = line.match(BENEFITS_HEADING);
    if (heading) {
      collecting = true;
      if (heading[1]) sectionItems.push(heading[1]);
      continue;
    }
    if (!collecting) continue;
    if (SECTION_BOUNDARY.test(line)) break;
    if (/^(?:equal opportunity|privacy|accommodations?|how to apply)\b/i.test(line)) break;
    sectionItems.push(line);
  }

  const fromSection = uniqueItems(sectionItems, 12);
  if (fromSection.length) return fromSection;

  return uniqueItems(
    lines.filter((line) => BENEFIT_CUE.test(line)),
    12
  );
}

export function buildPreparedJobBrief(tailoringText: string, sourceText = ""): PreparedJobBrief {
  return {
    ...EMPTY_BRIEF,
    ...parseTailoringSections(tailoringText),
    benefits: extractBenefitsFromPosting(sourceText)
  };
}

// Application persistence stores roleDescription separately, while the
// model-facing projection appends it to Company / Product Context. Strip that
// known suffix when reopening so each save/open cycle cannot append it again.
export function removePreparedJobRoleSummary(
  brief: PreparedJobBrief,
  roleDescription: string | undefined
): PreparedJobBrief {
  const context = brief.companyContext.replace(/\s+/g, " ").trim();
  const summary = String(roleDescription ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!context || !summary) return brief;
  const offset = context.length - summary.length;
  if (
    offset < 0 ||
    context.slice(offset).toLowerCase() !== summary.toLowerCase() ||
    (offset > 0 && !/\s/.test(context[offset - 1]))
  ) {
    return brief;
  }
  return {
    ...brief,
    companyContext: context.slice(0, offset).trim()
  };
}

export function preparedJobBriefFieldFromText(
  field: PreparedJobBriefField,
  value: string
): PreparedJobBrief[PreparedJobBriefField] {
  if (field === "companyContext") return value.replace(/\s+/g, " ").trim();
  return uniqueItems(value.split("\n"));
}

export function preparedJobBriefFieldToText(value: PreparedJobBrief[PreparedJobBriefField]): string {
  return Array.isArray(value) ? value.join("\n") : value;
}

export function assemblePreparedJobTailoringText(tracking: ExtractedJobTracking, brief: PreparedJobBrief): string {
  const contextParts = [brief.companyContext, tracking.roleDescription]
    .map((value) =>
      String(value ?? "")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean)
    .filter(
      (value, index, values) =>
        values.findIndex((candidate) => candidate.toLowerCase() === value.toLowerCase()) === index
    );
  const parts: TailoringParts = {
    title: tracking.role || tracking.title || "",
    context: contextParts.join("\n"),
    responsibilities: brief.responsibilities,
    required: brief.requiredQualifications,
    preferred: brief.preferredQualifications,
    tech: brief.techKeywords,
    seniority: brief.senioritySignals,
    domains: brief.domainSignals
  };
  return assembleTailoringText(parts);
}

export function assemblePreparedJobApplicationText(tracking: ExtractedJobTracking, brief: PreparedJobBrief): string {
  const benefits = uniqueItems(brief.benefits);
  const benefitsSection = [
    `${PREPARED_BENEFITS_HEADING}:`,
    ...(benefits.length ? benefits.map((benefit) => `- ${benefit}`) : ["Not specified"])
  ].join("\n");
  return `${assemblePreparedJobTailoringText(tracking, brief)}\n\n${benefitsSection}`;
}

const CANONICAL_MANUAL_REVIEW_FIELDS = [
  [
    "job description",
    (tracking: ExtractedJobTracking, brief: PreparedJobBrief) =>
      assemblePreparedJobTailoringText(tracking, brief).trim().length >= 40 &&
      [brief.responsibilities, brief.requiredQualifications, brief.techKeywords].some((items) =>
        items.some((item) => Boolean(item.trim()))
      )
  ],
  ["role title", (tracking: ExtractedJobTracking) => Boolean(tracking.role?.trim() || tracking.title?.trim())],
  ["company", (tracking: ExtractedJobTracking) => Boolean(tracking.company?.trim())],
  ["location", (tracking: ExtractedJobTracking) => Boolean(tracking.location?.trim())],
  ["job type", (tracking: ExtractedJobTracking) => Boolean(tracking.jobType?.trim())],
  [
    "compensation",
    (tracking: ExtractedJobTracking) => Number.isFinite(tracking.salaryMin) || Number.isFinite(tracking.salaryMax)
  ],
  ["role summary", (tracking: ExtractedJobTracking) => Boolean(tracking.roleDescription?.trim())],
  [
    "responsibilities",
    (_tracking: ExtractedJobTracking, brief: PreparedJobBrief) =>
      brief.responsibilities.some((item) => Boolean(item.trim()))
  ],
  [
    "required qualifications",
    (_tracking: ExtractedJobTracking, brief: PreparedJobBrief) =>
      brief.requiredQualifications.some((item) => Boolean(item.trim()))
  ],
  [
    "tech stack keywords",
    (_tracking: ExtractedJobTracking, brief: PreparedJobBrief) =>
      brief.techKeywords.some((item) => Boolean(item.trim()))
  ],
  [
    "benefits",
    (_tracking: ExtractedJobTracking, brief: PreparedJobBrief) => brief.benefits.some((item) => Boolean(item.trim()))
  ]
] as const satisfies ReadonlyArray<
  readonly [string, (tracking: ExtractedJobTracking, brief: PreparedJobBrief) => boolean]
>;

function normalizeManualReviewField(field: string): string {
  return field.replace(/\s+/g, " ").trim().toLowerCase();
}

export function reconcilePreparedJobManualReviewFields(
  tracking: ExtractedJobTracking,
  brief: PreparedJobBrief,
  previousFields: string[]
): string[] {
  const canonicalFields = new Set<string>(CANONICAL_MANUAL_REVIEW_FIELDS.map(([field]) => field));
  const seenUnknown = new Set<string>();
  const unknownFields = previousFields.filter((field) => {
    const normalized = normalizeManualReviewField(field);
    if (!normalized || canonicalFields.has(normalized) || seenUnknown.has(normalized)) {
      return false;
    }
    seenUnknown.add(normalized);
    return true;
  });
  const missingCanonicalFields = CANONICAL_MANUAL_REVIEW_FIELDS.filter(
    ([, hasValue]) => !hasValue(tracking, brief)
  ).map(([field]) => field);
  return [...unknownFields, ...missingCanonicalFields];
}

export function preparedJobBriefGapLabel(field: PreparedJobBriefField): string | null {
  if (field === "responsibilities") return "responsibilities";
  if (field === "requiredQualifications") return "required qualifications";
  if (field === "techKeywords") return "tech stack keywords";
  if (field === "benefits") return "benefits";
  if (field === "companyContext") return "role summary";
  return null;
}
