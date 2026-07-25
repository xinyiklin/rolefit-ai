// Font wiring guard: every face the engine can select must actually be
// declared, shipped, and embeddable.
//
// WHY THIS IS THE RIGHT CHECK. The registry names a `cssFamily` per face and the
// DOM painter sets `font-family` to that string. Nothing connects the string to
// the `@font-face` rule that defines it except the two spellings matching, and a
// mismatch fails SILENTLY in the worst possible way: the browser substitutes a
// system font, so text paints at advances the engine never measured. Every
// caret position, line break, and selection rectangle is then wrong, and it
// still looks like text. The same holds for the PDF siblings — a missing `.ttf`
// only surfaces when a user exports.
//
// The whole class is mechanical, so it is checked mechanically:
//   1. every registry cssFamily is declared exactly once in the stylesheet
//   2. every declared family is one the registry names (no orphan rules)
//   3. each rule's src, weight, and style agree with the registry face
//   4. every woff2 asset and every PDF sfnt sibling exists on disk
//   5. each face's declared italicAngleDeg is the shipped asset's own slope
//
// (5) exists because that angle is the one font fact the registry writes by
// hand — the generated metrics do not carry it and the browser cannot report
// it — and it is read straight out of the sfnt sibling's `post` table here, so
// a hand-typed value can never drift from the outlines it claims to describe.
//
// Run: node --experimental-strip-types src/styles/__evals__/font-assets.mjs

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DOCUMENT_FONT_FAMILIES, sfntAssetFile } from "@typeset/engine/typeset/fontRegistry.ts";

const STYLESHEET = new URL("../resume-document.css", import.meta.url);
// Anchored the same way the apps' sync-fonts scripts anchor it, so this reads
// the package's real font directory rather than a guessed relative path.
const FONTS_DIR = dirname(
  fileURLToPath(import.meta.resolve("@typeset/engine/fonts/LMRoman10-Regular.woff2"))
);

const failures = [];
const fail = (message) => failures.push(message);

// `post.italicAngle` of an sfnt: degrees counter-clockwise from vertical, as a
// 16.16 fixed-point number 4 bytes into the table. Read directly rather than
// through a font library so this eval stays dependency-free like its siblings.
function sfntItalicAngle(file) {
  const buf = readFileSync(file);
  const tables = buf.readUInt16BE(4);
  for (let i = 0; i < tables; i += 1) {
    const record = 12 + i * 16;
    if (buf.toString("ascii", record, record + 4) !== "post") continue;
    return buf.readInt32BE(buf.readUInt32BE(record + 8) + 4) / 65536;
  }
  return null;
}

// The registry rounds each angle to three decimals; anything looser would let a
// genuinely different slope pass.
const ANGLE_TOLERANCE_DEG = 0.001;

// --- parse the @font-face rules -------------------------------------------
const css = readFileSync(STYLESHEET, "utf8");
const declared = new Map(); // cssFamily -> { src, weight, style, count }
for (const [, body] of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
  const read = (property) => body.match(new RegExp(`${property}\\s*:\\s*([^;]+);`))?.[1]?.trim();
  const family = read("font-family")?.replace(/^["']|["']$/g, "");
  if (!family) {
    fail(`an @font-face rule declares no font-family: ${body.trim().slice(0, 60)}…`);
    continue;
  }
  const existing = declared.get(family);
  if (existing) {
    existing.count += 1;
    continue;
  }
  declared.set(family, {
    src: read("src")?.match(/url\(["']?([^"')]+)["']?\)/)?.[1],
    weight: Number(read("font-weight")),
    style: read("font-style"),
    count: 1
  });
}

// --- registry -> stylesheet + disk ----------------------------------------
const referenced = new Set();
let faceCount = 0;
for (const [familyId, definition] of Object.entries(DOCUMENT_FONT_FAMILIES)) {
  for (const [faceName, face] of Object.entries(definition.faces)) {
    faceCount += 1;
    const where = `${familyId}:${faceName}`;
    referenced.add(face.cssFamily);

    const rule = declared.get(face.cssFamily);
    if (!rule) {
      fail(`${where}: no @font-face declares "${face.cssFamily}" — the browser would substitute a system font`);
    } else {
      if (rule.count > 1) fail(`${where}: "${face.cssFamily}" is declared ${rule.count} times`);
      if (rule.src !== face.assetPath) {
        fail(`${where}: "${face.cssFamily}" loads ${rule.src} but the registry points at ${face.assetPath}`);
      }
      if (rule.weight !== face.weight) {
        fail(`${where}: "${face.cssFamily}" is font-weight ${rule.weight} but the registry says ${face.weight}`);
      }
      const expectedStyle = face.italic ? "italic" : "normal";
      if (rule.style !== expectedStyle) {
        fail(`${where}: "${face.cssFamily}" is font-style ${rule.style} but the registry says ${expectedStyle}`);
      }
    }

    const woff2 = resolve(FONTS_DIR, face.assetPath.replace(/^\/fonts\//, ""));
    if (!existsSync(woff2)) fail(`${where}: missing webfont ${woff2}`);
    const sfnt = resolve(FONTS_DIR, sfntAssetFile(familyId, faceName));
    if (!existsSync(sfnt)) {
      fail(`${where}: missing PDF sibling ${sfnt} — Export PDF would fail`);
    } else {
      const angle = sfntItalicAngle(sfnt);
      if (angle === null) {
        fail(`${where}: ${sfnt} has no post table, so its slope cannot be checked`);
      } else if (Math.abs(angle - face.italicAngleDeg) > ANGLE_TOLERANCE_DEG) {
        fail(
          `${where}: the registry declares italicAngleDeg ${face.italicAngleDeg} but the face is drawn at ${angle}` +
            " — the caret would lean at an angle the text does not"
        );
      }
    }
  }
}

// --- stylesheet -> registry ----------------------------------------------
for (const family of declared.keys()) {
  if (!referenced.has(family)) {
    fail(`the stylesheet declares "${family}", which no registry face uses — stale rule or a renamed face`);
  }
}

const familyCount = Object.keys(DOCUMENT_FONT_FAMILIES).length;
// Fewer rules than faces is expected: a family whose display bold IS its text
// bold points both faces at one asset, so they share one declaration.
console.log(
  `font assets: ${familyCount} families × ${faceCount / familyCount} faces -> ` +
    `${declared.size} @font-face rules over ${referenced.size * 2} files (webfont + PDF sibling each)`
);
if (failures.length) {
  for (const message of failures) console.error(`  FAIL ${message}`);
  console.error(`\nFAIL: ${failures.length} font wiring problem(s).`);
  process.exit(1);
}
console.log(
  "PASS: every engine face is declared once, loads its own asset at the right weight/style, ships both a webfont and a PDF sibling, and declares the slope its outlines are drawn at."
);
