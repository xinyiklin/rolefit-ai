// Offline contracts for typed cover-letter templates, evidence preparation,
// provider dispatch, drafting, and final fail-closed validation.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";

import {
  draftPreparedCoverLetter,
  handleCoverLetter,
  prepareCoverLetter,
} from "../coverLetter.ts";
import {
  parseCoverLetterEvidenceOverrides,
  validateCoverLetterDraftOutput,
  validateCoverLetterPlanForDraft,
  validateCoverLetterPreparationOutput,
} from "../coverLetterContracts.ts";
import {
  buildCoverLetterPreparationPrompts,
  buildPreparedCoverLetterDraftPrompts,
} from "../prompts.ts";
import { buildCoverLetterPreflight } from "../../../src/lib/coverLetterPreflight.ts";

class FakeReq extends EventEmitter {
  constructor(method) {
    super();
    this.method = method;
    this.aborted = false;
  }
}

class FakeRes extends EventEmitter {
  constructor() {
    super();
    this.statusCode = null;
    this.body = null;
    this.writableEnded = false;
    this.destroyed = false;
  }
  writeHead(status) {
    this.statusCode = status;
    return this;
  }
  end(payload) {
    this.body = payload;
    this.writableEnded = true;
    this.emit("finish");
  }
}

async function runHandler(method, body) {
  const req = new FakeReq(method);
  const res = new FakeRes();
  const done = handleCoverLetter(req, res);
  if (method === "POST") {
    queueMicrotask(() => {
      if (body != null) req.emit("data", Buffer.from(body));
      req.emit("end");
    });
  }
  await done;
  return {
    status: res.statusCode,
    payload: res.body ? JSON.parse(res.body) : null,
  };
}

function assertUserSafeError(callback, status, message) {
  assert.throws(callback, (error) => {
    assert.equal(error?.status, status);
    assert.match(error?.message ?? "", message);
    return true;
  });
}

const resolvedContext = {
  candidateName: "Jordan Lee",
  role: "Software Engineer",
  company: "Acme",
  recipientName: "",
  date: "July 28, 2026",
  greeting: "Dear Acme Hiring Team,",
  signoff: "Sincerely,\nJordan Lee",
};
const authoredSentence =
  "I build dependable product software by listening closely to users, reducing ambiguity with teammates, and carrying implementation details through release.";
const sourceText = `[Date]

Dear [Hiring Manager's Name or Hiring Team],

I am applying for the [Exact Position Title] role at [Company]. ${authoredSentence} ${authoredSentence} ${authoredSentence}

I would connect that work to [specific responsibility from the posting] through [relevant project or job]. ${authoredSentence} ${authoredSentence}

Sincerely,
[Your name]`;
const preflight = buildCoverLetterPreflight({
  text: sourceText,
  sourceMode: "authored_letter",
  ...resolvedContext,
});
assert.equal(
  preflight.canPrepare,
  true,
  "authored templates with slots pass server-equivalent preflight",
);
const sourceContext = {
  rawTemplateText: sourceText,
  structuredTemplate: preflight.template.structuredTemplate,
  authoredProse: preflight.template.authoredProse,
  slots: preflight.template.slots,
};
const promptSourceContext = {
  structuredTemplate: sourceContext.structuredTemplate,
  authoredProse: sourceContext.authoredProse,
  slots: sourceContext.slots,
};
const evidence = [
  {
    id: "resume:python",
    source: "resume",
    text: "Built dependable Python services and REST APIs for reporting workflows.",
    section: "Experience",
  },
  {
    id: "context:collaboration",
    source: "honest_context",
    text: "I enjoy close collaboration with product and design partners.",
  },
];
const decisions = [
  {
    evidenceId: evidence[0].id,
    decision: "use",
    relevance: "direct",
    reason: "Directly supports the engineering requirement.",
  },
  {
    evidenceId: evidence[1].id,
    decision: "skip",
    relevance: "supporting",
    reason: "Less specific than the selected delivery evidence.",
  },
];
const slotDecisions = sourceContext.slots.map((slot) => {
  if (slot.resolution.kind === "deterministic") {
    return {
      slotId: slot.id,
      decision: "resolved",
      evidenceIds: [],
      reason: "Resolved from correspondence context.",
    };
  }
  if (slot.resolution.source === "job_context") {
    return {
      slotId: slot.id,
      decision: "use_job_context",
      evidenceIds: [],
      reason: "Use one relevant responsibility from the posting.",
    };
  }
  return {
    slotId: slot.id,
    decision:
      slot.resolution.source === "candidate_evidence"
        ? "use_candidate_evidence"
        : "use_job_and_candidate",
    evidenceIds: [evidence[0].id],
    reason: "Connect the slot to selected verified delivery evidence.",
  };
});
const plan = {
  openingAngle:
    "Connect dependable service delivery to Acme's Software Engineer role.",
  decisions,
  slotDecisions,
  voice: {
    formality: "conversational-professional",
    confidence: "confident",
    sentenceStyle: "direct",
  },
};

const prepared = validateCoverLetterPreparationOutput(
  plan,
  evidence,
  "authored_letter",
  sourceContext,
  false,
);
assert.equal(prepared.status, "ready");
assert.equal(prepared.plan.slotDecisions.length, sourceContext.slots.length);
const skippedEvidenceOverrides = parseCoverLetterEvidenceOverrides(
  [{ evidenceId: evidence[0].id, decision: "skip" }],
  evidence,
);
assert.deepEqual(skippedEvidenceOverrides, [
  { evidenceId: evidence[0].id, decision: "skip" },
]);
assertUserSafeError(
  () =>
    parseCoverLetterEvidenceOverrides(
      [{ evidenceId: "resume:unknown", decision: "skip" }],
      evidence,
    ),
  400,
  /known evidence/,
);
assertUserSafeError(
  () =>
    validateCoverLetterPreparationOutput(
      plan,
      evidence,
      "authored_letter",
      sourceContext,
      false,
      skippedEvidenceOverrides,
    ),
  502,
  /candidate evidence override/,
);
const skipHonoringPlan = validateCoverLetterPreparationOutput(
  {
    ...plan,
    decisions: plan.decisions.map((decision) =>
      decision.evidenceId === evidence[0].id
        ? { ...decision, decision: "skip" }
        : { ...decision, decision: "use", relevance: "direct" },
    ),
    slotDecisions: plan.slotDecisions.map((decision) =>
      decision.evidenceIds.includes(evidence[0].id)
        ? { ...decision, evidenceIds: [evidence[1].id] }
        : decision,
    ),
  },
  evidence,
  "authored_letter",
  sourceContext,
  false,
  skippedEvidenceOverrides,
);
assert.equal(skipHonoringPlan.plan.decisions[0].decision, "skip");
assert.equal(
  skipHonoringPlan.plan.decisions[0].userOverridden,
  true,
  "a provider plan that honors a skip keeps the durable override marker",
);
const preservedUseOverride = validateCoverLetterPreparationOutput(
  plan,
  evidence,
  "authored_letter",
  sourceContext,
  false,
  [{ evidenceId: evidence[0].id, decision: "use" }],
);
assert.equal(
  preservedUseOverride.plan.decisions[0].userOverridden,
  true,
  "a refreshed plan retains the candidate's explicit evidence choice",
);

const unknownSourceText =
  `${authoredSentence} `.repeat(8) + "\n\nI would work from [office location].";
const unknownPreflight = buildCoverLetterPreflight({
  text: unknownSourceText,
  sourceMode: "authored_letter",
  ...resolvedContext,
});
const unknownSourceContext = {
  rawTemplateText: unknownSourceText,
  structuredTemplate: unknownPreflight.template.structuredTemplate,
  authoredProse: unknownPreflight.template.authoredProse,
  slots: unknownPreflight.template.slots,
};
const unknownSlot = unknownSourceContext.slots[0];
assert.equal(unknownSlot.resolution.source, "unclassified");
const classifiedUnknownPlan = validateCoverLetterPreparationOutput(
  {
    ...plan,
    slotDecisions: [
      {
        slotId: unknownSlot.id,
        decision: "use_job_context",
        evidenceIds: [],
        reason: "Use the office location stated in the posting.",
      },
    ],
  },
  evidence,
  "authored_letter",
  unknownSourceContext,
  false,
);
assert.equal(
  classifiedUnknownPlan.plan.slotDecisions[0].decision,
  "use_job_context",
  "preparation may classify an unknown natural-language slot as job context",
);

assertUserSafeError(
  () =>
    validateCoverLetterPreparationOutput(
      { ...plan, slotDecisions: slotDecisions.slice(1) },
      evidence,
      "authored_letter",
      sourceContext,
      false,
    ),
  502,
  /every template slot/,
);
assertUserSafeError(
  () =>
    validateCoverLetterPreparationOutput(
      {
        ...plan,
        slotDecisions: slotDecisions.map((item, index) =>
          index === 0 ? { ...item, slotId: "slot:unknown" } : item,
        ),
      },
      evidence,
      "authored_letter",
      sourceContext,
      false,
    ),
  502,
  /unknown id/,
);

const selectedEvidence = [evidence[0]];
const draftPlan = validateCoverLetterPlanForDraft(
  plan,
  selectedEvidence,
  sourceContext,
);
assert.equal(draftPlan.slotDecisions.length, sourceContext.slots.length);

const generativeSlotIds = sourceContext.slots
  .filter((slot) => slot.resolution.kind === "generate")
  .map((slot) => slot.id);
const validDraft = {
  bodyParagraphs: [
    {
      text: `I am applying for the Software Engineer role at Acme. ${authoredSentence}`,
      evidenceIds: ["source_letter", evidence[0].id],
      slotIds: [generativeSlotIds[0]],
    },
    {
      text: `${authoredSentence} I would bring the same dependable delivery habits to the role.`,
      evidenceIds: ["source_letter", evidence[0].id],
      slotIds: generativeSlotIds.slice(1),
    },
  ],
  changeSummary: ["Resolved the typed template fields."],
  preservedFromSource: ["Preserved the direct delivery language."],
  warnings: [],
};
assert.equal(
  validateCoverLetterDraftOutput(
    validDraft,
    selectedEvidence,
    sourceContext,
    draftPlan,
    resolvedContext,
  ).bodyBlocks.length,
  2,
);
assertUserSafeError(
  () =>
    validateCoverLetterDraftOutput(
      {
        ...validDraft,
        bodyParagraphs: validDraft.bodyParagraphs.map((paragraph) => ({
          ...paragraph,
          slotIds: [],
        })),
      },
      selectedEvidence,
      sourceContext,
      draftPlan,
      resolvedContext,
    ),
  502,
  /every generative template slot/,
);
assertUserSafeError(
  () =>
    validateCoverLetterDraftOutput(
      {
        ...validDraft,
        bodyParagraphs: [
          {
            ...validDraft.bodyParagraphs[0],
            text: "I am applying for the [Exact Position Title] role.",
          },
          validDraft.bodyParagraphs[1],
        ],
      },
      selectedEvidence,
      sourceContext,
      draftPlan,
      resolvedContext,
    ),
  502,
  /invalid text/,
);

const preparationPrompts = buildCoverLetterPreparationPrompts({
  jobText: "Acme needs a Software Engineer who builds dependable services.",
  sourceContext: promptSourceContext,
  sourceMode: "authored_letter",
  evidenceItems: evidence,
  preparationValues: {},
  resolvedContext,
  clarificationAnswers: {},
  customInstructions: "",
});
assert.match(preparationPrompts.userPrompt, /slotDecisions/);
assert.match(preparationPrompts.systemPrompt, /typed template slots/i);
assert.match(
  preparationPrompts.userPrompt,
  /Classify an unclassified slot/,
  "unknown natural-language slots stay open for preparation classification",
);
const overridePrompts = buildCoverLetterPreparationPrompts({
  jobText: "Acme needs a Software Engineer who builds dependable services.",
  sourceContext: promptSourceContext,
  sourceMode: "authored_letter",
  evidenceItems: evidence,
  evidenceOverrides: skippedEvidenceOverrides,
  preparationValues: {},
  resolvedContext,
  clarificationAnswers: {},
  customInstructions: "",
});
assert.match(
  overridePrompts.userPrompt,
  new RegExp(
    `<evidence_overrides>[\\s\\S]*${evidence[0].id}[\\s\\S]*skip[\\s\\S]*</evidence_overrides>`,
  ),
  "preparation prompts carry the candidate's evidence overrides",
);
const sourceContextPayload = preparationPrompts.userPrompt.match(
  /<source_context>\n([\s\S]*?)\n<\/source_context>/,
)?.[1];
assert(sourceContextPayload);
assert.equal(
  JSON.parse(sourceContextPayload).authoredProse.includes(
    "specific responsibility",
  ),
  false,
);

const draftPrompts = buildPreparedCoverLetterDraftPrompts({
  jobText: "Acme needs a Software Engineer who builds dependable services.",
  sourceContext: promptSourceContext,
  sourceMode: "authored_letter",
  selectedEvidence,
  plan: draftPlan,
  resolvedContext,
  tonePreference: "",
  customInstructions: "",
});
assert.match(draftPrompts.userPrompt, /slotIds/);
assert.doesNotMatch(draftPrompts.userPrompt, /product and design partners/);

// Real provider dispatch remains deterministic: fetch is stubbed and no
// personal material or paid request leaves the process.
const realFetch = globalThis.fetch;
const previousOpenAiKey = process.env.OPENAI_API_KEY;
let nextProviderOutput = plan;
let providerCalls = 0;
let capturedPrompt = "";
process.env.OPENAI_API_KEY = "offline-test-key";
globalThis.fetch = async (_url, init) => {
  providerCalls += 1;
  const body = JSON.parse(String(init?.body ?? "{}"));
  capturedPrompt = body.input?.[0]?.content?.[0]?.text ?? "";
  return new Response(
    JSON.stringify({ output_text: JSON.stringify(nextProviderOutput) }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
};

try {
  const common = {
    provider: "openai",
    model: "gpt-test",
    apiKey: "offline-test-key",
    jobText:
      "Acme needs a Software Engineer who builds dependable Python services.",
    sourceContext,
    sourceMode: "authored_letter",
    preparationValues: {},
    resolvedContext,
    customInstructions: "",
  };
  const providerPreparation = await prepareCoverLetter({
    ...common,
    evidenceItems: evidence,
    clarificationAnswers: {},
  });
  assert.equal(providerPreparation.status, "ready");
  assert.equal(
    capturedPrompt.includes("specific responsibility from the posting"),
    true,
  );

  const repeatedGrounded =
    "I build dependable product software by listening closely to users, reducing ambiguity with teammates, and carrying implementation details through release.";
  nextProviderOutput = {
    bodyParagraphs: [
      {
        text: `I am applying for the Software Engineer role at Acme. ${repeatedGrounded} ${repeatedGrounded} ${repeatedGrounded} ${repeatedGrounded}`,
        evidenceIds: ["source_letter", evidence[0].id],
        slotIds: [generativeSlotIds[0]],
      },
      {
        text: `${repeatedGrounded} ${repeatedGrounded} ${repeatedGrounded} ${repeatedGrounded} ${repeatedGrounded}`,
        evidenceIds: ["source_letter", evidence[0].id],
        slotIds: generativeSlotIds.slice(1),
      },
    ],
    changeSummary: ["Resolved every approved slot."],
    preservedFromSource: ["Preserved direct delivery language."],
    warnings: [],
  };
  const proposal = await draftPreparedCoverLetter({
    ...common,
    plan: draftPlan,
    selectedEvidence,
  });
  assert.equal(proposal.readyToSend, true);
  assert.equal(proposal.coverLetterText.includes("["), false);

  const shortGuidedSource = "Please tailor [relevant project].";
  const shortGuidedPreflight = buildCoverLetterPreflight({
    text: shortGuidedSource,
    sourceMode: "guided_draft",
    candidateName: resolvedContext.candidateName,
    role: resolvedContext.role,
    company: resolvedContext.company,
    values: {
      why_role: "I want to build dependable tools for this team.",
      lead_experience: evidence[0].text,
    },
  });
  const shortGuidedContext = {
    rawTemplateText: shortGuidedSource,
    structuredTemplate: shortGuidedPreflight.template.structuredTemplate,
    authoredProse: shortGuidedPreflight.template.authoredProse,
    slots: shortGuidedPreflight.template.slots,
  };
  const shortGuidedSlot = shortGuidedContext.slots[0];
  const shortGuidedPlan = {
    ...plan,
    slotDecisions: [
      {
        slotId: shortGuidedSlot.id,
        decision: "use_candidate_evidence",
        evidenceIds: [evidence[0].id],
        reason: "Use selected verified delivery evidence.",
      },
    ],
  };
  const groundedSentence =
    "I built dependable Python services and REST APIs for reporting workflows.";
  nextProviderOutput = {
    bodyParagraphs: [
      {
        text: `I am applying for the Software Engineer role at Acme. ${`${groundedSentence} `.repeat(9).trim()}`,
        evidenceIds: ["source_letter", evidence[0].id],
        slotIds: [shortGuidedSlot.id],
      },
      {
        text: `${groundedSentence} `.repeat(10).trim(),
        evidenceIds: [evidence[0].id],
        slotIds: [],
      },
    ],
    changeSummary: ["Built the draft from the selected candidate evidence."],
    preservedFromSource: [],
    warnings: [],
  };
  const shortGuidedProposal = await draftPreparedCoverLetter({
    ...common,
    sourceContext: shortGuidedContext,
    sourceMode: "guided_draft",
    preparationValues: {
      why_role: "I want to build dependable tools for this team.",
      lead_experience: evidence[0].text,
    },
    plan: shortGuidedPlan,
    selectedEvidence,
  });
  assert.equal(
    shortGuidedProposal.readyToSend,
    true,
    "short guided scaffolding does not become an impossible authored-phrase requirement",
  );
  assert.match(capturedPrompt, /Authored voice anchor present: false/);

  const routeBody = {
    mode: "prepare",
    sourceMode: "authored_letter",
    sourceCoverLetterText: sourceText,
    jobText: common.jobText,
    resolvedContext,
    preparationValues: {},
    evidenceItems: evidence,
    provider: "openai",
    model: "gpt-test",
  };
  nextProviderOutput = plan;
  const callsBeforeRoute = providerCalls;
  const routeResult = await runHandler("POST", JSON.stringify(routeBody));
  assert.equal(
    routeResult.status,
    200,
    "an authored template reaches provider preparation",
  );
  assert.equal(providerCalls, callsBeforeRoute + 1);

  const referralSource =
    `${authoredSentence} `.repeat(8) + "\n\nMention [Referral name].";
  const referralResult = await runHandler(
    "POST",
    JSON.stringify({ ...routeBody, sourceCoverLetterText: referralSource }),
  );
  assert.equal(
    referralResult.status,
    422,
    "a private factual slot stops before provider dispatch",
  );
  assert.equal(providerCalls, callsBeforeRoute + 1);
  nextProviderOutput = plan;
  const overriddenRouteResult = await runHandler(
    "POST",
    JSON.stringify({
      ...routeBody,
      evidenceOverrides: skippedEvidenceOverrides,
    }),
  );
  assert.equal(
    overriddenRouteResult.status,
    502,
    "the route rejects a refreshed provider plan that reselects skipped evidence",
  );
  assert.match(
    overriddenRouteResult.payload.error,
    /candidate evidence override/,
  );
  assert.equal(providerCalls, callsBeforeRoute + 2);

  const companySourceText =
    `${authoredSentence} `.repeat(8) +
    "\n\nConnect this to [specific product from the posting].";
  const companyPreflight = buildCoverLetterPreflight({
    text: companySourceText,
    sourceMode: "authored_letter",
    ...resolvedContext,
  });
  const companyContext = {
    rawTemplateText: companySourceText,
    structuredTemplate: companyPreflight.template.structuredTemplate,
    authoredProse: companyPreflight.template.authoredProse,
    slots: companyPreflight.template.slots,
  };
  const companySlot = companyContext.slots[0];
  const companyPlan = {
    ...plan,
    slotDecisions: [
      {
        slotId: companySlot.id,
        decision: "use_job_context",
        evidenceIds: [],
        reason: "Use a concise product fact from the posting.",
      },
    ],
  };
  nextProviderOutput = {
    ...validDraft,
    bodyParagraphs: [
      {
        text: `Acme’s platform supports 10,000 teams with Kubernetes. I am applying for the Software Engineer role. ${authoredSentence} ${authoredSentence} ${authoredSentence} ${authoredSentence}`,
        evidenceIds: ["source_letter", evidence[0].id],
        slotIds: [companySlot.id],
      },
      {
        text: `${authoredSentence} ${authoredSentence} ${authoredSentence} ${authoredSentence} ${authoredSentence}`,
        evidenceIds: ["source_letter", evidence[0].id],
        slotIds: [],
      },
    ],
  };
  const companyProposal = await draftPreparedCoverLetter({
    ...common,
    jobText:
      "Acme's platform supports 10,000 teams with Kubernetes and needs a Software Engineer.",
    sourceContext: companyContext,
    plan: companyPlan,
    selectedEvidence,
  });
  assert.match(
    companyProposal.coverLetterText,
    /Acme’s platform supports 10,000 teams with Kubernetes/,
    "a JD-grounded employer statement with a posting number is allowed without becoming candidate evidence",
  );
  nextProviderOutput = {
    ...validDraft,
    bodyParagraphs: [
      {
        text: `Acme uses Kubernetes to run its platform, and I have Kubernetes experience. I am applying for the Software Engineer role. ${authoredSentence} ${authoredSentence} ${authoredSentence} ${authoredSentence}`,
        evidenceIds: ["source_letter", evidence[0].id],
        slotIds: [companySlot.id],
      },
      {
        text: `${authoredSentence} ${authoredSentence} ${authoredSentence} ${authoredSentence} ${authoredSentence}`,
        evidenceIds: ["source_letter", evidence[0].id],
        slotIds: [],
      },
    ],
  };
  await assert.rejects(
    () =>
      draftPreparedCoverLetter({
        ...common,
        jobText:
          "Acme uses Kubernetes to run its platform and needs a Software Engineer.",
        sourceContext: companyContext,
        plan: companyPlan,
        selectedEvidence,
      }),
    /evidence checks/,
    "an employer-led sentence cannot hide an unsupported candidate claim",
  );
  nextProviderOutput = {
    ...validDraft,
    bodyParagraphs: [
      {
        text: `Acme's Kubernetes work aligns with Jordan Lee's Kubernetes experience. I am applying for the Software Engineer role. ${authoredSentence} ${authoredSentence} ${authoredSentence} ${authoredSentence}`,
        evidenceIds: ["source_letter", evidence[0].id],
        slotIds: [companySlot.id],
      },
      {
        text: `${authoredSentence} ${authoredSentence} ${authoredSentence} ${authoredSentence} ${authoredSentence}`,
        evidenceIds: ["source_letter", evidence[0].id],
        slotIds: [],
      },
    ],
  };
  await assert.rejects(
    () =>
      draftPreparedCoverLetter({
        ...common,
        jobText:
          "Acme uses Kubernetes to run its platform and needs a Software Engineer.",
        sourceContext: companyContext,
        plan: companyPlan,
        selectedEvidence,
      }),
    /evidence checks/,
    "an employer-led sentence cannot hide a third-person candidate claim",
  );
  nextProviderOutput = {
    ...validDraft,
    bodyParagraphs: [
      {
        text: `Acme supports 10,000 teams, and I improved reliability by 30%. I am applying for the Software Engineer role. ${authoredSentence} ${authoredSentence} ${authoredSentence} ${authoredSentence}`,
        evidenceIds: ["source_letter", evidence[0].id],
        slotIds: [companySlot.id],
      },
      {
        text: `${authoredSentence} ${authoredSentence} ${authoredSentence} ${authoredSentence} ${authoredSentence}`,
        evidenceIds: ["source_letter", evidence[0].id],
        slotIds: [],
      },
    ],
  };
  await assert.rejects(
    () =>
      draftPreparedCoverLetter({
        ...common,
        jobText:
          "Acme supports 10,000 teams and needs a Software Engineer who builds dependable services.",
        sourceContext: companyContext,
        plan: companyPlan,
        selectedEvidence,
      }),
    /evidence checks/,
    "an employer-led sentence cannot hide an unsupported candidate number",
  );

  const kubernetesSourceText =
    `${authoredSentence} `.repeat(8) +
    "\n\nConnect this to [specific Kubernetes platform].";
  const kubernetesPreflight = buildCoverLetterPreflight({
    text: kubernetesSourceText,
    sourceMode: "authored_letter",
    ...resolvedContext,
  });
  const kubernetesContext = {
    rawTemplateText: kubernetesSourceText,
    structuredTemplate: kubernetesPreflight.template.structuredTemplate,
    authoredProse: kubernetesPreflight.template.authoredProse,
    slots: kubernetesPreflight.template.slots,
  };
  const kubernetesSlot = kubernetesContext.slots[0];
  const kubernetesPlan = {
    ...plan,
    slotDecisions: [
      {
        slotId: kubernetesSlot.id,
        decision: "use_job_and_candidate",
        evidenceIds: [evidence[0].id],
        reason: "Connect job context to verified evidence.",
      },
    ],
  };
  nextProviderOutput = {
    ...validDraft,
    bodyParagraphs: validDraft.bodyParagraphs.map((paragraph, index) => ({
      ...paragraph,
      text:
        index === 0
          ? `I have Kubernetes experience and am applying for the Software Engineer role at Acme. ${authoredSentence} ${authoredSentence} ${authoredSentence} ${authoredSentence}`
          : `${authoredSentence} ${authoredSentence} ${authoredSentence} ${authoredSentence} ${authoredSentence}`,
      slotIds: index === 0 ? [kubernetesSlot.id] : [],
    })),
  };
  await assert.rejects(
    () =>
      draftPreparedCoverLetter({
        ...common,
        jobText:
          "Acme needs Kubernetes platform experience for its Software Engineer role.",
        sourceContext: kubernetesContext,
        plan: kubernetesPlan,
        selectedEvidence,
      }),
    /evidence checks/,
    "slot wording never grounds a candidate Kubernetes claim",
  );
} finally {
  globalThis.fetch = realFetch;
  if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = previousOpenAiKey;
}

// Structural guards lock the original client regression and preserve the
// proposal/editor separation on provider failure.
const coverTab = readFileSync(
  new URL("../../../src/sections/tabs/CoverLetterTab.tsx", import.meta.url),
  "utf8",
);
const clientHook = readFileSync(
  new URL("../../../src/hooks/useCoverLetter.ts", import.meta.url),
  "utf8",
);
const preflightSource = readFileSync(
  new URL("../../../src/lib/coverLetterPreflight.ts", import.meta.url),
  "utf8",
);
assert.doesNotMatch(
  coverTab,
  /placeholders\.length[^;\n]*(?:canTailor|disabled)/,
);
assert.doesNotMatch(
  preflightSource,
  /sourceMode === "authored_letter"[^{}]*placeholders\.length/,
);
assert.match(
  clientHook,
  /preflight\.requiresUserVoiceAnchor[\s\S]{0,160}user_answer/,
);
assert.match(clientHook, /onApplyTailored\(pendingProposal\.coverLetterText\)/);
assert.doesNotMatch(clientHook, /failRequest[\s\S]{0,300}onApplyTailored/);

console.log("cover-letter preparation and drafting probes: PASS");
