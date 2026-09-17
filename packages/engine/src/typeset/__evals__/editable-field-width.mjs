import assert from "node:assert/strict";
import { layoutResume, layoutCoverLetter } from "../layout.ts";
import { DOC_STYLE_DEFAULTS } from "../../lib/documentStyle.ts";
import { toTypesetSchema } from "../schema.ts";
import { coverLetterResumeData } from "../../lib/coverLetter.ts";

// Inventory follows FieldSrc plus its real summary/cover and skills adapters.
const targets = ["name", "contact", "heading", "titleLeft", "titleRight", "subtitleLeft", "subtitleRight",
  "skillsLabel", "skillsValue", "summary", "bullet", "cover"];
for (const target of targets) for (const length of [80, 512, 4096]) for (const spaced of [false, true]) {
  const text = spaced ? "wrap words ".repeat(Math.ceil(length/11)).slice(0,length) : "W".repeat(length);
  const entry = { id: "e", titleLeft: "", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: [] };
  const section = { id: "s", type: target.startsWith("skills") ? "skills" : target === "summary" ? "summary" : "standard",
    heading: target === "heading" ? text : "Section", items: [entry] };
  if (target === "skillsLabel") { entry.titleLeft = text; entry.subtitleLeft = "value"; }
  if (target === "skillsValue") { entry.titleLeft = "Label"; entry.subtitleLeft = text; }
  if (target === "summary" || target === "bullet") entry.bullets = [{ id: "b", text }];
  if (["titleLeft", "titleRight", "subtitleLeft", "subtitleRight"].includes(target)) entry[target] = text;
  const data = target === "cover" ? coverLetterResumeData([text]) : {
    header: { name: target === "name" ? text : "Name", contact: [target === "contact" ? text : "contact@example.test"] }, sections: [section]
  };
  const before = JSON.stringify(data);
  const doc = (target === "cover" ? layoutCoverLetter : layoutResume)(toTypesetSchema(data), DOC_STYLE_DEFAULTS);
  assert.equal(JSON.stringify(data), before, "layout does not mutate authored data");
  for (const page of doc.pages) for (const line of page.lines) for (const run of line.runs) {
    if (run.marker) continue;
    assert(run.x >= doc.geometry.marginLeft - 1e-6 && run.x + run.width <= 612 - doc.geometry.marginRight + 1e-6,
      `${target}/${length}/${spaced ? "spaced" : "token"} stays inside text margins`);
  }
}
console.log("editable field width inventory: 72 name/contact/section/entry/skills/summary/bullet/cover cases passed");
