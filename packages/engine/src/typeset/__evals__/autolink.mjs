// Automatic link detection: only phone-shaped text becomes a tel: link. Dates,
// year ranges, bare counts, and decimals are ordinary resume text.
import assert from "node:assert/strict";
import { DOC_STYLE_DEFAULTS } from "../../lib/documentStyle.ts";
import { automaticLinkHref, decodeLinkHref, normalizeLinkDestination } from "../../lib/links.ts";
import { layoutResume } from "../layout.ts";

for (const [text, href] of [
  ["(917) 768-8848", "tel:9177688848"],
  ["917-768-8848", "tel:9177688848"],
  ["917.768.8848", "tel:9177688848"],
  ["917 768 8848", "tel:9177688848"],
  ["+1 917-768-8848", "tel:+19177688848"],
  ["+1 (212) 555-0100", "tel:+12125550100"],
  ["+1 (212) 555-0100 ext 42", "tel:+12125550100;ext=42"],
  ["+16465550199", "tel:+16465550199"],
  ["+44 20 7946 0958", "tel:+442079460958"],
  ["020 7946 0958", "tel:02079460958"],
  ["(020) 79460958", "tel:02079460958"],
  // Formats that linked before the date/year guard must keep linking.
  ["5551234567", "tel:5551234567"],
  ["555-1234", "tel:5551234"],
  ["06 12 34 56 78", "tel:0612345678"],
  ["030 12345678", "tel:03012345678"],
  ["+1 555 2019 2024", "tel:+155520192024"]
]) {
  assert.equal(automaticLinkHref(text), href, `${text} auto-links as a phone`);
}

for (const text of [
  "2019-2024",
  "2022 - 2026",
  "(2020-2024)",
  "(2020) 2024",
  "2019 - 2024 - 2025",
  "1234567",
  "12345678",
  "3.14159265",
  "+3.14159265",
  "2026-07-29",
  "2026 07 29",
  "12.05.2024",
  "01-15-2024",
  "1/15/2024"
]) {
  assert.equal(automaticLinkHref(text), null, `${text} must not auto-link`);
}

// Explicit and stored destinations keep their own rules: the user chose a tel:.
assert.equal(normalizeLinkDestination("tel:9177688848"), "tel:9177688848");
assert.equal(decodeLinkHref(encodeURIComponent("tel:+12125550100;ext=42")), "tel:+12125550100;ext=42");

// Every layout surface that auto-links (entry head fields, body words, header
// contacts) agrees, so no renderer paints a year range as a link.
const layout = layoutResume({
  header: { name: "Name", contact: ["(917) 768-8848", "2019-2024"] },
  sections: [{
    id: "s", type: "standard", heading: "Experience", items: [{
      id: "e", titleLeft: "Engineer", titleRight: "2019 - 2024", subtitleLeft: "Company (2020-2024)", subtitleRight: "<i>2022 - 2026</i>",
      bullets: ["Shipped 1234567 builds 2019-2024 at 3.14159265 scale; call 917-768-8848."], bulletIds: ["b"]
    }]
  }]
}, DOC_STYLE_DEFAULTS);
const linked = layout.pages.flatMap((page) => page.lines).flatMap((line) => line.runs).filter((run) => run.href);
assert.deepEqual(
  linked.map((run) => [run.text, run.href]),
  [["(917) 768-8848", "tel:9177688848"], ["917-768-8848.", "tel:9177688848"]],
  "only phone-shaped layout text carries a tel: destination"
);

console.log("automatic phone-link detection checks passed");
