// The Background partitioned by resume entry: blocks follow the linker's own
// partition, editing one block leaves every other byte alone, and a new block
// is appended with the heading the linker will match. Linking by choice
// rewrites only a heading's name, so the stored text stays the link.

import assert from "node:assert/strict";

import { linkProfileBlocks } from "../../../shared/candidateProfileContract.ts";

import {
  appendProfileBlock,
  composeProfileHeading,
  defaultEntryHeading,
  entryLinkName,
  headingLinkPreview,
  keepsOtherLinks,
  normalizeNoteBody,
  relinkProfileBlock,
  writeProfileLines,
  splitProfileHeading,
  parseProfileNotes,
  profileNotesScope,
  removeProfileBlock,
  replaceProfileBlock,
  replaceProfilePreamble
} from "../profileNotes.ts";

const resume = {
  header: null,
  sections: [
    { id: "exp", type: "standard", heading: "Experience", items: [
      { id: "acme", titleLeft: "<b>Acme Corp</b>", titleRight: "2024–present", subtitleLeft: "Engineer", subtitleRight: "", bullets: [] },
      { id: "beta", titleLeft: "Beta Inc", titleRight: "", subtitleLeft: "Analyst", subtitleRight: "2022", bullets: [] }
    ] },
    { id: "proj", type: "standard", heading: "Projects", items: [
      { id: "rf", titleLeft: "RoleFit AI", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: [] }
    ] },
    { id: "skl", type: "skills", heading: "Skills", items: [{ id: "lang", titleLeft: "Languages", titleRight: "", subtitleLeft: "Python", subtitleRight: "", bullets: [] }] }
  ]
};
const scope = profileNotesScope(resume);
assert.equal(scope.sections.length, 3, "every section is in scope for notes, whatever Polish would send");

const text = [
  "Summary line above headings.",
  "",
  "# Projects",
  "## RoleFit AI (personal project, 2026)",
  "Built it.",
  "### Typeset",
  "Part of RoleFit.",
  "",
  "## Acme Corp (professional, 2024)",
  "Shipped billing.",
  "### Beta Inc",
  "Cut from Acme.",
  "",
  "## Languages",
  "Python, SQL.",
  "",
  "## Acme Corp (continued)",
  "More billing."
].join("\n");

const notes = parseProfileNotes(scope, text);
assert.deepEqual(notes.preamble, { end: 2, body: "Summary line above headings." }, "text above the first heading is the preamble");
assert.deepEqual(
  notes.blocks.map((block) => [block.heading, block.start, block.end, block.linkage.status]),
  [
    ["Projects", 2, 3, "grouping"],
    ["RoleFit AI (personal project, 2026)", 3, 8, "linked"],
    ["Acme Corp (professional, 2024)", 8, 10, "linked"],
    ["Beta Inc", 10, 13, "general"],
    ["Languages", 13, 16, "general"],
    ["Acme Corp (continued)", 16, 18, "linked"]
  ],
  "blocks start where the linker starts one: a nested unnamed heading stays inside, a nested other-entry heading is cut out"
);
assert.equal(notes.blocks[1].body, "Built it.\n### Typeset\nPart of RoleFit.", "a block's body keeps its nested sub-heading and drops trailing blank lines");
assert.deepEqual([...notes.byEntry.keys()], ["rf", "acme"], "entries map to their blocks");
assert.equal(notes.byEntry.get("acme").length, 2, "an entry named twice owns both blocks");
assert.deepEqual(notes.general.map((block) => block.heading), ["Beta Inc", "Languages"], "general notes exclude grouping headings without text");
assert.equal(notes.general[0].linkage.reason, "inside another entry's heading");

// Editing one block changes only its lines.
const acme = notes.byEntry.get("acme")[0];
const edited = replaceProfileBlock(text, acme, "Acme Corp (professional, 2024–present)", "Shipped billing.\nLed the migration.");
assert.equal(
  edited,
  text.replace("## Acme Corp (professional, 2024)\nShipped billing.\n", "## Acme Corp (professional, 2024–present)\nShipped billing.\nLed the migration.\n\n"),
  "the heading line is rewritten at its level and the block ends with one blank line before the next"
);
assert.equal(replaceProfileBlock(text, acme, acme.heading, acme.body), text.replace("Shipped billing.\n###", "Shipped billing.\n\n###"), "writing a block back unchanged only normalises its trailing blank line");
const last = notes.byEntry.get("acme")[1];
assert.equal(replaceProfileBlock(text, last, last.heading, "More billing.\nAnd exports."), `${text}\nAnd exports.`, "the last block gains no trailing blank line");
assert.equal(replaceProfileBlock(text, acme, "   ", acme.body).includes("## Acme Corp (professional, 2024)"), true, "a blank heading keeps the old one");

assert.equal(replaceProfilePreamble(text, notes.preamble.end, "New summary."), text.replace("Summary line above headings.", "New summary."), "the preamble edits in place");
assert.equal(removeProfileBlock(text, notes.general[1]), text.replace("## Languages\nPython, SQL.\n\n", ""), "removing a block drops exactly its lines");
assert.equal(removeProfileBlock(text, last), text.replace("\n\n## Acme Corp (continued)\nMore billing.", ""), "removing the last block leaves no trailing blank lines");

const appended = appendProfileBlock(text, "Beta Inc (2022)");
assert.equal(appended.background, `${text}\n\n## Beta Inc (2022)\n`);
assert.equal(appended.start, text.split("\n").length + 1, "the new block starts after one blank line");
const after = parseProfileNotes(scope, appended.background);
assert.equal(after.blocks.find((block) => block.start === appended.start)?.linkage.entryId, "beta", "the appended block links to its entry");
assert.deepEqual(appendProfileBlock("", "Acme Corp"), { background: "## Acme Corp\n", start: 0 }, "an empty Background starts at line 0");
assert.deepEqual(appendProfileBlock("Note only\n\n\n", "Acme Corp"), { background: "Note only\n\n## Acme Corp\n", start: 2 }, "trailing blank lines collapse to one");

assert.equal(defaultEntryHeading(resume.sections[0].items[0]), "Acme Corp (2024–present)", "a new heading is the plain title plus the resume's dates");
assert.equal(defaultEntryHeading(resume.sections[0].items[1]), "Beta Inc (2022)", "subtitle dates count when the title has none");
assert.equal(defaultEntryHeading(resume.sections[1].items[0]), "RoleFit AI", "no dates, no parenthesis");

assert.equal(defaultEntryHeading(resume.sections[0].items[0], "Engineer"), "Engineer (2024–present)", "a supplied link name replaces the title");

// A heading splits where the linker cuts its name; composing writes "Name (detail)".
assert.deepEqual(splitProfileHeading("CareFlow (personal project, 2025–present)"), { name: "CareFlow", detail: "personal project, 2025–present" });
assert.deepEqual(splitProfileHeading("CareFlow — personal project"), { name: "CareFlow", detail: "personal project" });
assert.deepEqual(splitProfileHeading("Acme | Engineer"), { name: "Acme", detail: "Engineer" });
assert.deepEqual(splitProfileHeading("Typeset: open source"), { name: "Typeset", detail: "open source" });
assert.deepEqual(splitProfileHeading("**RoleFit AI**"), { name: "RoleFit AI", detail: "" });
assert.equal(composeProfileHeading("CareFlow", " personal project "), "CareFlow (personal project)");
assert.equal(composeProfileHeading("CareFlow", "  "), "CareFlow", "no detail, no parenthesis");
for (const heading of ["CareFlow (personal project, 2025–present)", "RoleFit AI", "Acme (professional (contract), 2024)"]) {
  const { name, detail } = splitProfileHeading(heading);
  assert.equal(composeProfileHeading(name, detail), heading, `"${heading}" round-trips`);
}

// The link name: title, else subtitle, else none.
assert.equal(entryLinkName(scope, resume.sections[0].items[0]), "Acme Corp");
const twinEntries = [
  { id: "t1", titleLeft: "Beta Labs", titleRight: "", subtitleLeft: "Research Assistant", subtitleRight: "", bullets: [] },
  { id: "t2", titleLeft: "Beta Labs", titleRight: "", subtitleLeft: "Teaching Assistant", subtitleRight: "", bullets: [] },
  { id: "t3", titleLeft: "Gamma", titleRight: "", subtitleLeft: "Teaching Assistant", subtitleRight: "", bullets: [] }
];
const twins = profileNotesScope({ header: null, sections: [{ id: "exp", type: "standard", heading: "Experience", items: twinEntries }] });
const [t1, t2, t3] = twinEntries;
assert.equal(entryLinkName(twins, t1), "Research Assistant", "a shared title falls back to a unique subtitle");
assert.equal(entryLinkName(twins, t2), null, "a shared title and shared subtitle cannot link");
assert.equal(entryLinkName(twins, t3), "Gamma");
assert.equal(headingLinkPreview(scope, "Beta Inc (2022)")?.entryId, "beta", "a typed name previews its link");
assert.equal(headingLinkPreview(scope, "Side notes")?.status, "general");
assert.equal(headingLinkPreview(scope, "  "), undefined);

// Relinking moves a note to the chosen entry and keeps its detail and body.
const general = notes.general[1];
const relinked = relinkProfileBlock(text, general, "RoleFit AI");
const relinkedNotes = parseProfileNotes(scope, relinked);
const moved = relinkedNotes.blocks.find((block) => block.start === general.start);
assert.equal(moved.heading, "RoleFit AI");
assert.equal(moved.linkage.entryId, "rf", "the relinked note belongs to the chosen entry");
assert.equal(moved.body, general.body, "relinking keeps the body");
assert.equal(relinkedNotes.byEntry.get("rf").length, 2, "a note moved onto an entry with notes becomes its second note");
const acmeRelinked = parseProfileNotes(scope, relinkProfileBlock(text, acme, "Beta Inc"));
assert.equal(acmeRelinked.blocks.find((block) => block.start === acme.start).heading, "Beta Inc (professional, 2024)", "relinking keeps the detail");
// Unlinking renames to a name that matches no entry.
const unlinked = parseProfileNotes(scope, replaceProfileBlock(text, acme, composeProfileHeading("Acme Corp notes", "professional, 2024"), acme.body));
assert.equal(unlinked.blocks.find((block) => block.start === acme.start).linkage.status, "general", "\"<name> notes\" links to nothing");

// A body edit keeps the heading line byte for byte.
const marked = "## **Acme Corp** (pro_fessional) ##\nOld.";
const markedBlock = parseProfileNotes(scope, marked).blocks[0];
assert.deepEqual(writeProfileLines(marked, 0, markedBlock.end, marked.split("\n")[0], "New.\n\n"), { background: "## **Acme Corp** (pro_fessional) ##\nNew.", end: 2 }, "the heading's marks survive a body edit");
assert.equal(normalizeNoteBody("a\n b \n\n"), "a\n b ", "only trailing blank lines go");

// The editor's write rule: it rewrites exactly the span it last wrote, so a
// heading typed into a body stays in the editor's lines (no text is written
// twice) and the parser reads it as its own note once typing stops.
{
  const start = "## Acme Corp (2024)\nfoo\n\n## RoleFit AI\nrf";
  let stored = start;
  const first = parseProfileNotes(scope, stored).blocks[0];
  let draft = first.body;
  let end = first.end;
  for (const char of "\n## Beta Inc\nmore") {
    draft += char;
    ({ background: stored, end } = writeProfileLines(stored, 0, end, stored.split("\n")[0], draft));
  }
  assert.equal(stored, "## Acme Corp (2024)\nfoo\n## Beta Inc\nmore\n\n## RoleFit AI\nrf", "every typed character lands once, in place");
  assert.deepEqual(parseProfileNotes(scope, stored).blocks.map((block) => block.heading), ["Acme Corp (2024)", "Beta Inc", "RoleFit AI"], "the typed heading became its own note");
  assert.equal(writeProfileLines(stored, 0, end, "## Acme Corp (2024)", "foo").background, start.replace("foo\n\n", "foo\n\n"), "rewriting the span removes exactly what the editor wrote");
}

// Appending matches a Background that uses level-1 headings, so the new note
// is its own block and links.
const levelOne = appendProfileBlock("# Acme Corp (professional)\nacme", "Beta Inc (2022)", scope);
assert.equal(levelOne.background, "# Acme Corp (professional)\nacme\n\n# Beta Inc (2022)\n");
assert.equal(parseProfileNotes(scope, levelOne.background).blocks.find((block) => block.start === levelOne.start)?.linkage.entryId, "beta");
const underNotes = appendProfileBlock("# My notes\nfree text", "Beta Inc", scope);
assert.equal(appendProfileBlock("# My notes\nfree text", "Beta Inc").background, "# My notes\nfree text\n\n# Beta Inc\n", "without a resume the nesting check still holds");
const afterCutOut = appendProfileBlock("# Acme Corp (professional)\nacme\n## Beta Inc\nb", "Kubernetes ([type], [dates])", scope);
assert.equal(afterCutOut.background.split("\n").at(-2), "# Kubernetes ([type], [dates])", "after a cut-out note, a \"##\" would inherit the entry above, so the note is level 1");
assert.equal(parseProfileNotes(scope, afterCutOut.background).blocks.find((block) => block.start === afterCutOut.start)?.linkage.status, "general");
assert.ok(!linkProfileBlocks(scope, afterCutOut.background).get("acme").includes("Kubernetes"), "the new note is never another entry's evidence");
assert.equal(appendProfileBlock("# Projects\n## RoleFit AI\nrf", "Beta Inc", scope).background, "# Projects\n## RoleFit AI\nrf\n\n## Beta Inc\n", "under a grouping heading the note stays at level 2");
assert.equal(parseProfileNotes(scope, underNotes.background).blocks.find((block) => block.start === underNotes.start)?.linkage.entryId, "beta", "a new note is never swallowed by a non-grouping level-1 heading");

// After a nested note cut out of an entry, a heading that hands text back to
// the entry starts its own note there, matching the linker.
const resumed = "## Acme Corp\nacme\n### Beta Inc\nbeta\n### Misc\nmisc";
const resumedNotes = parseProfileNotes(scope, resumed);
assert.deepEqual(resumedNotes.blocks.map((block) => [block.heading, block.linkage.entryId]), [["Acme Corp", "acme"], ["Beta Inc", undefined], ["Misc", "acme"]]);
assert.equal(resumedNotes.byEntry.get("acme").map((block) => block.body).join("\n"), "acme\nmisc");
assert.ok(linkProfileBlocks(scope, resumed).get("acme").includes("misc") && !linkProfileBlocks(scope, resumed).get("acme").includes("beta"), "the linker agrees");

// Renaming a nested note in place can merge it into its parent entry; the
// editor checks the re-parsed block, so this rename is refused.
const nested = "## Acme Corp\nacme\n### Beta Inc\nbeta fact";
const nestedBeta = parseProfileNotes(scope, nested).blocks[1];
assert.equal(nestedBeta.linkage.reason, "inside another entry's heading");
assert.equal(parseProfileNotes(scope, replaceProfileBlock(nested, nestedBeta, "Beta Inc notes", nestedBeta.body)).blocks.find((block) => block.start === nestedBeta.start), undefined, "the renamed note would join Acme's");

// Renaming, relinking, or removing one note must not change how any other
// note links; the editor refuses such an edit and points to Text view.
{
  const grouped = "# Experience\nCareer intro.\n\n## Acme Corp\nacme fact\n\n## Beta Inc\nbeta fact";
  const group = parseProfileNotes(scope, grouped).general[0];
  const keeps = (next, block) => keepsOtherLinks(scope, grouped, next, block.start, block.end);
  assert.equal(group.heading, "Experience");
  assert.equal(keeps(replaceProfileBlock(grouped, group, "Career", group.body), group), false, "renaming a grouping heading would unlink every entry beneath it");
  assert.equal(keeps(relinkProfileBlock(grouped, group, "Beta Inc"), group), false, "relinking a grouping heading would cut the other entries out");
  assert.equal(keeps(replaceProfileBlock(grouped, group, "Projects", group.body), group), true, "another grouping word keeps every link");
  assert.equal(keeps(removeProfileBlock(grouped, group), group), true, "removing the intro leaves each entry linked at top level");
  const acmeNote = parseProfileNotes(scope, grouped).byEntry.get("acme")[0];
  assert.equal(keeps(replaceProfileBlock(grouped, acmeNote, "Acme Corp notes", acmeNote.body), acmeNote), true, "unlinking a flat note touches no other note");
  assert.equal(keeps(replaceProfileBlock(grouped, acmeNote, acmeNote.heading, "acme fact\nLonger now."), acmeNote), true, "a span that grows shifts the notes after it without changing them");
  const cut = "## Acme Corp\nacme\n### Beta Inc\nbeta\n### Misc\nacme misc";
  const [parent] = parseProfileNotes(scope, cut).blocks;
  assert.equal(keepsOtherLinks(scope, cut, removeProfileBlock(cut, parent), parent.start, parent.end), false, "removing a parent would relink the notes cut out of it");
  assert.equal(keepsOtherLinks(scope, cut, replaceProfileBlock(cut, parent, "Acme Corp notes", parent.body), parent.start, parent.end), false, "unlinking a parent would take its resumed note with it");
  const lastNote = parseProfileNotes(scope, grouped).byEntry.get("beta")[0];
  assert.equal(keeps(removeProfileBlock(grouped, lastNote), lastNote), true, "removing the last note, and the blank line before it, changes nothing else");
}

assert.deepEqual(parseProfileNotes(scope, "").blocks, [], "an empty Background has no blocks");
assert.equal(parseProfileNotes(scope, "").preamble, null);

console.log("profile-notes probes passed");
