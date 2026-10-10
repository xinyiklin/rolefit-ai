// AI interpretation probes: crafted provider replies against a small synthetic
// PDF. The contract's promise is that a reply can only arrange the PDF's own
// text, so every way of smuggling in new, reworded, or duplicated text must be
// rejected, and every omission must surface as Not placed.
//
//   node apps/role-fit-ai/src/resume/pdfImport/__evals__/pdf-import-interpretation.mjs
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { stripInlineMarks } from "@typeset/engine/lib/inlineMarksText.ts";
import { importResumePdf } from "../importResumePdf.ts";
import { importRequestLines, interpretedImport } from "../importStructure.ts";
import { parseResumeImportLines } from "../../../../shared/resumeImportContract.ts";

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

async function fixturePdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const text = (value, x, y, size, font) => page.drawText(value, { x, y, size, font });
  text("Jane Doe", 54, 730, 18, bold);
  text("jane@example.test | 555-0100", 54, 712, 10, regular);
  text("EXPERIENCE", 54, 684, 12, bold);
  text("Acme Corp", 54, 668, 10, bold);
  text("2020 – 2022", 500, 668, 10, regular);
  text("Engineer", 54, 655, 10, regular);
  text("•", 57, 641, 10, regular);
  text("Built the billing service", 68, 641, 10, regular);
  text("SKILLS", 54, 614, 12, bold);
  text("Languages: Go, SQL", 54, 600, 10, regular);
  return doc.save();
}

const local = await importResumePdf(await fixturePdf(), pdfjs);
const { lines } = importRequestLines(local.lines);
const id = (text) => lines.flatMap((line) => line.pieces).find((piece) => piece.text === text)?.id;
const P = {
  name: id("Jane Doe"),
  contact: id("jane@example.test | 555-0100"),
  heading: id("EXPERIENCE"),
  company: id("Acme Corp"),
  dates: id("2020 – 2022"),
  role: id("Engineer"),
  bullet: id("Built the billing service"),
  skills: id("SKILLS"),
  skillRow: id("Languages: Go, SQL")
};
for (const [key, value] of Object.entries(P)) assert.ok(value, `fixture piece ${key} was not found in the request lines`);
assert.ok(!lines.some((line) => line.pieces.some((piece) => piece.text === "•")), "bullet markers are sent as line flags, not pieces");
assert.equal(parseResumeImportLines(lines).length, lines.length, "the client's request satisfies the server's request contract");

const valid = () => ({
  name: [P.name],
  contact: [[{ piece: P.contact, text: "jane@example.test" }], [{ piece: P.contact, text: "555-0100" }]],
  sections: [
    { heading: [P.heading], type: "standard", entries: [{ titleLeft: [P.company], titleRight: [P.dates], subtitleLeft: [P.role], bullets: [[P.bullet]] }] },
    { heading: [P.skills], type: "skills", entries: [{ titleLeft: [{ piece: P.skillRow, text: "Languages" }], subtitleLeft: [{ piece: P.skillRow, text: "Go, SQL" }] }] }
  ]
});
const plain = (data) => JSON.parse(JSON.stringify(data, (key, value) => (key === "id" ? undefined : typeof value === "string" ? stripInlineMarks(value) : value)));

let passed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test("a faithful reply rebuilds the document and passes the audit", () => {
  const outcome = interpretedImport(valid(), local);
  assert.ok(outcome.ok, outcome.reason);
  const { data, audit, findings } = outcome.result;
  assert.equal(audit.ok, true);
  assert.deepEqual(plain(data.header), { visible: true, name: "Jane Doe", contact: ["jane@example.test", "555-0100"] });
  assert.deepEqual(plain(data.sections[0].items[0]), {
    titleLeft: "Acme Corp", titleRight: "2020 – 2022", subtitleLeft: "Engineer", subtitleRight: "", bullets: [{ text: "Built the billing service" }]
  });
  assert.equal(data.sections[0].items[0].titleLeft, "<b>Acme Corp</b>", "source weight comes from the PDF, as in the local reading");
  assert.deepEqual(plain(data.sections[1].items[0]), { titleLeft: "Languages", titleRight: "", subtitleLeft: "Go, SQL", subtitleRight: "", bullets: [] });
  assert.equal(findings.filter((finding) => finding.kind === "unplaced").length, 0, "the separator and the label colon are structure, not lost text");
});

test("a reworded substring is rejected", () => {
  const reply = valid();
  reply.name = [{ piece: P.name, text: "Jane Q. Doe" }];
  assert.equal(interpretedImport(reply, local).ok, false);
});
test("a corrected spelling is rejected", () => {
  const reply = valid();
  reply.sections[0].entries[0].bullets = [[{ piece: P.bullet, text: "Built the biling service" }]];
  assert.equal(interpretedImport(reply, local).ok, false);
});
test("free text where a reference belongs is rejected", () => {
  const reply = valid();
  reply.name = ["Jane Doe"];
  assert.equal(interpretedImport(reply, local).ok, false);
  reply.name = [{ text: "Jane Doe" }];
  assert.equal(interpretedImport(reply, local).ok, false);
});
test("an unknown piece is rejected", () => {
  const reply = valid();
  reply.sections[0].entries[0].titleRight = ["p9999"];
  assert.equal(interpretedImport(reply, local).ok, false);
});
test("duplicated text is rejected", () => {
  const reply = valid();
  reply.sections[0].entries[0].subtitleLeft = [P.company];
  const outcome = interpretedImport(reply, local);
  assert.equal(outcome.ok, false);
  assert.match(outcome.reason, /same text twice/);
});
test("overlapping parts of one piece are rejected", () => {
  const reply = valid();
  reply.contact = [[{ piece: P.contact, text: "jane@example.test" }], [{ piece: P.contact, text: "jane@example.test | 555-0100" }]];
  assert.equal(interpretedImport(reply, local).ok, false);
});
test("a whole line the reply leaves out is listed under Not placed, never dropped", () => {
  const reply = valid();
  reply.sections[0].entries[0].bullets = [];
  const outcome = interpretedImport(reply, local);
  assert.ok(outcome.ok, outcome.reason);
  const unplaced = outcome.result.findings.filter((finding) => finding.kind === "unplaced").map((finding) => finding.text);
  assert.deepEqual(unplaced, ["Built the billing service"]);
  assert.equal(outcome.result.audit.unplacedWords, 4);
});
test("part of a line cannot be left out: a split must cover its whole piece", () => {
  const reply = valid();
  reply.contact = [[{ piece: P.contact, text: "jane@example.test" }]];
  assert.equal(interpretedImport(reply, local).ok, false);
});
test("parts of one piece cannot be reordered", () => {
  const reply = valid();
  reply.contact = [[{ piece: P.contact, text: "555-0100" }], [{ piece: P.contact, text: "jane@example.test" }]];
  assert.equal(interpretedImport(reply, local).ok, false);
});
test("unknown fields cannot carry text into the document", () => {
  const reply = { ...valid(), summary: "Seasoned leader with 20 years of experience.", notes: [["Invented"]] };
  reply.sections[0].entries[0].rewrite = "Led a team of 40";
  const outcome = interpretedImport(reply, local);
  assert.ok(outcome.ok, outcome.reason);
  assert.ok(!JSON.stringify(outcome.result.data).includes("Seasoned") && !JSON.stringify(outcome.result.data).includes("Led a team"));
});
test("a malformed reply or section type is rejected", () => {
  assert.equal(interpretedImport(null, local).ok, false);
  assert.equal(interpretedImport({ sections: "Experience" }, local).ok, false);
  const reply = valid();
  reply.sections[0].type = "awards";
  assert.equal(interpretedImport(reply, local).ok, false);
});
test("misplaced skills fields fold into the row with a Check", () => {
  const reply = valid();
  reply.sections[1].entries[0] = { titleLeft: [{ piece: P.skillRow, text: "Languages" }], titleRight: [{ piece: P.skillRow, text: "Go, SQL" }] };
  const outcome = interpretedImport(reply, local);
  assert.ok(outcome.ok, outcome.reason);
  assert.equal(outcome.result.data.sections[1].items[0].subtitleLeft, "Go, SQL");
  assert.ok(outcome.result.findings.some((finding) => finding.kind === "check" && /skills row/.test(finding.reason)));
});

// Reviewer-found recombination attacks: every piece of text is verbatim and
// used once, yet the document would say something the PDF does not.
async function attackPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  const text = (value, x, y, size = 10, font = regular) => page.drawText(value, { x, y, size, font });
  text("Jane Doe", 54, 730, 18, bold);
  text("jane@example.test", 54, 712);
  text("EXPERIENCE", 54, 684, 12, bold);
  text("Acme Corp", 54, 668, 10, bold);
  text("2019 – 2021", 500, 668);
  text("Senior Engineer", 54, 655, 10, italic);
  const bullets = [
    "Increased revenue by 15% in 2021",
    "Reduced costs by 2% in 2022",
    "Did not lead the hiring process",
    "Churn moved -15% after the launch",
    "Held a 3:1 hiring ratio and shipped 2019 - 2021 releases"
  ];
  bullets.forEach((value, index) => {
    text("•", 57, 641 - index * 13);
    text(value, 68, 641 - index * 13);
  });
  text("Globex", 54, 560, 10, bold);
  text("2016 – 2019", 500, 560);
  text("Intern", 54, 547, 10, italic);
  text("•", 57, 533);
  text("Unmanaged vendor contracts were audited", 68, 533);
  // An emphasized word is its own run, so its own piece.
  text("•", 57, 520);
  text("Was", 68, 520);
  const notX = 68 + regular.widthOfTextAtSize("Was ", 10);
  text("not", notX, 520, 10, bold);
  text("the release owner", notX + bold.widthOfTextAtSize("not ", 10), 520);
  text("Initech", 54, 495, 10, bold);
  return doc.save();
}
const attackLocal = await importResumePdf(await attackPdf(), pdfjs);
const attackLines = importRequestLines(attackLocal.lines).lines;
const A = (value) => attackLines.flatMap((line) => line.pieces).find((piece) => piece.text === value)?.id;
const s = (piece, text) => ({ piece: A(piece), text });
const attackBase = () => ({
  name: [A("Jane Doe")],
  contact: [[A("jane@example.test")]],
  sections: [{
    heading: [A("EXPERIENCE")],
    type: "standard",
    entries: [
      {
        titleLeft: [A("Acme Corp")], titleRight: [A("2019 – 2021")], subtitleLeft: [A("Senior Engineer")],
        bullets: [
          [A("Increased revenue by 15% in 2021")], [A("Reduced costs by 2% in 2022")], [A("Did not lead the hiring process")],
          [A("Churn moved -15% after the launch")], [A("Held a 3:1 hiring ratio and shipped 2019 - 2021 releases")]
        ]
      },
      {
        titleLeft: [A("Globex")], titleRight: [A("2016 – 2019")], subtitleLeft: [A("Intern")],
        bullets: [[A("Unmanaged vendor contracts were audited")], [A("Was"), A("not"), A("the release owner")]]
      }
    ]
  }]
});
const checks = (outcome, pattern) =>
  outcome.result.findings.filter((finding) => finding.kind === "check" && pattern.test(finding.reason)).map((finding) => stripInlineMarks(finding.source));
test("the attack fixture's faithful reply is accepted", () => {
  const outcome = interpretedImport(attackBase(), attackLocal);
  assert.ok(outcome.ok, outcome.reason);
  assert.deepEqual(checks(outcome, /./), []);
});
const B1 = "Increased revenue by 15% in 2021";
const B2 = "Reduced costs by 2% in 2022";
const RATIO = "Held a 3:1 hiring ratio and shipped 2019 - 2021 releases";
// Each attack names the guard that must stop it, so losing one guard fails here
// even when a later check would still have caught the reply.
const attacks = {
  "metrics swapped between bullets": [/joined part of a line/, (r) => {
    r.sections[0].entries[0].bullets[0] = [s(B1, "Increased revenue by"), s(B2, "2%"), s(B1, "in 2021")];
    r.sections[0].entries[0].bullets[1] = [s(B2, "Reduced costs by"), s(B1, "15%"), s(B2, "in 2022")];
  }],
  "a sentence spliced from two bullets, the leftovers parked in the header and another entry": [/joined part of a line/, (r) => {
    r.contact.push([s(B2, "Reduced costs by")]);
    r.sections[0].entries[0].bullets.splice(0, 2, [s(B1, "Increased revenue by"), s(B2, "2% in 2022")]);
    r.sections[0].entries[1].titleLeft = [s(B1, "15% in 2021"), A("Globex")];
  }],
  "a negation deleted mid-sentence": [/drops or moves words/, (r) => {
    r.sections[0].entries[0].bullets[2] = [s("Did not lead the hiring process", "Did"), s("Did not lead the hiring process", "lead the hiring process")];
  }],
  "an emphasized negation skipped inside a field": [/left words out of the middle/, (r) => {
    r.sections[0].entries[1].bullets[1] = [A("Was"), A("the release owner")];
  }],
  "a minus sign dropped": [/drops or moves words/, (r) => {
    r.sections[0].entries[0].bullets[3] = [s("Churn moved -15% after the launch", "Churn moved"), s("Churn moved -15% after the launch", "15% after the launch")];
  }],
  "a date range reversed inside one field": [/parts of a line out of order/, (r) => {
    r.sections[0].entries[0].titleRight = [s("2019 – 2021", "2021"), s("2019 – 2021", "–"), s("2019 – 2021", "2019")];
  }],
  "whole pieces reversed inside one field": [/reordered text within a field/, (r) => {
    r.sections[0].entries[1].bullets[1] = [A("the release owner"), A("not"), A("Was")];
  }],
  "a negating prefix stripped from a word": [/drops or moves words/, (r) => {
    r.sections[0].entries[1].bullets[0] = [s("Unmanaged vendor contracts were audited", "managed vendor contracts were audited")];
  }],
  "dates swapped across entries by substrings": [/./, (r) => {
    r.sections[0].entries[0].titleRight = [s("2016 – 2019", "2016"), s("2019 – 2021", "–"), s("2019 – 2021", "2021")];
    r.sections[0].entries[1].titleRight = [s("2019 – 2021", "2019"), s("2016 – 2019", "–"), s("2016 – 2019", "2019")];
  }],
  "a ratio's colon dropped inside one field": [/separator inside a field/, (r) => {
    r.sections[0].entries[0].bullets[4] = [s(RATIO, "Held a 3"), s(RATIO, "1 hiring ratio and shipped 2019 - 2021 releases")];
  }],
  // Words skipped inside the segment a field leaves, or the one it enters.
  "words skipped at the start of the segment a field enters": [/left words out of the middle/, (r) => {
    r.sections[0].entries[1].subtitleLeft = [A("Intern"), A("the release owner")];
    r.sections[0].entries[1].bullets[1] = [A("Was"), A("not")];
  }],
  "words skipped at the end of the segment a field leaves": [/left words out of the middle/, (r) => {
    r.sections[0].entries[1].bullets.splice(1, 1, [A("Was"), A("Initech")], [A("not"), A("the release owner")]);
  }],
  "a ratio split at its colon into two bullets": [/split a value at a colon/, (r) => {
    r.sections[0].entries[0].bullets.splice(4, 1, [s(RATIO, "Held a 3")], [s(RATIO, "1 hiring ratio and shipped 2019 - 2021 releases")]);
  }],
  // Each half of the junction rule alone: only the earlier piece is cut short,
  // or only the later one starts late.
  "a line cut short and joined to the next": [/joined part of a line/, (r) => {
    r.sections[0].entries[0].bullets.splice(0, 2, [s(B1, "Increased revenue by"), A(B2)], [s(B1, "15% in 2021")]);
  }],
  "a line joined from its middle": [/joined part of a line/, (r) => {
    r.contact.push([s(B2, "Reduced costs by")]);
    r.sections[0].entries[0].bullets.splice(0, 2, [A(B1), s(B2, "2% in 2022")]);
  }]
};
for (const [label, [reason, mutate]] of Object.entries(attacks)) {
  test(`recombination is rejected: ${label}`, () => {
    const reply = attackBase();
    mutate(reply);
    const outcome = interpretedImport(reply, attackLocal);
    assert.equal(outcome.ok, false, `accepted: ${outcome.ok ? JSON.stringify(outcome.result.data.sections[0].items.map((item) => item.bullets.map((bullet) => bullet.text))) : ""}`);
    assert.match(outcome.reason, reason);
  });
}
test("swapped whole pieces are accepted with a Check on both, and only both", () => {
  const reply = attackBase();
  reply.sections[0].entries[0].subtitleLeft = [A("Intern")];
  reply.sections[0].entries[1].subtitleLeft = [A("Senior Engineer")];
  const outcome = interpretedImport(reply, attackLocal);
  assert.ok(outcome.ok, outcome.reason);
  assert.deepEqual(checks(outcome, /reading order/).sort(), ["Intern", "Senior Engineer"]);
});
test("a whole piece moved into the header or split into a new section is flagged", () => {
  const intoHeader = attackBase();
  intoHeader.contact.push([A("2016 – 2019")]);
  intoHeader.sections[0].entries[1].titleRight = [];
  const header = interpretedImport(intoHeader, attackLocal);
  assert.ok(header.ok, header.reason);
  assert.deepEqual(checks(header, /reading order/), ["2016 – 2019"]);

  const split = attackBase();
  const [acme, globex] = split.sections[0].entries;
  acme.titleRight = [A("2016 – 2019")];
  split.sections[0].entries = [acme];
  split.sections.push({
    heading: [], type: "standard",
    entries: [{ ...globex, titleLeft: [A("2019 – 2021")], titleRight: [], subtitleLeft: [A("Globex"), A("Intern")] }]
  });
  const outcome = interpretedImport(split, attackLocal);
  assert.ok(outcome.ok, outcome.reason);
  assert.deepEqual(checks(outcome, /reading order/).sort(), ["2016 – 2019", "2019 – 2021"]);
});
test("a date moved into the field ending on the line above gets a Check", () => {
  const intoBullet = attackBase();
  intoBullet.sections[0].entries[0].bullets[4] = [A(RATIO), A("2016 – 2019")];
  intoBullet.sections[0].entries[1].titleRight = [];
  const bullet = interpretedImport(intoBullet, attackLocal);
  assert.ok(bullet.ok, bullet.reason);
  assert.ok(checks(bullet, /reading order/).includes(`${RATIO} 2016 – 2019`), JSON.stringify(checks(bullet, /./)));

  const intoHeading = attackBase();
  intoHeading.sections[0].heading = [A("EXPERIENCE"), A("2019 – 2021")];
  intoHeading.sections[0].entries[0].titleRight = [];
  const heading = interpretedImport(intoHeading, attackLocal);
  assert.ok(heading.ok, heading.reason);
  assert.ok(checks(heading, /reading order/).includes("EXPERIENCE 2019 – 2021"), JSON.stringify(checks(heading, /./)));
});

async function wrappedDatePdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const text = (value, x, y, size = 10, font = regular) => page.drawText(value, { x, y, size, font });
  text("Jane Doe", 54, 730, 18, bold);
  text("jane@example.test", 54, 712);
  text("EXPERIENCE", 54, 684, 12, bold);
  text("Acme Corp", 54, 668, 10, bold);
  text("Jan 2014 –", 480, 668);
  text("Senior Engineer", 54, 655);
  text("Present", 480, 655);
  text("•", 57, 641);
  text("Built the billing service for partners", 68, 641);
  return doc.save();
}
const wrappedDateLocal = await importResumePdf(await wrappedDatePdf(), pdfjs);
const D = (value) => importRequestLines(wrappedDateLocal.lines).lines.flatMap((line) => line.pieces).find((piece) => piece.text === value)?.id;
test("a right-hand date wrapped past the next row's start is one stretch: no Check on an honest reply", () => {
  const outcome = interpretedImport({
    name: [D("Jane Doe")], contact: [[D("jane@example.test")]],
    sections: [{
      heading: [D("EXPERIENCE")], type: "standard",
      entries: [{ titleLeft: [D("Acme Corp")], titleRight: [D("Jan 2014 –"), D("Present")], subtitleLeft: [D("Senior Engineer")], bullets: [[D("Built the billing service for partners")]] }]
    }]
  }, wrappedDateLocal);
  assert.ok(outcome.ok, outcome.reason);
  assert.deepEqual(checks(outcome, /./), []);
});

test("a field that passes over a line nothing uses gets a Check", () => {
  const reply = attackBase();
  reply.sections[0].entries[0].bullets.splice(0, 3, [A(B1), A("Did not lead the hiring process")]);
  const outcome = interpretedImport(reply, attackLocal);
  assert.ok(outcome.ok, outcome.reason);
  assert.deepEqual(checks(outcome, /left out/), [`${B1} Did not lead the hiring process`]);
  assert.ok(outcome.result.findings.some((finding) => finding.kind === "unplaced" && finding.text === B2));
});

// Whole lines appended across text that other fields use: every stretch of a
// field is order-checked, not only its first piece.
async function wrappedPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const text = (value, x, y, size = 10, font = regular) => page.drawText(value, { x, y, size, font });
  text("Jane Doe", 54, 730, 18, bold);
  text("jane@example.test", 54, 712);
  text("EDUCATION", 54, 684, 12, bold);
  text("State University", 54, 668, 10, bold);
  text("2012 – 2016", 500, 668);
  text("BS Computer Science", 54, 655);
  text("EXPERIENCE", 54, 627, 12, bold);
  text("Acme Corp", 54, 611, 10, bold);
  text("2019 – 2021", 500, 611);
  text("Senior Engineer", 54, 598);
  [["Cut infrastructure spend across the platform group's build and test fleet by", "5% for the internal tools team"],
    ["Grew partner revenue through the new integrations marketplace launch by", "40% across all regions in 2021"]].forEach(([first, second], index) => {
    text("•", 57, 584 - index * 26);
    text(first, 68, 584 - index * 26);
    text(second, 68, 571 - index * 26);
  });
  return doc.save();
}
const wrappedLocal = await importResumePdf(await wrappedPdf(), pdfjs);
const wrappedLines = importRequestLines(wrappedLocal.lines).lines;
const W = (value) => wrappedLines.flatMap((line) => line.pieces).find((piece) => piece.text.startsWith(value))?.id;
const wrappedBase = () => ({
  name: [W("Jane Doe")],
  contact: [[W("jane@")]],
  sections: [
    { heading: [W("EDUCATION")], type: "standard", entries: [{ titleLeft: [W("State University")], titleRight: [W("2012")], subtitleLeft: [W("BS Computer")] }] },
    {
      heading: [W("EXPERIENCE")], type: "standard",
      entries: [{ titleLeft: [W("Acme Corp")], titleRight: [W("2019")], subtitleLeft: [W("Senior Engineer")], bullets: [[W("Cut"), W("5%")], [W("Grew"), W("40%")]] }]
    }
  ]
});
test("the wrapped fixture's faithful reply is accepted without Checks", () => {
  const outcome = interpretedImport(wrappedBase(), wrappedLocal);
  assert.ok(outcome.ok, outcome.reason);
  assert.deepEqual(checks(outcome, /./), []);
});
test("one bullet's first line joined to another's second line gets a Check", () => {
  const reply = wrappedBase();
  reply.sections[1].entries[0].bullets = [[W("Cut"), W("40%")], [W("5%"), W("Grew")]];
  const outcome = interpretedImport(reply, wrappedLocal);
  assert.ok(outcome.ok, outcome.reason);
  const flagged = checks(outcome, /reading order/);
  assert.ok(flagged.some((text) => text.startsWith("Cut infrastructure") && text.endsWith("40% across all regions in 2021")), JSON.stringify(flagged));
});
test("whole lines interleaved one apart get Checks", () => {
  const reply = wrappedBase();
  reply.sections[1].entries[0].bullets = [[W("Cut"), W("Grew")], [W("5%"), W("40%")]];
  const outcome = interpretedImport(reply, wrappedLocal);
  assert.ok(outcome.ok, outcome.reason);
  assert.equal(checks(outcome, /reading order/).length, 2, JSON.stringify(checks(outcome, /./)));
});
test("a title wrapped beside its date is one stretch: no Check on an honest reply", () => {
  const reply = wrappedBase();
  // "State University" shares its line with "2012 – 2016"; the degree line
  // below continues the title past the date.
  reply.sections[0].entries[0] = { titleLeft: [W("State University"), W("BS Computer")], titleRight: [W("2012")] };
  const outcome = interpretedImport(reply, wrappedLocal);
  assert.ok(outcome.ok, outcome.reason);
  assert.deepEqual(checks(outcome, /./), []);
});
test("a job's date appended to an Education field gets a Check", () => {
  const reply = wrappedBase();
  reply.sections[0].entries[0].subtitleLeft = [W("BS Computer"), W("2019")];
  reply.sections[1].entries[0].titleRight = [];
  const outcome = interpretedImport(reply, wrappedLocal);
  assert.ok(outcome.ok, outcome.reason);
  assert.deepEqual(checks(outcome, /reading order/), ["BS Computer Science 2019 – 2021"]);
});

async function sidebarPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const text = (value, x, y, size = 10, font = regular) => page.drawText(value, { x, y, size, font });
  text("Priya Natarajan", 54, 730, 22, bold);
  text("EXPERIENCE", 54, 690, 11, bold);
  text("SKILLS", 430, 690, 11, bold);
  ["Hooli", "Product Designer, 2019 – 2023", "Redesigned onboarding for 2M monthly users", "Ran 40 usability sessions with partners",
    "Pied Piper", "UX Designer, 2015 – 2019", "Shipped the first mobile app and its system", "Built the shared research repository"]
    .forEach((value, index) => text(value, 54, 674 - index * 14, 10, index % 4 === 0 ? bold : regular));
  ["Figma", "Prototyping", "User research", "HTML and CSS", "React", "Accessibility", "Design systems", "Workshops"]
    .forEach((value, index) => text(value, 430, 674 - index * 14));
  return doc.save();
}
const sidebarLocal = await importResumePdf(await sidebarPdf(), pdfjs);
const sidebarLines = importRequestLines(sidebarLocal.lines).lines;
const S = (value) => sidebarLines.flatMap((line) => line.pieces).find((piece) => piece.text === value)?.id;
const SIDE = ["Figma", "Prototyping", "User research", "HTML and CSS", "React", "Accessibility", "Design systems", "Workshops"];
const sidebarBase = () => ({
  name: [S("Priya Natarajan")],
  sections: [
    { heading: [S("SKILLS")], type: "skills", entries: SIDE.map((value) => ({ subtitleLeft: [S(value)] })) },
    {
      heading: [S("EXPERIENCE")], type: "standard",
      entries: [["Hooli", "Product Designer, 2019 – 2023", "Redesigned onboarding for 2M monthly users", "Ran 40 usability sessions with partners"],
        ["Pied Piper", "UX Designer, 2015 – 2019", "Shipped the first mobile app and its system", "Built the shared research repository"]]
        .map(([company, role, ...bullets]) => ({ titleLeft: [S(company)], subtitleLeft: [S(role)], bullets: bullets.map((value) => [S(value)]) }))
    }
  ]
});
// Two pages, each a full-width top band over two columns on one baseline grid.
async function twoPageSidebarPdf() {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const [index, top] of ["priya@example.test · 555-0100 · Boston, MA · linkedin.com/in/priya-natarajan · priya-designs.example.test",
    "Priya Natarajan · Senior Product Designer · Resume, page 2 of 2 · priya@example.test · 555-0100"].entries()) {
    const page = doc.addPage([612, 792]);
    const text = (value, x, y, size = 10, font = regular) => page.drawText(value, { x, y, size, font });
    if (index === 0) text("Priya Natarajan", 54, 740, 22, bold);
    text(top, 54, 712);
    text(index ? "MORE EXPERIENCE" : "EXPERIENCE", 54, 690, 11, bold);
    text(index ? "INTERESTS" : "SKILLS", 430, 690, 11, bold);
    ["Hooli", "Product Designer, 2019 – 2023", "Redesigned onboarding for 2M monthly users", "Ran 40 usability sessions with partners",
      "Pied Piper", "UX Designer, 2015 – 2019", "Shipped the first mobile app and its system", "Built the shared research repository"]
      .forEach((value, row) => text(index ? `${value} (${index + 1})` : value, 54, 674 - row * 14, 10, row % 4 === 0 ? bold : regular));
    ["Figma", "Prototyping", "User research", "HTML and CSS", "React", "Accessibility", "Design systems", "Workshops"]
      .forEach((value, row) => text(index ? `${value} ${index + 1}` : value, 430, 674 - row * 14));
  }
  return doc.save();
}
test("text from another page's top band gets a Check", async () => {
  const local = await importResumePdf(await twoPageSidebarPdf(), pdfjs);
  const requestLines = importRequestLines(local.lines).lines;
  const piece = (prefix) => requestLines.flatMap((line) => line.pieces).find((candidate) => candidate.text.startsWith(prefix))?.id;
  assert.deepEqual(requestLines.filter((line) => line.region === "top").map((line) => line.page), [1, 1, 2]);
  const reply = {
    name: [piece("Priya Natarajan")],
    contact: [[piece("priya@example.test ·"), piece("Priya Natarajan ·")]],
    sections: []
  };
  const outcome = interpretedImport(reply, local);
  assert.ok(outcome.ok, outcome.reason);
  assert.equal(checks(outcome, /different columns/).length, 1, JSON.stringify(checks(outcome, /./)));
});

// Each reply in both section orders, so no case passes only because the
// sidebar happens to be placed first.
const bothOrders = (mutate) => [false, true].map((sidebarFirst) => {
  const reply = sidebarBase();
  mutate(reply);
  if (!sidebarFirst) reply.sections.reverse();
  const outcome = interpretedImport(reply, sidebarLocal);
  assert.ok(outcome.ok, outcome.reason);
  return outcome;
});
const experience = (reply) => reply.sections.find((section) => section.type === "standard");
test("a faithful two-column reply is accepted without Checks in either section order", () => {
  assert.deepEqual([...new Set(sidebarLines.map((line) => line.region))].sort(), ["left", "right"]);
  for (const outcome of bothOrders(() => {})) assert.deepEqual(checks(outcome, /./), []);
});
test("a line taken from another column gets a Check in either section order", () => {
  const cases = {
    // The left column's last line runs straight into the sidebar's heading.
    "the sidebar's first line": [(reply) => {
      reply.sections[0].heading = [];
      experience(reply).entries[1].bullets[1].push(S("SKILLS"));
    }, "Built the shared research repository SKILLS"],
    "the sidebar's last line": [(reply) => {
      reply.sections[0].entries.pop();
      experience(reply).entries[1].bullets[1].push(S("Workshops"));
    }, "Built the shared research repository Workshops"],
    "a middle line, passing over lines other fields use": [(reply) => {
      reply.sections[0].entries.splice(4, 1);
      experience(reply).entries[0].bullets[0].push(S("React"));
    }, "Redesigned onboarding for 2M monthly users React"]
  };
  for (const [label, [mutate, text]] of Object.entries(cases)) {
    for (const outcome of bothOrders(mutate)) assert.deepEqual(checks(outcome, /different columns/), [text], label);
  }
});

for (const [name, fn] of cases) {
  try {
    await fn();
    passed += 1;
  } catch (error) {
    console.error(`FAIL ${name}\n  ${error.message}`);
    process.exitCode = 1;
  }
}
console.log(`pdf-import-interpretation: ${passed}/${cases.length} passed`);
