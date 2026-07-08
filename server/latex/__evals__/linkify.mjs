// Offline, deterministic probes for linkify()'s www-href behavior.
//
//   node server/latex/__evals__/linkify.mjs
//
// Locks: GitHub/LinkedIn links get www. on the CLICKABLE href only (the visible
// label is left exactly as typed); the rule is apex-only (no double www, no
// touching gist.github.com / uk.linkedin.com) and scoped to those two hosts
// (gitlab and personal domains are untouched); and the parse-back round-trip
// still treats a "github.com/x" label as implying its "www.github.com/x" href,
// so re-importing our own .tex doesn't duplicate the URL as text.
//
// Synthetic fixtures only — no personal resume text, no Tectonic/PDF compile.

import { linkify } from "../util.ts";
import { parseResumeText } from "../parseResumeText.ts";

// [input, expected url (href), expected label (display)]
const linkCases = [
  ["github.com/jane", "https://www.github.com/jane", "github.com/jane"],
  ["linkedin.com/in/jane", "https://www.linkedin.com/in/jane", "linkedin.com/in/jane"],
  // protocol given: www added to href, protocol stripped from label
  ["https://github.com/jane", "https://www.github.com/jane", "github.com/jane"],
  // already-www: never doubled, label preserves what was typed
  ["www.github.com/jane", "https://www.github.com/jane", "www.github.com/jane"],
  ["https://www.linkedin.com/in/jane", "https://www.linkedin.com/in/jane", "www.linkedin.com/in/jane"],
  // authority capture stops at "?" — a path-less query URL still matches the host
  ["https://github.com?x=1", "https://www.github.com?x=1", "github.com?x=1"],
  // apex only: other subdomains are NOT given www
  ["gist.github.com/jane", "https://gist.github.com/jane", "gist.github.com/jane"],
  ["uk.linkedin.com/in/jane", "https://uk.linkedin.com/in/jane", "uk.linkedin.com/in/jane"],
  // scope: only github/linkedin — gitlab and personal sites are untouched
  ["gitlab.com/jane", "https://gitlab.com/jane", "gitlab.com/jane"],
  ["xinyiklin.com", "https://xinyiklin.com", "xinyiklin.com"]
];

const checks = linkCases.flatMap(([input, url, label]) => {
  const result = linkify(input);
  return [
    [`linkify(${JSON.stringify(input)}) href = ${url}`, result?.url === url],
    [`linkify(${JSON.stringify(input)}) label = ${label}`, result?.label === label]
  ];
});

// Round-trip: a www-href with a non-www label must NOT append the URL as text.
const roundTrip = parseResumeText(
  `Jane Doe\n\\href{https://www.github.com/jane}{github.com/jane} | jane@example.com`
);
const contact = (roundTrip.contact ?? []).join(" ");
checks.push(
  ["round-trip keeps the clean label", contact.includes("github.com/jane")],
  ["round-trip does NOT duplicate the www url as text", !contact.includes("(https://www.github.com/jane)")]
);

const failures = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
if (failures.length) {
  console.error(`\n${failures.length}/${checks.length} linkify checks FAILED`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} linkify checks passed.`);
