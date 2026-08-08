import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  automaticResumeStages,
  prepareAutomationDecision
} from "../../hooks/usePrepareAutomation.ts";

assert.equal(automaticResumeStages("tailor"), "tailor", "Tailor-only remains Tailor-only for automatic Resume polish");
assert.equal(automaticResumeStages("both"), "both", "Tailor plus final audit remains both");
assert.equal(automaticResumeStages("review"), "both", "Review-only is upgraded so automatic Resume never skips Tailor");

assert.deepEqual(
  prepareAutomationDecision(
    { verdict: "REASONABLE FIT" },
    "STRETCH",
    "STRONG FIT"
  ),
  { resume: true, coverLetter: false },
  "the two threshold policies evaluate independently against one audit verdict"
);
assert.deepEqual(
  prepareAutomationDecision(
    { verdict: "STRONG FIT" },
    "off",
    "REASONABLE FIT"
  ),
  { resume: false, coverLetter: true },
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
  /if \(!decision\.coverLetter \|\| currentAuditFingerprintRef\.current !== expectedFingerprint\) return/,
  "Cover dispatch depends on its own decision and current audit, not Resume success"
);

const coverSource = readFileSync(new URL("../../hooks/useCoverLetter.ts", import.meta.url), "utf8");
const proposalCommit = coverSource.slice(
  coverSource.indexOf("setPendingProposal({"),
  coverSource.indexOf("return { status: \"completed\", proposal: result }")
);
assert.doesNotMatch(proposalCommit, /onApplyTailored|applyTailoredText/, "automatic cover generation stages a proposal without silently applying it");
assert.match(coverSource, /fetch\("\/api\/cover-letter"/, "Cover automation uses the dedicated cover-letter workflow");

console.log("prepare automation orchestration probes passed");
