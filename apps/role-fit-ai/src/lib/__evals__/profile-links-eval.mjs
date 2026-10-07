// A Profile Background heading links the text beneath it to exactly one
// standard resume entry by name. These probes pin the matching rules Tailor
// relies on for same-entry grounding.

import assert from "node:assert/strict";

import { linkProfileBlocks, profileHeadingLinkage, profileHeadingName, profileHeadings, profileTextOnResume } from "../../../shared/candidateProfileContract.ts";

const scope = {
  sections: [
    {
      id: "s-exp",
      heading: "Experience",
      type: "standard",
      entries: [
        { id: "e-acme", titleLeft: "<b>Acme Corp</b>", subtitleLeft: "<i>Software Engineer Intern</i>", bullets: [] },
        { id: "e-beta-1", titleLeft: "Beta Labs", subtitleLeft: "Research Assistant", bullets: [] },
        { id: "e-beta-2", titleLeft: "Beta Labs", subtitleLeft: "Teaching Assistant", bullets: [] }
      ]
    },
    {
      id: "s-proj",
      heading: "Projects",
      type: "standard",
      entries: [
        { id: "e-careflow", titleLeft: "CareFlow | Django, React", subtitleLeft: "Clinic scheduling platform", bullets: [] }
      ]
    },
    { id: "s-skills", heading: "Skills", type: "skills", entries: [{ id: "e-lang", titleLeft: "Languages", subtitleLeft: "Python", bullets: [] }] }
  ],
  contextSections: [
    { id: "s-edu", heading: "Education", type: "standard", entries: [{ id: "e-school", titleLeft: "State University", subtitleLeft: "B.S. Computer Science", bullets: [] }] }
  ]
};

const cases = [
  ["CareFlow (personal project, 2025–present)", "CareFlow"],
  ["**CareFlow** — personal project", "CareFlow"],
  ["Acme Corp: internship", "Acme Corp"],
  ["Smith-Jones LLC (freelance)", "Smith-Jones LLC"],
  ["Beta Labs | research", "Beta Labs"],
  ["RoleFit AI ##", "RoleFit AI"]
];
for (const [heading, name] of cases) assert.equal(profileHeadingName(heading), name, heading);

function link(profile) {
  return Object.fromEntries(linkProfileBlocks(scope, profile));
}

assert.deepEqual(link("General facts only.\nNo headings here."), {}, "text without headings links nothing");
assert.deepEqual(
  link("Above any heading.\n\n## CareFlow (personal project, 2025–present)\nBuilt HIPAA audit logging."),
  { "e-careflow": "## CareFlow (personal project, 2025–present)\nBuilt HIPAA audit logging." },
  "a heading naming the first title segment links, and text above the first heading stays general"
);
assert.deepEqual(
  link("## acme corp (internship, 2024)\nShipped billing exports."),
  { "e-acme": "## acme corp (internship, 2024)\nShipped billing exports." },
  "organization match ignores case and inline marks"
);
assert.deepEqual(
  link("## Software-Engineer Intern\nOwned the CLI."),
  { "e-acme": "## Software-Engineer Intern\nOwned the CLI." },
  "a subtitle names its entry too, ignoring punctuation"
);
assert.deepEqual(
  link("## Acme Corp\nShipped exports.\n### Software-Engineer Intern\nOwned the CLI."),
  { "e-acme": "## Acme Corp\nShipped exports.\n### Software-Engineer Intern\nOwned the CLI." },
  "a role heading inside its employer stays with that employer, ignoring punctuation"
);
assert.deepEqual(link("## Beta Labs (research, 2023)\nRan experiments."), {}, "a name shared by two entries is unlinked");
assert.deepEqual(link("## Careflow app\nNickname."), {}, "a different name does not link");
assert.deepEqual(link("## Languages\nRust, Go."), {}, "skills rows never link");
assert.deepEqual(
  link("## State University (academic, 2020–2024)\nCapstone."),
  { "e-school": "## State University (academic, 2020–2024)\nCapstone." },
  "context entries link, so their Profile text is known to be on the resume"
);
assert.deepEqual(
  link("```\n## CareFlow\n```\nCode sample only."),
  {},
  "a heading inside fenced code is not a heading"
);
assert.deepEqual(
  link("## CareFlow (personal project)\nBackend work.\n### Frontend\nReact dashboard.\n### Acme Corp\nInternship notes.\n## Other\nTail."),
  { "e-careflow": "## CareFlow (personal project)\nBackend work.\n### Frontend\nReact dashboard." },
  "a nested heading naming another entry is cut out of its parent and cannot link across its ancestor"
);
assert.deepEqual(
  link("## CareFlow\nBackend work.\n### Beta Labs\nLab notes."),
  { "e-careflow": "## CareFlow\nBackend work." },
  "a nested heading naming several entries is still never its parent's evidence"
);
assert.deepEqual(
  link("## CareFlow\nBackend work.\n### CareFlow (scheduling)\nMore detail."),
  { "e-careflow": "## CareFlow\nBackend work.\n### CareFlow (scheduling)\nMore detail." },
  "a nested heading naming the same entry stays inside its parent without duplicating text"
);
assert.deepEqual(
  link("# Beta Labs\n## Research Assistant (2023)\nRan experiments."),
  { "e-beta-1": "## Research Assistant (2023)\nRan experiments." },
  "a nested role heading disambiguates within its employer"
);
assert.deepEqual(
  link("## CareFlow\nFirst block.\n## Something else\nx\n## CareFlow (continued)\nSecond block."),
  { "e-careflow": "## CareFlow\nFirst block.\n\n## CareFlow (continued)\nSecond block." },
  "several headings may link to one entry"
);

const crossEmployer = {
  sections: [{
    id: "exp",
    heading: "Experience",
    type: "standard",
    entries: [
      { id: "acme", titleLeft: "Acme Corp", subtitleLeft: "Software Engineer", bullets: [] },
      { id: "beta", titleLeft: "Beta Inc", subtitleLeft: "Data Engineer", bullets: [] }
    ]
  }]
};
assert.deepEqual(
  Object.fromEntries(linkProfileBlocks(crossEmployer, "# Acme Corp\nShipped billing.\n## Data Engineer\nBuilt Spark jobs at Acme.")),
  { acme: "# Acme Corp\nShipped billing." },
  "a nested heading naming another employer's entry links to neither and is cut from its parent"
);
for (const profile of [
  "# My years at Acme\nShipped billing.\n## Data Engineer\nBuilt Spark jobs at Acme.",
  "# Acme Corp, Seattle 2019-2022\n## Data Engineer\nBuilt Spark jobs at Acme."
]) {
  assert.deepEqual(Object.fromEntries(linkProfileBlocks(crossEmployer, profile)), {},
    `an enclosing heading the linker cannot read blocks every link beneath it (${JSON.stringify(profile.split("\n")[0])})`);
}
assert.deepEqual(
  Object.fromEntries(linkProfileBlocks(crossEmployer, "# Experience\n## Data Engineer\nBuilt reports.")),
  { beta: "## Data Engineer\nBuilt reports." },
  "a grouping heading does not block links beneath it"
);
assert.deepEqual(
  Object.fromEntries(linkProfileBlocks(crossEmployer, "## Acme Corp\nShipped billing.\n## Data Engineer\nBuilt reports.")),
  { acme: "## Acme Corp\nShipped billing.", beta: "## Data Engineer\nBuilt reports." },
  "sibling headings link independently; the review row shows which heading grounded a change"
);
assert.deepEqual(
  profileTextOnResume(crossEmployer, "## Data Engineer (freelance, 2021)\nContract ETL work."),
  ["## Data Engineer (freelance, 2021)\nContract ETL work."],
  "a heading naming any entry, even by role, counts as on the resume"
);

const grouped = (sections) => ({ sections: sections.map(([id, heading, entries]) => ({ id, heading, type: "standard", entries })) });
assert.deepEqual(
  Object.fromEntries(linkProfileBlocks(
    grouped([["roles", "Industry Roles", [{ id: "beta", titleLeft: "Beta Inc", subtitleLeft: "Data Engineer", bullets: [] }]]]),
    "# Industry Roles\n## Beta Inc\nBuilt reports."
  )),
  { beta: "## Beta Inc\nBuilt reports." },
  "one of the resume's own section names groups entries"
);
assert.deepEqual(
  Object.fromEntries(linkProfileBlocks(
    grouped([["lab", "Experience", [{ id: "lab", titleLeft: "Research | Prof. Smith Lab", subtitleLeft: "Assistant", bullets: [] }]]]),
    "# Research\n## Protein folding (class project)\nUsed PyTorch on 3 GPUs."
  )),
  {},
  "a grouping word never names an entry, so a whole group cannot become one entry's evidence"
);
assert.deepEqual(
  Object.fromEntries(linkProfileBlocks(
    grouped([
      ["sel", "(Selected)", [{ id: "acme", titleLeft: "Acme Corp", subtitleLeft: "Software Engineer", bullets: [] }]],
      ["exp", "Experience", [{ id: "beta", titleLeft: "Beta Inc", subtitleLeft: "Data Engineer", bullets: [] }]]
    ]),
    "# (Acme, 2019-2022)\n## Data Engineer\nBuilt Spark jobs at Acme."
  )),
  {},
  "a section heading that reduces to no name does not make every parent a grouping heading"
);

// The plain-text resume parser writes "Role | Company | Dates" as a role-first
// title line, so the employer sits on the subtitle.
const roleFirst = {
  sections: [{
    id: "exp",
    heading: "Experience",
    type: "standard",
    entries: [
      { id: "acme", titleLeft: "Software Engineer", subtitleLeft: "Acme Corp", bullets: [] },
      { id: "beta", titleLeft: "Data Engineer", subtitleLeft: "Beta Inc", bullets: [] }
    ]
  }]
};
assert.deepEqual(
  Object.fromEntries(linkProfileBlocks(roleFirst, "## Acme Corp (professional, 2023–2024)\nShipped billing.")),
  { acme: "## Acme Corp (professional, 2023–2024)\nShipped billing." },
  "an employer heading links in a role-first layout"
);
assert.deepEqual(Object.fromEntries(linkProfileBlocks(roleFirst, "# My years at Acme\n## Data Engineer\nBuilt Spark jobs at Acme.")), {},
  "an unreadable enclosing heading blocks a role-first link too");
assert.deepEqual(Object.fromEntries(linkProfileBlocks(roleFirst, "# Acme Corp\n## Data Engineer\nBuilt Spark jobs at Acme.")), { acme: "# Acme Corp" },
  "a role naming another employer's entry is cut from the employer heading in a role-first layout");

const exactTitles = {
  sections: [{
    id: "proj",
    heading: "Projects",
    type: "standard",
    entries: [
      { id: "typeset", titleLeft: "<b>Typeset (open source)</b>", subtitleLeft: "", bullets: [] },
      { id: "rolefit", titleLeft: "RoleFit AI: Resume workbench", subtitleLeft: "", bullets: [] },
      { id: "pipeline", titleLeft: "data_pipeline", subtitleLeft: "", bullets: [] }
    ]
  }]
};
assert.deepEqual(
  Object.keys(Object.fromEntries(linkProfileBlocks(exactTitles, "## Typeset (open source)\nA.\n## RoleFit AI: Resume workbench\nB.\n## data_pipeline\nC."))).sort(),
  ["pipeline", "rolefit", "typeset"],
  "a heading that copies the resume title exactly links"
);

const blankHeading = {
  sections: [
    ...scope.sections,
    { id: "s-blank", heading: "<align=center></align>", type: "standard", entries: [{ id: "e-acme-2", titleLeft: "Acme Corp", subtitleLeft: "Contractor", bullets: [] }] }
  ]
};
assert.ok(linkProfileBlocks(blankHeading, "## Acme Corp\nx").has("e-acme"),
  "a section the server drops for a blank heading never makes a name ambiguous");

const withOmitted = { ...scope, locked: { omittedEntryNames: [["Acme Corp", "Contractor"]] } };
assert.deepEqual(Object.fromEntries(linkProfileBlocks(withOmitted, "## Acme Corp\nx")), {},
  "a name shared with an omitted entry stays unlinked");
assert.deepEqual(
  profileTextOnResume(withOmitted, "## Acme Corp\nx\n\n## Slotwise\ny"),
  ["## Acme Corp\nx\n"],
  "text under a heading naming any entry, even an ambiguous one, counts as on the resume"
);
assert.deepEqual(profileTextOnResume(scope, "## Beta Labs\nx"), ["## Beta Labs\nx"], "a shared name is on the resume");

// ── profileHeadingLinkage: the linker's answer per heading, for the Settings list ──
const linkage = (scopeArg, profile) => profileHeadingLinkage(scopeArg, profile).map(({ text, status, entry, reason }) =>
  [text, status, entry ?? reason ?? ""]);
const previewScope = {
  sections: [{
    id: "s-proj", heading: "Projects", type: "standard",
    entries: [{ id: "e-rolefit", titleLeft: "<b>RoleFit AI</b>", subtitleLeft: "Local-first resume workbench", bullets: [] }]
  }],
  locked: { omittedEntryNames: [["Old Startup", "Founder"]] }
};
const previewProfile = [
  "# Projects", "## RoleFit AI (personal project, 2025–present)", "Built it.",
  "## RoleFit", "Nickname.",
  "# My engineering work", "## RoleFit AI", "Blocked.",
  "# Experience", "## Old Startup (2019)", "Omitted entry.",
  "## RoleFit AI", "Second block.", "### Old Startup", "Nested under another entry.",
  "## Beta Labs", "Two entries share the name."
].join("\n");
assert.deepEqual(linkage(previewScope, previewProfile), [
  ["Projects", "grouping", ""],
  ["RoleFit AI (personal project, 2025–present)", "linked", "RoleFit AI"],
  ["RoleFit", "general", "names no entry"],
  ["My engineering work", "general", "names no entry"],
  ["RoleFit AI", "general", "parent heading is not a grouping heading"],
  ["Experience", "grouping", ""],
  ["Old Startup (2019)", "omitted", "Old Startup"],
  ["RoleFit AI", "linked", "RoleFit AI"],
  ["Old Startup", "general", "inside another entry's heading"],
  ["Beta Labs", "general", "names no entry"]
], "each heading reports linked, grouping, general with its reason, or omitted");
assert.deepEqual(
  linkage(scope, "## Beta Labs (research, 2023)\nRan experiments."),
  [["Beta Labs (research, 2023)", "general", "names more than one entry"]],
  "a name shared by two entries is reported as ambiguous"
);
assert.deepEqual(
  linkage(crossEmployer, "## Acme Corp\nShipped billing.\n### Highlights\nLed it.\n### Projects\nBilling v2.\n### Beta Inc\nOther job.\n#### Notes\nUnder Beta."),
  [
    ["Acme Corp", "linked", "Acme Corp"],
    ["Highlights", "linked", "Acme Corp"],
    ["Projects", "linked", "Acme Corp"],
    ["Beta Inc", "general", "inside another entry's heading"],
    ["Notes", "general", "names no entry"]
  ],
  "a nested heading naming no entry (grouping word or not) is part of its linked ancestor; one cut out by another entry's heading is not"
);
assert.deepEqual(
  profileHeadingLinkage(crossEmployer, "# Experience\n## Acme Corp\nx\n### Highlights\ny\n### Beta Inc\nz\n#### Notes\nw\n## Other\nv").map((item) => [item.text, item.line, item.block, item.entryId ?? null]),
  [["Experience", 0, true, null], ["Acme Corp", 1, true, "acme"], ["Highlights", 3, false, "acme"], ["Beta Inc", 5, true, null], ["Notes", 7, false, null], ["Other", 9, true, null]],
  "a heading starts a block at top level, under a grouping heading, or when cut out of its ancestor; an unnamed nested heading never does"
);
assert.deepEqual(linkage(scope, "No headings."), [], "no headings, no rows");
assert.deepEqual(linkage(null, "## RoleFit AI\nx"), [["RoleFit AI", "general", "names no entry"]], "no scope links nothing");
// The list and the linker must agree heading for heading: every heading line
// inside the linker's blocks is a Linked row, and no other row is.
for (const profile of [
  previewProfile,
  "# Beta Labs\n## Research Assistant (2023)\nRan experiments.",
  "# Acme Corp\nShipped billing.\n## Data Engineer\nBuilt Spark jobs at Acme.",
  "## Acme Corp\nShipped billing.\n### Highlights\nLed it.\n### Beta Inc\nOther job.\n#### Notes\nUnder Beta.\n## Beta Inc\nx\n### Tools\ny"
]) {
  for (const scopeArg of [scope, previewScope, crossEmployer]) {
    const inBlocks = [...linkProfileBlocks(scopeArg, profile).values()].flatMap((text) => profileHeadings(text).map((heading) => profileHeadingName(heading.text)));
    const reported = profileHeadingLinkage(scopeArg, profile).filter((item) => item.status === "linked").map((item) => profileHeadingName(item.text));
    assert.deepEqual(reported.sort(), inBlocks.sort(), `Linked rows are exactly the headings inside linked blocks (${JSON.stringify(profile.split("\n")[0])})`);
  }
}

console.log("profile-links probes passed");
