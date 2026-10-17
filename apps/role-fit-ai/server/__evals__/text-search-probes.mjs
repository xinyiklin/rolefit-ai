// includesEach (server/textSearch.ts) must answer exactly like String.includes
// for every needle and stay linear on hostile input over a small alphabet: job
// import compares a fetched page of up to 5 MB with every line of a bound
// posting, both reduced to the 37 key symbols.
import assert from "node:assert/strict";

import { includesEach } from "../textSearch.ts";

const expected = (text, needles) => needles.map((needle) => text.includes(needle));

// --- Exactness ----------------------------------------------------------------

const emoji = String.fromCodePoint(0x1f600);
const edges = [
  ["", []],
  ["", ["", "a"]],
  ["abc", ["", "abc", "abcd", "bc", "c", "x"]],
  ["aaaa", ["aa", "aaa", "aaaa", "aaaaa", "aa"]],
  ["abcabd", ["abd", "bca", "cab", "abcabd", "bd", "abcab", "dab", "abcabc"]],
  ["xabcy", ["abc", "bc", "c", "bcy", "abcz"]],
  [`caf${String.fromCharCode(0xe9)} ${emoji} tea`, [emoji, emoji[0], `${emoji[1]} t`, `${emoji[1]}${emoji[0]}`, "caf"]]
];
for (const [text, needles] of edges) {
  assert.deepEqual(includesEach(text, needles), expected(text, needles), `edge case ${JSON.stringify([text, needles])}`);
}

// Park-Miller: every product stays below 2^53, so the sequence never collapses.
let seed = 20261017;
const nextRandom = (limit) => {
  seed = (seed * 48271) % 2_147_483_647;
  return seed % limit;
};
const randomText = (alphabet, maxLength) => {
  let text = "";
  for (let count = nextRandom(maxLength + 1); count > 0; count -= 1) text += alphabet[nextRandom(alphabet.length)];
  return text;
};
let present = 0;
let absent = 0;
for (const alphabet of ["ab", "abc", "a b", "aab"]) {
  for (let round = 0; round < 10_000; round += 1) {
    const text = randomText(alphabet, 40);
    const needles = Array.from({ length: 1 + nextRandom(8) }, () => {
      if (nextRandom(3) > 0 || !text) return randomText(alphabet, 7);
      const start = nextRandom(text.length);
      return text.slice(start, start + 1 + nextRandom(text.length - start));
    });
    const answer = expected(text, needles);
    assert.deepEqual(includesEach(text, needles), answer, `matches includes for ${JSON.stringify([text, needles])}`);
    present += answer.filter(Boolean).length;
    absent += answer.filter((found) => !found).length;
  }
}
assert.ok(present > 10_000 && absent > 10_000, `random cases reach both answers (${present} present, ${absent} absent)`);
console.log(`PASS includesEach answers like String.includes (${edges.length} edge cases, ${present + absent} random needles)`);

// --- Hostile sizes ------------------------------------------------------------

const KEY_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789 ";
const ids = (count) => Array.from({ length: count }, (_, index) => index.toString(36).padStart(5, "0"));
// Each builder splits `size` characters between the text and the needles.
const hostile = {
  "distinct needles over a repeated text": (size) =>
    ["a".repeat(size / 2), ids(Math.ceil(size / 60)).map((id) => "a".repeat(25) + id)],
  "near-miss needles over a periodic text": (size) =>
    ["ab".repeat(size / 4), ids(Math.ceil(size / 72)).map((id) => `${"ab".repeat(15)}a${id}`)],
  "one long near-miss needle": (size) => ["a".repeat(size / 2), [`${"a".repeat(size / 2 - 1)}b`]],
  "random key text with copied needles": (size) => {
    const text = randomText(KEY_ALPHABET, size / 2);
    return [text, ids(Math.ceil(size / 62)).map((_, index) => {
      const start = nextRandom(Math.max(text.length - 31, 1));
      return index % 2 ? text.slice(start, start + 31) : randomText(KEY_ALPHABET, 31);
    })];
  }
};
// Small rungs fail a regression quickly and by name; the 1 MB rung bounds scale.
const LIMITS = [[500, 50], [4_000, 50], [64_000, 100], [256_000, 250], [1_000_000, 500]];
for (const [size, limit] of LIMITS) {
  for (const [label, build] of Object.entries(hostile)) {
    const [text, needles] = build(size);
    const started = performance.now();
    const answer = includesEach(text, needles);
    const elapsed = performance.now() - started;
    assert.ok(elapsed < limit, `includesEach searches ${size} B of ${label} in ${elapsed.toFixed(0)} ms (limit ${limit} ms)`);
    if (size <= 64_000) assert.deepEqual(answer, expected(text, needles), `${label} at ${size} B matches includes`);
  }
}
console.log(`PASS includesEach stays within bounds up to 1 MB (${Object.keys(hostile).length} shapes, ${LIMITS.length} sizes)`);
