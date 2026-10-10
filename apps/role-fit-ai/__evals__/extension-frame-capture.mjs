import assert from "node:assert/strict";
import { extractPageData } from "../extension/bridge.js";

// The generic capture reads same-origin frame text directly and lists frame
// addresses for the server; a cross-origin frame's contentDocument is null, as
// in a real browser. All content is synthetic.

const PAGE_URL = "https://www.brand.example/careers/backend-engineer";
const postingText = "Backend Engineer. Build and operate payment services, review code, and improve reliability. ".repeat(3);

function frame(src, bodyText) {
  return { src, contentDocument: bodyText === undefined ? null : { body: { innerText: bodyText } } };
}

function capture({ bodyText = "Brand careers. Apply below.", frames = [], selectorText = "" } = {}) {
  globalThis.location = new URL(PAGE_URL);
  globalThis.document = {
    title: "Backend Engineer | Brand",
    body: { innerText: bodyText },
    querySelector: (selector) => (selector === "#content" && selectorText ? { innerText: selectorText } : null),
    querySelectorAll: (selector) => (selector === "iframe" ? frames : [])
  };
  return extractPageData();
}

let failures = 0;
function probe(name, run) {
  try {
    run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${name}: ${error?.message ?? error}`);
  }
}

probe("a page without frames captures exactly as before, with no frame addresses", () => {
  const page = capture({ bodyText: postingText });
  assert.deepEqual(page, { text: postingText, url: PAGE_URL, title: "Backend Engineer | Brand", frameUrls: [] });
});

probe("a same-origin frame's posting text is appended to the page text", () => {
  const page = capture({ frames: [frame("https://www.brand.example/apply/frame", postingText)] });
  assert.equal(page.text, `Brand careers. Apply below.\n\n${postingText.trim()}`);
  assert.deepEqual(page.frameUrls, ["https://www.brand.example/apply/frame"]);
});

probe("a cross-origin frame contributes its address but no text", () => {
  const board = "https://job-boards.greenhouse.io/embed/job_app?for=brandco&token=5550006006";
  const page = capture({ frames: [frame(board)] });
  assert.equal(page.text, "Brand careers. Apply below.");
  assert.deepEqual(page.frameUrls, [board]);
});

probe("short frame text, blank or non-http frames, duplicates, and overflow are dropped", () => {
  const frames = [
    frame("https://www.brand.example/consent", "Accept cookies"),
    frame("about:blank", postingText),
    frame("javascript:void(0)"),
    frame(""),
    frame(`https://long.example/${"x".repeat(2_000)}`),
    ...Array.from({ length: 10 }, (_, i) => frame(`https://f${i % 9}.example/`))
  ];
  const page = capture({ frames });
  assert.equal(page.text, `Brand careers. Apply below.\n\n${postingText.trim()}`, "only readable frame text over 100 characters joins");
  assert.deepEqual(page.frameUrls, [
    "https://www.brand.example/consent",
    ...Array.from({ length: 7 }, (_, i) => `https://f${i}.example/`)
  ]);
});

probe("a matched description selector wins over frame text but still lists frames", () => {
  const selectorText = "Selected posting description. ".repeat(5);
  const page = capture({ selectorText, frames: [frame("https://www.brand.example/apply/frame", postingText)] });
  assert.equal(page.text, selectorText.trim());
  assert.deepEqual(page.frameUrls, ["https://www.brand.example/apply/frame"]);
});

probe("frame text stays inside the 50,000-character capture limit", () => {
  const page = capture({ bodyText: "a".repeat(49_990), frames: [frame("https://www.brand.example/f", postingText)] });
  assert.equal(page.text.length, 50_000);
});

if (failures) {
  console.log(`${failures} extension frame capture probe(s) failed`);
  process.exitCode = 1;
} else {
  console.log("PASS extension frame capture probes");
}
