// Probes for inlineMarksToHtml (src/lib/inlineMarksHtml.ts) — the sink that
// converts the tiny persisted `<b>/<i>/<u>` mark grammar into escaped display
// HTML. INLINE_TAG_RE = /<\/?(?:b|i|u)>/gi matches ONLY an exact opening/closing
// b, i, or u tag (case-insensitively), with no attribute-capture group at all —
// so anything that isn't byte-for-byte one of those six tag spellings (any
// case) simply never matches and falls through the surrounding
// escapeHtml(texLigatures(...)) path as plain escaped text. Verified below
// against the actual regex/switch, case by case:
//
//   - <u>/<\/u> DO match the regex but have no strong/em branch in the
//     switch, so they hit the `else html += tag` fallthrough. `tag` there is
//     match[0].toLowerCase() — a FIXED literal drawn only from the six
//     matchable spellings, never attacker-supplied text — so this emits a
//     literal, unescaped "<u>"/"</u>" into the output. That is safe-by-
//     construction (nothing outside the allowlisted match can reach this
//     branch), but it does mean a <u> mark never becomes a real HTML tag pair
//     the way <b>/<i> do — it round-trips as inert-looking literal markup.
//   - Any tag carrying attributes (`<b class="x">`) breaks the exact-match
//     regex, so the OPENING tag is treated as plain text and escaped. A bare
//     matching CLOSING tag elsewhere (`</b>`) still matches and still
//     converts to `</strong>` independent of whether a real `<strong>` opener
//     preceded it — locked below as a known (non-injection) mismatched-tag
//     oddity, not fixed here (see the eval-runner's final report).
//   - <script>/<SCRIPT> never match INLINE_TAG_RE at all (script is not b/i/u),
//     so script content is always plain escaped text, never emitted as markup.
//
// No input was found that reaches attacker-controlled unescaped HTML — every
// literal, unescaped fragment above is drawn from the fixed six-tag allowlist,
// never from attacker-supplied characters.
import assert from "node:assert/strict";

import { inlineMarksToHtml } from "../inlineMarksHtml.ts";

const rendered = inlineMarksToHtml(
  '<b>Grounded</b> <img src=x onerror="alert(1)"> <script>alert(2)</script> & safe\n<i>detail</i>'
);

assert.match(rendered, /^<strong>Grounded<\/strong>/, "the persisted mark grammar renders semantic tags");
assert.ok(!rendered.includes("<img"), "untrusted HTML elements never reach the sink");
assert.ok(!rendered.includes("<script"), "script elements never reach the sink");
assert.ok(rendered.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"), "untrusted markup is visible as escaped text");
assert.ok(rendered.includes("&amp; safe<br><em>detail</em>"), "entities, line breaks, and allowed emphasis round-trip");

// ── <u> passthrough: matches the regex, has no strong/em branch, so the
//    lowercased literal tag text is emitted unescaped (verbatim <u>...</u>). ──
assert.equal(
  inlineMarksToHtml("<u>underline</u>"),
  "<u>underline</u>",
  "a <u> mark passes through as a literal (unescaped) <u>...</u> pair — safe-by-construction because 'tag' is always one of the six matched literals, never attacker text"
);
assert.equal(
  inlineMarksToHtml("a<i>b</i><u>c</u>d"),
  "a<em>b</em><u>c</u>d",
  "<u> co-exists with a real <b>/<i> conversion in the same string without disturbing it"
);

// ── uppercase / mixed-case tags: the .toLowerCase() path normalizes case ──
assert.equal(inlineMarksToHtml("<B>bold</B>"), "<strong>bold</strong>", "uppercase <B>/</B> still convert via match[0].toLowerCase()");
assert.equal(inlineMarksToHtml("<I>italic</I>"), "<em>italic</em>", "uppercase <I>/</I> still convert");
assert.equal(inlineMarksToHtml("<U>upper u</U>"), "<u>upper u</u>", "uppercase <U>/</U> still hit the passthrough branch, emitted lowercased");
assert.equal(
  inlineMarksToHtml("<SCRIPT>alert(1)</SCRIPT>"),
  "&lt;SCRIPT&gt;alert(1)&lt;/SCRIPT&gt;",
  "uppercase <SCRIPT> is not b/i/u in any case, so it never matches INLINE_TAG_RE and stays escaped text — the regex's tag whitelist, not the lowercasing, is what keeps it out"
);

// ── attributes on a matched tag break the EXACT regex: no capture group ──
{
  const withAttr = inlineMarksToHtml('<b class="x">contents</b>');
  assert.ok(
    withAttr.startsWith("&lt;b class=&quot;x&quot;&gt;"),
    "an opening tag with attributes fails the exact </?(?:b|i|u)> match and is escaped as plain text, not converted"
  );
  // Known (non-injection) oddity: the bare closing </b> right after it DOES
  // still match and still converts, with no <strong> opener ever emitted —
  // a structurally mismatched but non-attacker-controlled literal.
  assert.ok(withAttr.endsWith("</strong>"), "the standalone closing </b> still converts to a literal </strong>, orphaned from any opening <strong> — locked as a known formatting oddity, not a security issue");
}

// ── null/undefined/non-string input: the String(value ?? "") guard ──
assert.equal(inlineMarksToHtml(null), "", "null input is coerced to the empty string, not a throw");
assert.equal(inlineMarksToHtml(undefined), "", "undefined input is coerced to the empty string, not a throw");
assert.equal(inlineMarksToHtml(42), "42", "a non-string, non-nullish value is coerced via String() and rendered as plain text");

console.log("PASS inline mark HTML boundary");
