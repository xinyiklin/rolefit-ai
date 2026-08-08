// Local, dependency-free scan for the job's LIFESTYLE / LOGISTICAL conditions —
// travel, relocation, on-site/remote expectations, shifts, on-call, overtime,
// physical demands, commute. These are candidate PREFERENCES, not
// qualifications: they must never inflate or deflate the fit verdict (the prompt
// rules enforce that on the AI side). Instead they surface as a "Before you
// apply" advisory so the user can self-select out of a job whose conditions are
// a personal dealbreaker, even when they're a strong skills match.
//
// This is deliberately separate from eligibility BLOCKERS (clearance, license,
// citizenship, work authorization) — those make the candidate unable to do the
// job and legitimately drive the fit verdict to DON'T APPLY. Preferences do not.
//
// Best-effort and conservative: a curated pattern set over the JD text. False
// negatives (a constraint phrased unusually) are acceptable for an advisory; the
// goal is to catch the common, high-impact conditions, not to be exhaustive.

export type JobConstraintKind =
  | "travel"
  | "relocation"
  | "onsite"
  | "shift"
  | "oncall"
  | "overtime"
  | "weekends"
  | "physical"
  | "commute";

export type JobConstraint = {
  kind: JobConstraintKind;
  // Short headline shown in the advisory list.
  label: string;
  // The matched phrase from the JD (trimmed), so the user sees the real wording
  // (e.g. "up to 50% travel") rather than just the category.
  detail: string;
};

type ConstraintRule = {
  kind: JobConstraintKind;
  label: string;
  // Each pattern must have a capture group OR match a phrase; the matched text
  // (group 1 if present, else the whole match) becomes `detail`.
  patterns: RegExp[];
};

// Order matters only for display grouping; each kind reports at most once (its
// first match), so the advisory stays compact.
const RULES: ConstraintRule[] = [
  {
    kind: "travel",
    label: "Travel required",
    patterns: [
      // "travel up to 50%", "up to 25% travel", "50% travel"
      /((?:travel\s+(?:up\s+to\s+)?|up\s+to\s+)\d{1,3}\s*%(?:\s+travel)?)/i,
      /(\d{1,3}\s*%\s+(?:domestic|international|overnight)?\s*travel)/i,
      /(willing(?:ness)?\s+to\s+travel|ability\s+to\s+travel|frequent\s+travel|extensive\s+travel|travel\s+(?:is\s+)?required|requires?\s+travel)/i
    ]
  },
  {
    kind: "relocation",
    label: "Relocation expected",
    patterns: [
      /(relocation\s+(?:is\s+)?(?:required|expected)|must\s+(?:be\s+(?:willing|able)\s+to\s+)?relocate|willing(?:ness)?\s+to\s+relocate|able\s+to\s+relocate)/i
    ]
  },
  {
    kind: "onsite",
    label: "On-site / location policy",
    patterns: [
      /((?:fully\s+)?(?:on[\s-]?site|in[\s-]?office|in[\s-]?person)\s+(?:role|position|required|requirement|\d\s*days?)?)/i,
      /(\d\s*days?\s+(?:per\s+week\s+)?(?:in[\s-]?office|on[\s-]?site|in\s+the\s+office))/i,
      /(must\s+(?:be\s+)?(?:located|reside)\s+in|required\s+to\s+work\s+on[\s-]?site)/i
    ]
  },
  {
    kind: "shift",
    label: "Shift / overnight work",
    patterns: [
      /((?:night|overnight|graveyard|evening|rotating|2nd|3rd|second|third)\s+shifts?|shift\s+work|rotating\s+schedule|variable\s+(?:shifts?|schedule)|swing\s+shift)/i
    ]
  },
  {
    kind: "oncall",
    label: "On-call rotation",
    patterns: [
      /(on[\s-]?call(?:\s+(?:rotation|duties|schedule|support))?|pager\s+(?:duty|rotation)|24\/7\s+(?:support|coverage))/i
    ]
  },
  {
    kind: "weekends",
    label: "Weekend / holiday availability",
    patterns: [
      /((?:weekend|holiday)s?\s+(?:availability|work|shifts?|coverage|required|as\s+needed)|(?:work|available)\s+(?:on\s+)?weekends|including\s+weekends)/i
    ]
  },
  {
    kind: "overtime",
    label: "Overtime / extended hours",
    patterns: [
      /(overtime(?:\s+(?:required|as\s+needed|may\s+be\s+required))?|extended\s+hours|long\s+hours|after[\s-]?hours\s+work)/i
    ]
  },
  {
    kind: "physical",
    label: "Physical demands",
    patterns: [
      /((?:ability\s+to\s+)?lift\s+(?:up\s+to\s+)?\d{1,3}\s*(?:lbs?|pounds|kg)|stand(?:ing)?\s+for\s+(?:long\s+periods|extended)|physically\s+demanding|physical\s+requirements|repetitive\s+(?:motion|lifting))/i
    ]
  },
  {
    kind: "commute",
    label: "Driving / transportation",
    patterns: [
      /(valid\s+driver'?s?\s+licen[sc]e|reliable\s+transportation|own\s+(?:vehicle|car)|must\s+(?:have\s+)?(?:a\s+)?(?:car|vehicle))/i
    ]
  }
];

function cleanDetail(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 120);
}

// Returns the deduped list of lifestyle/logistical constraints found in the JD
// text, at most one entry per kind (first match), in RULES order. Empty when the
// JD imposes none (or no JD is loaded).
export function extractJobConstraints(jobText: string | null | undefined): JobConstraint[] {
  const text = String(jobText ?? "");
  if (text.trim().length < 12) return [];
  const out: JobConstraint[] = [];
  for (const rule of RULES) {
    let matched: string | null = null;
    for (const pattern of rule.patterns) {
      const m = pattern.exec(text);
      if (m) {
        matched = m[1] ?? m[0];
        break;
      }
    }
    if (matched) out.push({ kind: rule.kind, label: rule.label, detail: cleanDetail(matched) });
  }
  return out;
}
