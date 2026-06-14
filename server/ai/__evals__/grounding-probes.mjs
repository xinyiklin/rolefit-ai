// Offline, deterministic probes for the JD-term grounding gate and the
// strict-review grounding it now drives. No model calls, no network:
//
//   node server/ai/__evals__/grounding-probes.mjs
//
// Locks the 2026-06 anti-fabrication backstops:
// - detector 4 (short tech tokens C#/C++/ML/NLP), incl. sentence-final periods
// - proseMode (cover letter / answers): proper nouns allowed, skills still gated
// - the contract that jobLower/grounding are PRE-LOWERCASED by callers
// - sanitizeStrictReview dropping an ungrounded rewrite / blanking an ungrounded
//   suggestedEdit, while staying backward-compatible with the no-args call
// All fixture text is synthetic. Exit code is non-zero on any failure.

import { findUngroundedJdTerm } from "../grounding.mjs";
import { sanitizeStrictReview } from "../sanitize.mjs";

const f = (proposed, job, grounding, opts) => findUngroundedJdTerm(proposed, job, grounding, opts);

const checks = [
  // --- detector 4: distinctive short tokens detector 1's 3-char floor misses ---
  ["lowercase nlp flagged (detector1 needs a capital)", f("built nlp models", "nlp role", "") === "nlp"],
  ["c++ flagged ungrounded", f("wrote a c++ engine", "c++ required", "") === "c++"],
  ["c# grounded by corpus -> null", f("strong c# work", "c# developer", "expert in c# and dotnet") === null],

  // --- finding-1 regression lock: a sentence-final short token still matches ---
  ["sentence-final 'C#.' flagged (boundary period freed)", f("My strongest language is C#.", "c# required", "") === "c#"],
  ["sentence-final 'ML.' flagged", f("My focus has been ML.", "ml engineer", "") === "ml"],
  // grounding corpus is pre-lowercased by callers (the contract); a sentence-final
  // 'c#.' in it must still ground a bare 'c#' thanks to stripBoundaryDots.
  ["sentence-final corpus token grounds it", f("strong C#.", "c# required", "i use c#. daily") === null],
  ["internal period preserved (node.js not split)", f("ran node.js services", "node.js required", "node.js in prod") === null],

  // --- proseMode: proper nouns allowed, skills still gated (cover/answers) ---
  ["proseMode allows company proper noun", f("excited about Acme platform", "acme corp hiring", "", { proseMode: true }) === null],
  ["non-prose flags the same proper noun", f("excited about Acme platform", "acme corp hiring", "") === "Acme"],
  ["proseMode still flags a tool skill", f("I have Kubernetes experience", "kubernetes required", "", { proseMode: true }) === "kubernetes"],
  ["proseMode still flags a short token", f("strongest in C#", "c# developer", "", { proseMode: true }) === "c#"],
  ["proseMode clean when grounded", f("I have Kubernetes experience", "kubernetes required", "ran kubernetes clusters", { proseMode: true }) === null],

  // --- deliberate exclusion: collision-prone short tokens never flagged ---
  ["bare 'go' is NOT flagged (verb / go-to-market collision)", f("our go-to-market plan", "go developer wanted", "", { proseMode: true }) === null],

  // --- sanitizeStrictReview grounding (resume-field rewrites) ---
  ["ungrounded rewrite is dropped, grounded kept", (() => {
    const out = sanitizeStrictReview(
      { verdict: "STRETCH", rewrites: [
        { original: "Built APIs", rewrite: "Built Kubernetes-orchestrated APIs" },
        { original: "Led team", rewrite: "Led a 3-person engineering team" }
      ] },
      "kubernetes required",
      "Built REST APIs in Python. Led a 3-person team."
    );
    return out.rewrites.length === 1 && /3-person/.test(out.rewrites[0].rewrite);
  })()],
  ["ungrounded suggestedEdit is blanked, gap stays", (() => {
    const out = sanitizeStrictReview(
      { verdict: "STRETCH", gaps: [
        { gap: "No Terraform", severity: "HIGH", evidenceType: "none", suggestedEdit: "Provisioned infra with Terraform" }
      ] },
      "terraform required",
      "Shipped Python services."
    );
    return out.gaps.length === 1 && out.gaps[0].suggestedEdit === "";
  })()],
  ["backward-compatible: no job/grounding -> no grounding drops", (() => {
    const out = sanitizeStrictReview({ verdict: "STRETCH", rewrites: [
      { original: "a", rewrite: "Built Kubernetes things" },
      { original: "b", rewrite: "Led a team" }
    ] });
    return out.rewrites.length === 2;
  })()]
];

let failures = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures++;
}
console.log(`\n${checks.length - failures}/${checks.length} probes passed.`);
process.exit(failures ? 1 : 0);
