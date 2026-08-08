import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const prepareStyles = readFileSync(
  new URL("../../../../styles/prepare.css", import.meta.url),
  "utf8"
);

const preparedHeightBlock = prepareStyles.slice(
  prepareStyles.indexOf("@media (min-width: 1081px)"),
  prepareStyles.indexOf("@media (max-width: 1080px)")
);

assert.match(
  preparedHeightBlock,
  /\.prepare-layout\.is-prepared > \.prepare-rail > \.prepare-application\s*\{[\s\S]{0,180}?align-self:\s*start;[\s\S]{0,180}?min-height:\s*100%;/,
  "the prepared rail panel grows with wrapped content instead of stretching to a shorter scrollport track"
);

console.log("Prepare application rail layout eval: 1/1 checks passed");
