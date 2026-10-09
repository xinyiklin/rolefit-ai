import assert from "node:assert/strict";
import { extractPageData } from "../extension/bridge.js";
import { resolveImportedJobText } from "../server/jobImport.ts";

// Signed-in Handshake postings reach RoleFit only through the extension's page
// capture. The stub reproduces the layout observed on live postings
// (2026-10-08) with synthetic content: one posting pane, a description
// shortened behind a re-rendering "view-more-button" toggle, then Similar Jobs
// and alumni profiles.

class FakeElement {
  constructor(tag, { attrs = {}, text = "", onClick } = {}, children = []) {
    this.tagName = tag.toUpperCase();
    this.attrs = attrs;
    this.text = text;
    this.onClick = onClick;
    this.parentElement = null;
    this.children = [];
    for (const child of children) this.append(child);
  }
  append(child) {
    child.parentElement = this;
    this.children.push(child);
  }
  get firstElementChild() { return this.children[0] ?? null; }
  get innerText() {
    const own = typeof this.text === "function" ? this.text() : this.text;
    return [own, ...this.children.map((child) => child.innerText)].filter(Boolean).join("\n");
  }
  get pathname() {
    const href = this.getAttribute("href");
    return this.tagName === "A" && href ? new URL(href, globalThis.location.origin).pathname : "";
  }
  get form() { return this.tagName === "BUTTON" ? this.closest("form") : undefined; }
  getAttribute(name) { return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null; }
  click() { this.onClick?.(); }
  *descendants() {
    for (const child of this.children) {
      yield child;
      yield* child.descendants();
    }
  }
  querySelectorAll(selector) {
    const list = parseSelectorList(selector);
    return [...this.descendants()].filter((element) => list.some((part) => matches(element, part)));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  closest(selector) {
    const list = parseSelectorList(selector);
    for (let element = this; element; element = element.parentElement) {
      if (list.some((part) => matches(element, part))) return element;
    }
    return null;
  }
}

// Compound selectors only; anything else throws so the stub never silently misses.
const ATTRIBUTE = /\[([\w-]+)(?:([\^*]?=)"([^"]*)")?\]/g;
function parseSelectorList(selector) {
  return selector.split(",").map((raw) => {
    const part = raw.trim();
    const bare = part.replace(ATTRIBUTE, "");
    const tag = bare.match(/^[a-z][a-z0-9]*/i)?.[0] ?? "";
    assert.equal(bare.slice(tag.length).replace(/[.#][\w-]+/g, ""), "", `unsupported selector: ${part}`);
    return {
      tag,
      classes: [...bare.matchAll(/\.([\w-]+)/g)].map((match) => match[1]),
      ids: [...bare.matchAll(/#([\w-]+)/g)].map((match) => match[1]),
      attrs: [...part.matchAll(ATTRIBUTE)].map(([, name, op, value]) => ({ name, op, value }))
    };
  });
}
function matches(element, { tag, classes, ids, attrs }) {
  if (tag && element.tagName !== tag.toUpperCase()) return false;
  const classList = (element.getAttribute("class") ?? "").split(/\s+/);
  if (!classes.every((name) => classList.includes(name))) return false;
  if (!ids.every((id) => element.getAttribute("id") === id)) return false;
  return attrs.every(({ name, op, value }) => {
    const actual = element.getAttribute(name);
    if (actual === null) return false;
    if (!op) return true;
    if (op === "=") return actual === value;
    return op === "^=" ? actual.startsWith(value) : actual.includes(value);
  });
}

const el = (tag, options, children) => new FakeElement(tag, options, children);

function installPage(url, title, body) {
  const parsed = new URL(url);
  globalThis.location = { hostname: parsed.hostname, pathname: parsed.pathname, origin: parsed.origin, href: parsed.href };
  globalThis.document = { title, body, querySelector: (selector) => body.querySelector(selector) };
}

// Like the live page, a toggle applies after the click returns and renders a
// new button; the detached one no longer responds.
function collapsible({ short, full, expanded = false, works = true }) {
  const state = { expanded, clicks: 0 };
  const holder = el("div", {}, [el("div", { text: () => (state.expanded ? full : short) })]);
  const toggle = () => {
    const button = el("button", {
      attrs: { class: "rosetta-button view-more-button" },
      text: state.expanded ? "Less" : "More",
      onClick: () => {
        if (!button.parentElement) return;
        state.clicks += 1;
        if (!works) return;
        setTimeout(() => {
          state.expanded = !state.expanded;
          holder.children.splice(holder.children.indexOf(button), 1);
          button.parentElement = null;
          holder.append(toggle());
        }, 20);
      }
    });
    return button;
  };
  holder.append(toggle());
  return { holder, state };
}

const ORIGIN = "https://school.joinhandshake.com";
const ROLE = "Platform Engineer - Data Tools";
const EMPLOYER = "Example Clinic Co";
const SHORT = "We build scheduling tools for community clinics...";
const FULL = "We build scheduling tools for community clinics.\n" +
  "You will maintain data pipelines in Python and SQL.\n" +
  "This role is hybrid, three days per week in the office.";

function handshakeBody({
  hook = "job-details-page",
  jobLink = "/jobs/1000001?searchId=abc",
  role = ROLE,
  employer = EMPLOYER,
  expanded = false,
  works = true,
  description = FULL,
  alumniFirst = false,
  extraSections = []
} = {}) {
  const posting = collapsible({ short: SHORT, full: description, expanded, works });
  const similar = el("div", {}, [
    el("h3", { text: "Similar Jobs" }),
    el("div", { text: "Other Employer\nStaff Platform Engineer" }),
    el("button", { attrs: { "data-hook": "similar-job-bookmark-action" } })
  ]);
  const alumni = el("div", {}, [
    el("h2", { text: "Alumni in similar roles" }),
    el("a", { attrs: { href: "/profiles/2" }, text: "Pat Example" })
  ]);
  const sections = [
    el("div", {}, [
      el("a", { attrs: { href: "/e/1", "aria-label": employer } }),
      el("a", { attrs: { href: "/e/1", "aria-label": employer }, text: employer }),
      el("a", { attrs: { href: jobLink } }, [el("h1", { text: role })])
    ]),
    el("div", { text: "Save\nShare\nQuick apply" }),
    el("div", {}, [el("h3", { text: "At a glance" }), el("div", { text: "$90–120K/yr\nHybrid, based in Springfield" })]),
    el("div", {}, [el("div", {}, [el("h3", { text: "Job description" })]), posting.holder]),
    el("div", {}, [
      el("h3", { text: "What they're looking for" }),
      el("div", { text: "Graduates by December 2027\nMathematics major" }),
      el("a", { attrs: { href: "/users/1" }, text: "Update profile." })
    ]),
    ...extraSections,
    ...(alumniFirst ? [alumni, similar] : [similar, alumni])
  ];
  const pane = el("div", { attrs: { "data-hook": hook } }, [el("div", {}, [el("div", {}, sections)])]);
  return { body: el("body", {}, [el("nav", { text: "Home\nJobs\nInbox" }), pane]), state: posting.state };
}

let failures = 0;
async function probe(name, run) {
  try {
    await run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${name}: ${error?.message ?? error}`);
  }
}

function assertPostingOnly(text) {
  assert.match(text, /three days per week/, "the expanded description is captured");
  assert.match(text, /Graduates by December 2027/, "the employer's qualifications are captured");
  assert.doesNotMatch(text, /Staff Platform Engineer|Other Employer/, "similar jobs are not captured");
  assert.doesNotMatch(text, /Pat Example/, "other students' profiles are not captured");
  assert.doesNotMatch(text, /Inbox/, "site navigation is not captured");
}

await probe("a collapsed Handshake job page is expanded and captured with its canonical URL", async () => {
  const { body, state } = handshakeBody();
  installPage(`${ORIGIN}/jobs/1000001?searchId=abc`, `${ROLE} | ${EMPLOYER} | Handshake`, body);
  const page = await extractPageData();
  assertPostingOnly(page.text);
  assert.equal(page.url, `${ORIGIN}/jobs/1000001`);
  assert.equal(page.title, `${ROLE} | ${EMPLOYER} | Handshake`);
  assert.deepEqual(state, { expanded: true, clicks: 1 }, "one click opens the description and leaves it open");
});

await probe("an already-expanded description stays open and fully captured", async () => {
  const { body, state } = handshakeBody({ expanded: true });
  installPage(`${ORIGIN}/jobs/1000001`, "x | y | Handshake", body);
  const page = await extractPageData();
  assertPostingOnly(page.text);
  assert.deepEqual(state, { expanded: true, clicks: 2 }, "a click that closed the description reopens it");
});

await probe("the search view captures the pane's posting with a single-line role and employer title", async () => {
  const { body } = handshakeBody({
    hook: "right-content",
    alumniFirst: true,
    role: "Platform Engineer\n- Data Tools",
    employer: "Example | Clinic\nCo"
  });
  installPage(`${ORIGIN}/job-search/1000002?page=1&per_page=25`, "Jobs | Handshake", body);
  const page = await extractPageData();
  assertPostingOnly(page.text);
  assert.equal(page.url, `${ORIGIN}/jobs/1000001`, "the pane's own posting link wins");
  assert.equal(page.title, `${ROLE} | Example Clinic Co | Handshake`);
});

await probe("toggles inside a link or form are never clicked, and at most four are", async () => {
  const guarded = [collapsible({ short: "guarded a", full: "guarded a expanded" }), collapsible({ short: "guarded f", full: "guarded f expanded" })];
  const extras = Array.from({ length: 5 }, (_, index) =>
    collapsible({ short: `extra ${index} preview`, full: `extra ${index} full section text` }));
  const { body, state } = handshakeBody({
    extraSections: [
      el("div", {}, [el("a", { attrs: { href: "/e/1" } }, [guarded[0].holder]), el("form", {}, [guarded[1].holder])]),
      ...extras.map((extra) => el("div", {}, [extra.holder]))
    ]
  });
  installPage(`${ORIGIN}/jobs/1000001`, "t", body);
  const page = await extractPageData();
  assert.deepEqual(guarded.map((item) => item.state.clicks), [0, 0]);
  assert.equal(state.clicks, 1);
  assert.deepEqual(extras.map((extra) => extra.state.clicks), [1, 1, 1, 0, 0], "four toggles in all");
  assert.match(page.text, /extra 2 full section text/);
  assert.match(page.text, /extra 3 preview/);
});

await probe("a toggle that never responds waits only its deadline and keeps the visible text", async () => {
  const { body, state } = handshakeBody({ works: false });
  installPage(`${ORIGIN}/jobs/1000001`, "t", body);
  const started = Date.now();
  const page = await extractPageData();
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 1400 && elapsed < 2400, `waited ${elapsed} ms against a 1500 ms deadline`);
  assert.equal(state.clicks, 1);
  assert.match(page.text, /community clinics\.\.\./);
  assert.doesNotMatch(page.text, /Pat Example|Staff Platform Engineer/);
});

await probe("the 50,000-character cap applies to a Handshake capture", async () => {
  const { body } = handshakeBody({ description: "x".repeat(60_000) });
  installPage(`${ORIGIN}/jobs/1000001`, "t", body);
  assert.equal((await extractPageData()).text.length, 50_000);
});

await probe("a Handshake page without a posting pane falls back to the visible page", async () => {
  const body = el("body", {}, [el("main", { text: "Loading job details for this posting. ".repeat(4) })]);
  installPage(`${ORIGIN}/jobs/1000001?searchId=abc`, "Handshake", body);
  const page = await extractPageData();
  assert.equal(page.text, body.innerText);
  assert.equal(page.url, `${ORIGIN}/jobs/1000001?searchId=abc`);
  assert.equal(page.title, "Handshake");
});

await probe("other sites keep the generic capture and are never clicked", async () => {
  const { body, state } = handshakeBody();
  const posting = el("div", { attrs: { class: "posting" }, text: "Backend role description. ".repeat(6) });
  body.append(posting);
  installPage("https://jobs.example.com/jobs/1000001", "Backend Engineer", body);
  const page = extractPageData();
  assert.ok(!(page instanceof Promise), "a non-Handshake capture stays synchronous");
  assert.equal(page.text, posting.innerText.trim());
  assert.equal(page.url, "https://jobs.example.com/jobs/1000001");
  assert.equal(state.clicks, 0);
});

await probe("a Handshake page that is not a posting keeps the synchronous generic capture", () => {
  const { body, state } = handshakeBody();
  installPage(`${ORIGIN}/job-search?page=1`, "Jobs | Handshake", body);
  const page = extractPageData();
  assert.ok(!(page instanceof Promise));
  assert.equal(page.url, `${ORIGIN}/job-search?page=1`);
  assert.equal(state.clicks, 0);
});

await probe("the server keeps captured Handshake text without fetching the signed-in page", async () => {
  let lookups = 0;
  const lookup = async () => {
    lookups += 1;
    throw new Error("unexpected network lookup");
  };
  const captured = "Captured Handshake posting text.";
  assert.equal(await resolveImportedJobText(captured, `${ORIGIN}/jobs/1000001`, { lookup }), captured);
  assert.equal(lookups, 0);
});

if (failures) {
  console.log(`${failures} Handshake capture probe(s) failed`);
  process.exitCode = 1;
} else {
  console.log("PASS Handshake capture probes");
}
