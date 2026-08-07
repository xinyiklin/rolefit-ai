import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  automaticResumeStages,
  prepareAutomationDecision
} from "../../hooks/usePrepareAutomation.ts";

assert.equal(automaticResumeStages("tailor"), "tailor", "Tailor-only remains Tailor-only for automatic Resume polish");
assert.equal(automaticResumeStages("both"), "both", "Tailor plus final audit remains both");
assert.equal(automaticResumeStages("review"), "both", "Review-only is upgraded so automatic Resume never skips Tailor");

const assessment = {
  verdict: "REASONABLE_FIT",
  confidence: "HIGH",
  summary: "Candidate covers the core requirements.",
  verdictReason: "Direct evidence covers the role.",
  eligibility: { status: "SATISFIED", items: [] },
  requirements: [],
  strengths: [],
  concerns: [],
  recommendation: { action: "APPLY", reason: "Apply." }
};

assert.deepEqual(
  prepareAutomationDecision(
    { assessment },
    "STRETCH",
    "STRONG_FIT"
  ),
  {
    resume: { action: "RUN", reason: "The configured fit threshold was met." },
    coverLetter: { action: "SKIP", reason: "Initial Fit is below the configured threshold." }
  },
  "the two threshold policies evaluate independently against one audit verdict"
);
assert.deepEqual(
  prepareAutomationDecision(
    { assessment: { ...assessment, verdict: "STRONG_FIT" } },
    "OFF",
    "REASONABLE_FIT"
  ),
  {
    resume: { action: "SKIP", reason: "Disabled in Settings." },
    coverLetter: { action: "RUN", reason: "The configured fit threshold was met." }
  },
  "turning Resume automation off never suppresses a qualifying Cover policy"
);

const orchestrationSource = readFileSync(
  new URL("../../hooks/usePrepareAutomation.ts", import.meta.url),
  "utf8"
);
const resumeDispatch = orchestrationSource.indexOf("await runResumeRef.current");
const coverDispatch = orchestrationSource.indexOf("await runCoverLetterRef.current");
assert.ok(resumeDispatch > 0 && coverDispatch > resumeDispatch, "qualified actions run sequentially from one audit decision");
assert.match(
  orchestrationSource.slice(resumeDispatch, coverDispatch),
  /!coverNeedsHandling[\s\S]{0,180}?decision\.coverLetter\.action !== "RUN"[\s\S]{0,180}?currentAuditFingerprintRef\.current !== expectedFingerprint/,
  "Cover dispatch depends on its own decision and current audit, not Resume success"
);
assert.match(
  orchestrationSource,
  /const resumeDecisionKey =[\s\S]{0,180}?`resume:\$\{decision\.resume\.action\}:\$\{decision\.resume\.reason\}`/,
  "Resume policy reevaluation has its own deduplication key"
);
assert.match(
  orchestrationSource,
  /const coverDecisionKey =[\s\S]{0,180}?`cover:\$\{decision\.coverLetter\.action\}:\$\{decision\.coverLetter\.reason\}`/,
  "Cover policy reevaluation has its own deduplication key"
);
assert.doesNotMatch(
  orchestrationSource,
  /const decisionKey =/,
  "changing one policy cannot make the other policy's unchanged RUN decision dispatch again"
);
assert.match(
  orchestrationSource,
  /await activeResumeRun\.promise/,
  "Cover waits for an already-active Resume run without coupling their policy keys"
);

const coverSource = readFileSync(new URL("../../hooks/useCoverLetter.ts", import.meta.url), "utf8");
const proposalCommit = coverSource.slice(
  coverSource.indexOf("setPendingProposal({"),
  coverSource.indexOf("return { status: \"completed\", proposal: result }")
);
assert.doesNotMatch(proposalCommit, /onApplyTailored|applyTailoredText/, "automatic cover generation stages a proposal without silently applying it");
assert.match(coverSource, /fetch\("\/api\/cover-letter"/, "Cover automation uses the dedicated cover-letter workflow");

console.log("prepare automation orchestration probes passed");
