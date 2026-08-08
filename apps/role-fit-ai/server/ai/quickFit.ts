import {
  QUICK_FIT_BASIS_COVERAGE,
  QUICK_FIT_BASIS_IMPORTANCE,
  QUICK_FIT_EVIDENCE_SOURCES,
  quickFitRequirementIsEmploymentEligibility,
  selectQuickFitRequirements,
  type QuickFitBasisCoverage,
  type QuickFitBasisImportance,
  type QuickFitBasisItem,
  type QuickFitEligibilityStatus,
  type QuickFitEvidenceSource,
  type QuickFitRequirementCandidate,
  type QuickFitResult,
  type QuickFitVerdict
} from "../../shared/quickFitContract.ts";
import { callConfiguredProvider } from "./clients.ts";
import {
  LIST_STOPWORDS,
  distinctiveTokenKeys,
  findUngroundedCuratedClaimTerm
} from "./grounding.ts";
import { clipForPrompt, fenceUntrusted, inputFirewallRule } from "./prompts.ts";
import { resolveProviderRequest } from "./providers.ts";

const RESUME_CHAR_LIMIT = 28_000;
const JOB_CHAR_LIMIT = 24_000;
const MAX_BASIS_ITEMS = 6;
const MAX_REQUIRED_REQUIREMENTS = 5;

const basisImportance = new Set<string>(QUICK_FIT_BASIS_IMPORTANCE);
const basisCoverage = new Set<string>(QUICK_FIT_BASIS_COVERAGE);
const evidenceSources = new Set<string>(QUICK_FIT_EVIDENCE_SOURCES);

export const QUICK_FIT_BASIS_RESPONSE_SCHEMA = `{
  "basis": [
    {
      "requirementId": "server-selected requirement id, or omitted only for one provider-added material requirement",
      "sourceRequirement": "exact requirement excerpt from the posting",
      "importance": "CORE | SUPPORTING",
      "coverage": "DIRECT | ADJACENT | NOT_SHOWN | CONTRADICTED",
      "evidenceSource": "RESUME | CANDIDATE_CONTEXT (required except for NOT_SHOWN)",
      "evidenceExcerpt": "exact excerpt from that candidate source (required except for NOT_SHOWN)"
    }
  ]
}`;

function text(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizedExcerpt(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function sourceIncludesExcerpt(source: string, excerpt: string): boolean {
  const normalized = normalizedExcerpt(excerpt);
  return normalized.length >= 2 && normalizedExcerpt(source).includes(normalized);
}

function sanitizeRequiredRequirements(raw: unknown, jobText: string): QuickFitRequirementCandidate[] {
  if (!Array.isArray(raw)) return [];
  const result: QuickFitRequirementCandidate[] = [];
  const seenIds = new Set<string>();
  const seenRequirements = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const source = item as Record<string, unknown>;
    const requirementId = text(source.requirementId, 40);
    const sourceRequirement = text(source.sourceRequirement, 500);
    const requirementKey = normalizedExcerpt(sourceRequirement);
    const importance = text(source.importance, 24).toUpperCase();
    const kind = text(source.kind, 24).toUpperCase() || "QUALIFICATION";
    if (
      !/^(?:candidate|required)-[1-9][0-9]?$/.test(requirementId)
      || seenIds.has(requirementId)
      || seenRequirements.has(requirementKey)
      || !sourceIncludesExcerpt(jobText, sourceRequirement)
      || quickFitRequirementIsEmploymentEligibility(sourceRequirement)
      || !basisImportance.has(importance)
      || (kind !== "QUALIFICATION" && kind !== "RESPONSIBILITY")
    ) continue;
    seenIds.add(requirementId);
    seenRequirements.add(requirementKey);
    result.push({
      requirementId,
      sourceRequirement,
      kind: kind as QuickFitRequirementCandidate["kind"],
      importance: postingImportance(sourceRequirement, jobText)
        ?? importance as QuickFitBasisImportance
    });
    if (result.length === 12) break;
  }
  return selectQuickFitRequirements(result).slice(0, MAX_REQUIRED_REQUIREMENTS);
}

function postingImportance(requirement: string, jobText: string): QuickFitBasisImportance | null {
  if (/\b(?:required|must|minimum|mandatory|at least)\b/i.test(requirement)) return "CORE";
  if (/\b(?:preferred|nice[- ]to[- ]have|bonus|ideally|a plus)\b/i.test(requirement)) return "SUPPORTING";

  const requirementKey = normalizedExcerpt(requirement);
  let section: "preferred" | "core" | null = null;
  for (const rawLine of jobText.split(/\r?\n/)) {
    const line = text(rawLine, 700);
    if (!line) continue;
    if (/^(?:preferred|desired|nice[- ]to[- ]have|bonus)(?:\s+(?:qualifications?|skills?|experience))?\s*:?$/i.test(line)) {
      section = "preferred";
      continue;
    }
    if (/^(?:(?:required|minimum|basic|mandatory)\s+)?(?:requirements?|qualifications?|responsibilities|what you(?:['\u2018\u2019])?ll do)\s*:?$/i.test(line)) {
      section = "core";
      continue;
    }
    const lineKey = normalizedExcerpt(line);
    if (!lineKey.includes(requirementKey)) continue;
    if (/\b(?:required|must|minimum|mandatory|at least)\b/i.test(line)) return "CORE";
    if (/\b(?:preferred|nice[- ]to[- ]have|bonus|ideally|a plus)\b/i.test(line)) return "SUPPORTING";
    return section === "preferred" ? "SUPPORTING" : section === "core" ? "CORE" : null;
  }
  return null;
}

const SMALL_NUMBERS: Readonly<Record<string, number>> = Object.freeze({
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20
});

function numberValue(raw: string): number | null {
  if (/^\d+$/.test(raw)) return Number(raw);
  return SMALL_NUMBERS[raw.toLowerCase()] ?? null;
}

function statedYears(value: string): number[] {
  const result: number[] = [];
  const number = "(\\d{1,2}|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)";
  let remaining = value;
  const consume = (pattern: RegExp, capture = 1) => {
    remaining = remaining.replace(pattern, (...args: unknown[]) => {
      const parsed = numberValue(String(args[capture] ?? ""));
      if (parsed !== null) result.push(parsed);
      return " ".repeat(String(args[0] ?? "").length);
    });
  };
  // A range states its lower bound. Consume it before the generic form so
  // "3-5 years" cannot be silently upgraded to five.
  consume(new RegExp(`\\b${number}\\s*(?:-|\\u2013|\\u2014|to|through)\\s*${number}\\s+years?\\b`, "gi"));
  consume(new RegExp(`\\b${number}\\s+(?:or\\s+(?:more|greater)|and\\s+above)\\s+years?\\b`, "gi"));
  consume(new RegExp(`\\b${number}\\s+years?\\s+or\\s+(?:more|greater)\\b`, "gi"));
  consume(new RegExp(`\\b${number}\\s*(?:\\+|plus)?\\s+years?\\b`, "gi"));
  return result;
}

function hasYearsMismatch(requirement: string, evidence: string): boolean {
  const required = statedYears(requirement);
  const candidate = statedYears(evidence);
  return required.length > 0
    && candidate.length > 0
    && Math.max(...candidate) < Math.max(...required);
}

function degreeRank(value: string): number {
  if (/\b(?:doctorate|doctoral|ph\.?d)\b/i.test(value)) return 5;
  if (/\bmaster(?:'s|s)?\b|\bmba\b|\bm\.s\.(?=\s|$)|\bms\b(?=\s+(?:degree|in\b))/i.test(value)) return 4;
  if (/\bbachelor(?:'s|s)?\b|\bb\.[sa]\.(?=\s|$)|\b(?:bs|ba)\b(?=\s+(?:degree|in\b))/i.test(value)) return 3;
  if (/\bassociate(?:'s|s)?\b/i.test(value)) return 2;
  if (/\bhigh school\b|\bged\b/i.test(value)) return 1;
  return 0;
}

function isExplicitContradiction(requirement: string, evidence: string): boolean {
  if (hasYearsMismatch(requirement, evidence)) return true;

  const requiredDegree = degreeRank(requirement);
  const candidateDegree = degreeRank(evidence);
  if (requiredDegree > 0 && candidateDegree > 0 && candidateDegree < requiredDegree) return true;

  const requirementLower = normalizedExcerpt(requirement);
  const evidenceLower = normalizedExcerpt(evidence);
  const sponsorshipDisallowed = /\b(?:no|without)\s+(?:visa\s+)?sponsorship\b|\b(?:visa\s+)?sponsorship\b[^.]{0,30}\b(?:not available|unavailable|not offered|not provided)\b|\b(?:cannot|can't|will not|won't|do not|does not)\s+sponsor\b|\b(?:cannot|can't|unable to|will not|won't|do not|does not)\s+(?:provide|offer|support)\b[^.]{0,40}\bsponsor/i.test(requirementLower);
  const sponsorshipRequired = !/\b(?:does not|do not|will not|won't|no need to)\s+(?:require|need)\b[^.]{0,30}\bsponsor/i.test(evidenceLower)
    && /\b(?:will\s+)?(?:require|requires|required|need|needs)\b[^.]{0,45}\b(?:visa\s+)?sponsorship\b/i.test(evidenceLower);
  if (sponsorshipDisallowed && sponsorshipRequired) return true;

  const citizenshipRequired = /\b(?:u\.?s\.?|united states)\s+citizens?(?:hip)?\b/i.test(requirementLower)
    && /\b(?:required|must|only|mandatory)\b/i.test(requirementLower);
  if (citizenshipRequired && /\b(?:foreign national|not (?:a )?(?:u\.?s\.?|united states) citizen|permanent resident)\b/i.test(evidenceLower)) return true;

  const workAuthorizationRequired = /\b(?:authoriz|authoris)\w* to work\b/i.test(requirementLower)
    && /\b(?:required|must|need)\b/i.test(requirementLower);
  if (workAuthorizationRequired && /\bnot (?:currently )?(?:authoriz|authoris)\w* to work\b/i.test(evidenceLower)) return true;

  const clearanceRequired = /\b(?:clearance|ts\/sci|polygraph)\b/i.test(requirementLower)
    && /\b(?:required|must|active|current|possess|hold)\b/i.test(requirementLower);
  if (clearanceRequired && /\b(?:no|without|lack\w*|do not have|does not have|not active|expired)\b[^.]{0,45}\b(?:clearance|ts\/sci|polygraph)\b/i.test(evidenceLower)) return true;

  const licenseRequired = /\b(?:license|licence|certification)\b/i.test(requirementLower)
    && /\b(?:required|must|active|current|valid)\b/i.test(requirementLower);
  return licenseRequired
    && /\b(?:no|without|lack\w*|do not have|does not have|not active|expired)\b[^.]{0,45}\b(?:license|licence|certification)\b/i.test(evidenceLower);
}

const RELATION_STOPWORDS = new Set([
  ...LIST_STOPWORDS,
  "build", "built", "building", "develop", "developed", "developing",
  "design", "designed", "maintain", "maintained", "manage", "managed",
  "partner", "partnered", "support", "supported", "deliver", "delivered",
  "responsible", "responsibility", "knowledge", "proficiency", "industry",
  "system", "systems", "platform", "platforms", "environment", "environments",
  "workflow", "workflows"
]);

function splitRequirementAlternatives(requirement: string): string[] {
  const normalized = requirement.replace(/\beither\s+/i, "").trim();
  // Numeric thresholds use "or" grammatically, not as interchangeable skills.
  if (/\b(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+(?:years?\s+)?or\s+(?:more|less|greater|fewer)\b/i.test(normalized)) {
    return [requirement];
  }

  // Education equivalency is a real alternative, but it must not inherit the
  // degree prefix ("Bachelor degree equivalent experience" is nonsense).
  const educationAlternative = normalized.match(/^(.*?\b(?:degree|bachelor(?:'s|s)?|master(?:'s|s)?|doctorate|ph\.?d)\b.*?)\s+or\s+((?:an?\s+)?equivalent(?:\s+professional)?\s+experience.*?)$/i);
  if (educationAlternative) {
    return [educationAlternative[1].trim(), educationAlternative[2].trim()];
  }

  const prefixMatch = normalized.match(/^(.*?\b(?:with|using|in|of|for)\s+)(.+)$/i);
  const prefix = prefixMatch?.[1] ?? "";
  const alternativesText = prefixMatch?.[2] ?? normalized;
  const hasAlternativeJoin = /\s+(?:or|and\/or)\s+/i.test(alternativesText)
    || /,\s*(?:or|and\/or)\s+/i.test(alternativesText);
  if (!hasAlternativeJoin) return [requirement];
  const alternatives = alternativesText
    .split(/\s*,\s*(?:(?:or|and\/or)\s+)?|\s+(?:or|and\/or)\s+/i)
    .map((value) => value.trim())
    .filter(Boolean);
  if (alternatives.length <= 1) return [requirement];
  return alternatives.map((alternative) => prefix ? `${prefix}${alternative}` : alternative);
}

function relationCoverageForOne(requirement: string, evidence: string): QuickFitBasisCoverage {
  if (isExplicitContradiction(requirement, evidence)) return "CONTRADICTED";
  if (/\bequivalent\s+(?:professional\s+)?experience\b/i.test(requirement)
    && /\b(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:\+|plus)?\s+years?\b[^.]{0,80}\bexperience\b/i.test(evidence)) {
    return "DIRECT";
  }
  const requiredDegree = degreeRank(requirement);
  const evidenceDegree = degreeRank(evidence);
  if (requiredDegree > 0 && evidenceDegree >= requiredDegree) {
    const educationStopwords = new Set([
      ...RELATION_STOPWORDS,
      "required", "degree", "degrees", "bachelor", "bachelors", "master", "masters",
      "doctorate", "doctoral", "associate", "education"
    ]);
    const fields = distinctiveTokenKeys(requirement, educationStopwords);
    const evidenceTokens = new Set(distinctiveTokenKeys(evidence, educationStopwords));
    if (fields.length === 0 || fields.some((field) => evidenceTokens.has(field))) return "DIRECT";
  }
  const requirementTokens = distinctiveTokenKeys(requirement, RELATION_STOPWORDS);
  const evidenceTokens = new Set(distinctiveTokenKeys(evidence, RELATION_STOPWORDS));
  const overlap = requirementTokens.filter((token) => evidenceTokens.has(token)).length;
  const adjacent = requirementTokens.length > 0
    && overlap > 0
    && overlap >= Math.min(2, requirementTokens.length);
  if (!adjacent) return "NOT_SHOWN";

  const requiredYears = statedYears(requirement);
  const evidenceYears = statedYears(evidence);
  const yearsSatisfied = requiredYears.length === 0
    || (evidenceYears.length > 0 && Math.max(...evidenceYears) >= Math.max(...requiredYears));
  const requiresEducation = /\b(?:degree|bachelor|master|doctorate|doctoral|ph\.?d|associate)\b/i.test(requirement);
  const showsEducation = /\b(?:degree|bachelor|master|doctorate|doctoral|ph\.?d|associate|mba)\b|\b(?:b\.[sa]\.|m\.s\.)(?=\s|$)|\b(?:bs|ba|ms)\b(?=\s+(?:degree|in\b))/i.test(evidence);
  const curatedSkillMissing = Boolean(findUngroundedCuratedClaimTerm(requirement, evidence));
  const directOverlap = requirementTokens.length > 0
    && overlap >= Math.min(2, requirementTokens.length)
    && overlap * 5 >= requirementTokens.length * 3;
  return directOverlap
    && yearsSatisfied
    && (!requiresEducation || showsEducation)
    && !curatedSkillMissing
      ? "DIRECT"
      : "ADJACENT";
}

function relationCoverageCap(requirement: string, evidence: string): QuickFitBasisCoverage {
  const alternatives = splitRequirementAlternatives(requirement);
  if (alternatives.length === 1) return relationCoverageForOne(requirement, evidence);
  const coverage = alternatives.map((alternative) => relationCoverageForOne(alternative, evidence));
  if (coverage.includes("DIRECT")) return "DIRECT";
  if (coverage.includes("ADJACENT")) return "ADJACENT";
  if (coverage.every((value) => value === "CONTRADICTED")) return "CONTRADICTED";
  return "NOT_SHOWN";
}

function sanitizeQuickFitBasis(raw: unknown, sources: QuickFitSources): {
  basis: QuickFitBasisItem[];
  validRequiredCount: number;
  requiredCount: number;
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { basis: [], validRequiredCount: 0, requiredCount: 0 };
  }
  const rawBasis = (raw as Record<string, unknown>).basis;
  if (!Array.isArray(rawBasis)) return { basis: [], validRequiredCount: 0, requiredCount: 0 };

  const requiredRequirements = sanitizeRequiredRequirements(sources.requiredRequirements, sources.jobText);
  const requiredById = new Map(requiredRequirements.map((item) => [item.requirementId, item]));
  const requiredItems = new Map<string, QuickFitBasisItem>();
  const validRequiredIds = new Set<string>();
  const seenRequirements = new Set(requiredRequirements.map((item) => normalizedExcerpt(item.sourceRequirement)));
  const extras: QuickFitBasisItem[] = [];
  for (const rawItem of rawBasis.slice(0, MAX_BASIS_ITEMS * 2)) {
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) continue;
    const source = rawItem as Record<string, unknown>;
    const requirementId = text(source.requirementId, 40);
    const requiredRequirement = requirementId ? requiredById.get(requirementId) : undefined;
    if (requirementId && !requiredRequirement) continue;
    if (requiredRequirement && requiredItems.has(requirementId)) continue;
    const sourceRequirement = requiredRequirement?.sourceRequirement ?? text(source.sourceRequirement, 500);
    const requirementKey = normalizedExcerpt(sourceRequirement);
    const rawImportance = text(source.importance, 24).toUpperCase();
    const rawCoverage = text(source.coverage, 24).toUpperCase();
    if (
      !sourceRequirement
      || (!requiredRequirement && seenRequirements.has(requirementKey))
      || !sourceIncludesExcerpt(sources.jobText, sourceRequirement)
      || quickFitRequirementIsEmploymentEligibility(sourceRequirement)
      || !basisImportance.has(rawImportance)
      || !basisCoverage.has(rawCoverage)
    ) continue;

    const importance = requiredRequirement?.importance
      ?? postingImportance(sourceRequirement, sources.jobText)
      ?? rawImportance as QuickFitBasisImportance;
    let coverage = rawCoverage as QuickFitBasisCoverage;
    let validAssessment = coverage === "NOT_SHOWN";
    let evidenceSource: QuickFitEvidenceSource | undefined;
    let evidenceExcerpt: string | undefined;

    if (coverage !== "NOT_SHOWN") {
      const rawEvidenceSource = text(source.evidenceSource, 32).toUpperCase();
      const rawEvidenceExcerpt = text(source.evidenceExcerpt, 500);
      const evidenceCorpus = rawEvidenceSource === "RESUME"
        ? sources.resumeText
        : rawEvidenceSource === "CANDIDATE_CONTEXT"
          ? sources.candidateContext ?? ""
          : "";
      if (
        evidenceSources.has(rawEvidenceSource)
        && rawEvidenceExcerpt
        && sourceIncludesExcerpt(evidenceCorpus, rawEvidenceExcerpt)
      ) {
        validAssessment = true;
        evidenceSource = rawEvidenceSource as QuickFitEvidenceSource;
        evidenceExcerpt = rawEvidenceExcerpt;
        const cap = relationCoverageCap(sourceRequirement, rawEvidenceExcerpt);
        if (cap === "CONTRADICTED") coverage = "CONTRADICTED";
        else if (coverage === "CONTRADICTED") coverage = "NOT_SHOWN";
        else if (coverage === "DIRECT" && cap !== "DIRECT") coverage = cap;
        else if (coverage === "ADJACENT" && cap === "NOT_SHOWN") coverage = "NOT_SHOWN";
      } else {
        coverage = "NOT_SHOWN";
      }
    }

    if (!requiredRequirement) seenRequirements.add(requirementKey);
    const item: QuickFitBasisItem = {
      ...(requiredRequirement ? { requirementId } : {}),
      sourceRequirement,
      importance,
      coverage,
      ...(coverage !== "NOT_SHOWN" && evidenceSource && evidenceExcerpt
        ? { evidenceSource, evidenceExcerpt }
        : {})
    };
    if (requiredRequirement) {
      requiredItems.set(requirementId, item);
      if (validAssessment) validRequiredIds.add(requirementId);
    }
    else if (extras.length < (requiredRequirements.length ? 1 : MAX_BASIS_ITEMS)) extras.push(item);
  }
  return {
    basis: [
      ...requiredRequirements.map((requirement) => requiredItems.get(requirement.requirementId) ?? {
        requirementId: requirement.requirementId,
        sourceRequirement: requirement.sourceRequirement,
        importance: requirement.importance,
        coverage: "NOT_SHOWN" as const
      }),
      ...extras
    ].slice(0, MAX_BASIS_ITEMS),
    validRequiredCount: validRequiredIds.size,
    requiredCount: requiredRequirements.length
  };
}

type EligibilityCondition = "citizenship" | "sponsorship" | "work-authorization" | "clearance" | "license";
type CandidateConditionState = "satisfied" | "adverse" | "ambiguous" | "unknown";

function postingEligibilityConditions(jobText: string): EligibilityCondition[] {
  const conditions: EligibilityCondition[] = [];
  if (
    /\b(?:u\.?s\.?|united states)\s+citizens?(?:hip)?\b[^.\n]{0,60}\b(?:required|must|only|mandatory)\b/i.test(jobText)
    || /\b(?:required|must|only|mandatory)\b[^.\n]{0,60}\b(?:u\.?s\.?|united states)\s+citizens?(?:hip)?\b/i.test(jobText)
  ) conditions.push("citizenship");
  if (
    /\b(?:no|without)\s+(?:visa\s+)?sponsorship\b/i.test(jobText)
    || /\b(?:visa\s+)?sponsorship\b[^.\n]{0,30}\b(?:not available|unavailable|not offered|not provided)\b/i.test(jobText)
    || /\b(?:cannot|can't|will not|won't|do not|does not)\s+sponsor\b/i.test(jobText)
    || /\b(?:cannot|can't|unable to|will not|won't|do not|does not)\s+(?:provide|offer|support)\b[^.\n]{0,40}\bsponsor/i.test(jobText)
  ) conditions.push("sponsorship");
  if (
    /\b(?:authoriz|authoris)\w* to work\b[^.\n]{0,50}\b(?:required|must|need)\b/i.test(jobText)
    || /\b(?:required|must|need)\b[^.\n]{0,50}\b(?:authoriz|authoris)\w* to work\b/i.test(jobText)
  ) conditions.push("work-authorization");
  if (
    /\b(?:clearance|ts\/sci|polygraph)\b[^.\n]{0,50}\b(?:required|must|active|current|possess|hold)\b/i.test(jobText)
    || /\b(?:required|must|possess|hold)\b[^.\n]{0,50}\b(?:clearance|ts\/sci|polygraph)\b/i.test(jobText)
  ) conditions.push("clearance");
  if (
    /\b(?:license|licence|certification)\b[^.\n]{0,50}\b(?:required|must|active|current|valid)\b/i.test(jobText)
    || /\b(?:required|must|possess|hold)\b[^.\n]{0,50}\b(?:license|licence|certification)\b/i.test(jobText)
  ) conditions.push("license");
  return conditions;
}

function candidateConditionState(condition: EligibilityCondition, candidateContext: string): CandidateConditionState {
  const context = candidateContext;
  if (condition === "citizenship") {
    const adverse = /\b(?:foreign national|not (?:a )?(?:u\.?s\.?|united states) citizen|permanent resident)\b/i.test(context);
    const satisfied = /\bcitizenship:\s*(?:u\.?s\.?|united states) citizen\b|\b(?:am|is) (?:a )?(?:u\.?s\.?|united states) citizen\b/i.test(context);
    return adverse && satisfied ? "ambiguous" : adverse ? "adverse" : satisfied ? "satisfied" : "unknown";
  }
  if (condition === "sponsorship") {
    const satisfied = /\b(?:does not|do not|will not|won't)\s+(?:require|need)\b[^.\n]{0,35}\b(?:visa\s+)?sponsorship\b|\bno need for\b[^.\n]{0,20}\bsponsorship\b/i.test(context);
    const ambiguous = /\b(?:may|might|could)\b[^.\n]{0,35}\b(?:need|require)\b[^.\n]{0,25}\bsponsorship\b|\bsponsorship\b[^.\n]{0,20}\b(?:may|might|could)\b/i.test(context);
    const adverse = !satisfied && /\b(?:will\s+)?(?:require|requires|required|need|needs)\b[^.\n]{0,45}\b(?:visa\s+)?sponsorship\b/i.test(context);
    return adverse ? "adverse" : ambiguous ? "ambiguous" : satisfied ? "satisfied" : "unknown";
  }
  if (condition === "work-authorization") {
    const adverse = /\bnot (?:currently )?(?:authoriz|authoris)\w* to work\b/i.test(context);
    const satisfied = !adverse && /\b(?:legally )?(?:authoriz|authoris)\w* to work\b/i.test(context);
    return adverse ? "adverse" : satisfied ? "satisfied" : "unknown";
  }
  if (condition === "clearance") {
    const adverse = /\b(?:no|without|lack\w*|do not have|does not have|not active|expired)\b[^.\n]{0,45}\b(?:clearance|ts\/sci|polygraph)\b/i.test(context);
    const satisfied = !adverse && /\b(?:active|current|hold|possess)\b[^.\n]{0,35}\b(?:clearance|ts\/sci|polygraph)\b/i.test(context);
    return adverse ? "adverse" : satisfied ? "satisfied" : "unknown";
  }
  const adverse = /\b(?:no|without|lack\w*|do not have|does not have|not active|expired)\b[^.\n]{0,45}\b(?:license|licence|certification)\b/i.test(context);
  const satisfied = !adverse && /\b(?:active|current|valid|hold|possess)\b[^.\n]{0,35}\b(?:license|licence|certification)\b/i.test(context);
  return adverse ? "adverse" : satisfied ? "satisfied" : "unknown";
}

const ELIGIBILITY_NOTES: Readonly<Record<EligibilityCondition, string>> = Object.freeze({
  citizenship: "Confirm the posting's U.S. citizenship requirement.",
  sponsorship: "Confirm the posting's visa sponsorship restriction.",
  "work-authorization": "Confirm the posting's work-authorization requirement.",
  clearance: "Confirm the posting's clearance requirement.",
  license: "Confirm the posting's license or certification requirement."
});

function deriveEligibility(jobText: string, candidateContext: string): QuickFitResult["eligibility"] {
  const conditions = postingEligibilityConditions(jobText);
  if (!conditions.length) {
    const sponsorshipState = candidateConditionState("sponsorship", candidateContext);
    const authorizationState = candidateConditionState("work-authorization", candidateContext);
    if (sponsorshipState === "adverse" || sponsorshipState === "ambiguous") {
      return { status: "CHECK", note: "Confirm visa sponsorship needs for this role." };
    }
    if (authorizationState === "adverse" || authorizationState === "ambiguous") {
      return { status: "CHECK", note: "Confirm work authorization for this role." };
    }
    return undefined;
  }

  let status: QuickFitEligibilityStatus = "CLEAR";
  let note = ELIGIBILITY_NOTES[conditions[0]];
  for (const condition of conditions) {
    const state = candidateConditionState(condition, candidateContext);
    if (state === "adverse") return { status: "BLOCKED", note: ELIGIBILITY_NOTES[condition] };
    if (state === "unknown" || state === "ambiguous") {
      status = "CHECK";
      note = ELIGIBILITY_NOTES[condition];
    }
  }
  return { status, note };
}

function deriveVerdict(core: QuickFitBasisItem[]): QuickFitVerdict {
  const direct = core.filter((item) => item.coverage === "DIRECT").length;
  const adjacent = core.filter((item) => item.coverage === "ADJACENT").length;
  const notShown = core.filter((item) => item.coverage === "NOT_SHOWN").length;
  const contradicted = core.filter((item) => item.coverage === "CONTRADICTED").length;
  const count = core.length;
  if (count < 3) {
    const overlap = direct + adjacent;
    return overlap === 0 ? "LIMITED" : "STRETCH";
  }
  if (
    contradicted === 0
    && notShown === 0
    && direct / count >= 0.75
    && adjacent <= 1
  ) return "STRONG";
  if (
    contradicted === 0
    && notShown <= 1
    && direct >= Math.ceil(count / 2)
    && direct + adjacent >= Math.ceil((count * 2) / 3)
  ) return "REASONABLE";

  const overlap = direct + adjacent;
  const missing = notShown + contradicted;
  if (overlap === 0 || overlap / count < 1 / 3 || missing / count >= 0.75) return "LIMITED";
  return "STRETCH";
}

const COUNT_WORDS = ["zero", "one", "two", "three", "four", "five", "six"] as const;

function countWord(value: number): string {
  return COUNT_WORDS[value] ?? String(value);
}

function derivedSummary(core: QuickFitBasisItem[]): string {
  const direct = core.filter((item) => item.coverage === "DIRECT").length;
  const adjacent = core.filter((item) => item.coverage === "ADJACENT").length;
  const gap = core.find((item) => item.coverage === "CONTRADICTED")
    ?? core.find((item) => item.coverage === "NOT_SHOWN");
  const requirementLabel = core.length === 1 ? "core requirement" : "core requirements";
  const lead = direct > 0
    ? `Direct evidence covers ${countWord(direct)} of ${countWord(core.length)} ${requirementLabel}`
    : adjacent > 0
      ? `Related evidence covers ${countWord(adjacent)} of ${countWord(core.length)} ${requirementLabel}`
      : `No candidate evidence covers the ${countWord(core.length)} ${requirementLabel} reviewed`;
  if (gap) return text(`${lead}; the main gap is ${text(gap.sourceRequirement, 180)}`, 320);
  if (adjacent > 0) return `${lead}; the remaining coverage is adjacent.`;
  return `${lead}.`;
}

export type QuickFitSources = {
  jobText: string;
  resumeText: string;
  candidateContext?: string;
  requiredRequirements?: QuickFitRequirementCandidate[];
};

export function calibrateQuickFit(raw: unknown, sources: QuickFitSources): QuickFitResult | null {
  const { basis, validRequiredCount, requiredCount } = sanitizeQuickFitBasis(raw, sources);
  if (requiredCount > 0 && validRequiredCount < Math.ceil(requiredCount / 2)) return null;
  const core = basis.filter((item) => item.importance === "CORE");
  if (!core.length) return null;

  const ordered = [...core, ...basis.filter((item) => item.importance === "SUPPORTING")];
  const matches = ordered
    .filter((item) => item.coverage === "DIRECT" || item.coverage === "ADJACENT")
    .map((item) => text(item.sourceRequirement, 220))
    .slice(0, 3);
  const gaps = ordered
    .filter((item) => item.coverage === "NOT_SHOWN" || item.coverage === "CONTRADICTED")
    .map((item) => text(item.sourceRequirement, 220))
    .slice(0, 3);
  const eligibility = deriveEligibility(sources.jobText, sources.candidateContext ?? "");
  return {
    verdict: deriveVerdict(core),
    summary: derivedSummary(core),
    matches,
    gaps,
    ...(eligibility ? { eligibility } : {})
  };
}

export function quickFitPromptSection({
  resumeText,
  resumeLabel,
  candidateContext,
  requiredRequirements,
  jobText
}: {
  resumeText: unknown;
  resumeLabel: unknown;
  candidateContext?: unknown;
  requiredRequirements?: unknown;
  jobText: unknown;
}): string {
  const required = sanitizeRequiredRequirements(requiredRequirements, String(jobText ?? ""));
  const requiredSection = required.length
    ? `\nThe server selected these authoritative assessment requirements from the prepared job. Return exactly one basis row for every requirementId, copying its sourceRequirement exactly. If evidence is absent or uncertain, return NOT_SHOWN. You may add at most one other material requirement without a requirementId.\n\n<required_requirement_candidates>\n${fenceUntrusted(JSON.stringify(required))}\n</required_requirement_candidates>\n`
    : "";
  return `Also produce a compact Initial Fit calibration basis using ONLY the selected resume and candidate context below.

${required.length ? "Assess every server-selected candidate before any optional extra." : `Select at most ${MAX_BASIS_ITEMS} material job requirements, prioritizing mandatory core work before supporting preferences.`}
- requirementId must copy a server-selected id exactly. Omit it only for a provider-added requirement.
- sourceRequirement must be an exact excerpt from the posting.
- CORE means a material required qualification or core responsibility. Preferred, bonus, and nice-to-have qualifications are SUPPORTING unless the posting explicitly makes them mandatory.
- DIRECT means the candidate source explicitly demonstrates the requirement. ADJACENT means exact candidate evidence demonstrates related transferable work. NOT_SHOWN means no candidate evidence was found.
- CONTRADICTED is allowed only for explicit adverse candidate evidence, such as a lower stated years total or an explicit lack of a mandatory qualification. Mere absence is NOT_SHOWN.
- DIRECT, ADJACENT, and CONTRADICTED require evidenceSource plus an exact evidenceExcerpt from that source. NOT_SHOWN returns neither.
- Employment eligibility conditions such as citizenship, sponsorship, work authorization, or clearance do not determine fit and must not be included as basis items. A substantive required license or certification remains part of fit.
- Do not return a verdict, summary, matches, gaps, eligibility result, score, confidence, ledger IDs, or recommendation. The server derives the public result.
${requiredSection}

<selected_resume_label>
${fenceUntrusted(text(resumeLabel, 160))}
</selected_resume_label>

<selected_resume>
${fenceUntrusted(clipForPrompt(resumeText, RESUME_CHAR_LIMIT, "selected resume")) || "No usable resume was provided."}
</selected_resume>

<candidate_context>
${fenceUntrusted(clipForPrompt(candidateContext, 4_000, "candidate context")) || "Not provided."}
</candidate_context>`;
}

export function buildQuickFitPrompts({
  jobText,
  resumeText,
  resumeLabel,
  candidateContext,
  requiredRequirements
}: {
  jobText: unknown;
  resumeText: unknown;
  resumeLabel: unknown;
  candidateContext?: unknown;
  requiredRequirements?: unknown;
}) {
  const systemPrompt = `You are a careful resume-to-job screening assistant. Return exactly one JSON object and no markdown.

${inputFirewallRule()}

Use only explicit evidence from the posting, selected resume, and candidate context. Never invent skills, experience, eligibility, employers, dates, metrics, tools, outcomes, requirements, or evidence excerpts.`;
  const userPrompt = `Screen the posting against the selected resume.

<job_description>
${fenceUntrusted(clipForPrompt(jobText, JOB_CHAR_LIMIT, "job posting")) || "Not provided."}
</job_description>

${quickFitPromptSection({ jobText, resumeText, resumeLabel, candidateContext, requiredRequirements })}

Return the Initial Fit calibration basis itself, without an outer key, in this shape:
${QUICK_FIT_BASIS_RESPONSE_SCHEMA}`;
  return { systemPrompt, userPrompt };
}

export async function analyzeQuickFit({
  jobText,
  resumeText,
  resumeLabel,
  candidateContext,
  requiredRequirements,
  body = {},
  signal
}: {
  jobText: string;
  resumeText: string;
  resumeLabel: string;
  candidateContext?: string;
  requiredRequirements?: QuickFitRequirementCandidate[];
  body?: Record<string, unknown>;
  signal?: AbortSignal;
}) {
  const { provider, apiKey, model, reasoningEffort } = resolveProviderRequest(body);
  const { systemPrompt, userPrompt } = buildQuickFitPrompts({
    jobText,
    resumeText,
    resumeLabel,
    candidateContext,
    requiredRequirements
  });
  const parsed = await callConfiguredProvider({
    provider,
    apiKey,
    model,
    reasoningEffort,
    systemPrompt,
    userPrompt,
    signal
  });
  return {
    initialFit: calibrateQuickFit(parsed, { jobText, resumeText, candidateContext, requiredRequirements }),
    provider,
    model,
    reasoningEffort
  };
}
