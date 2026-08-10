import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const prepareStyles = readFileSync(
  new URL("../../../../styles/prepare.css", import.meta.url),
  "utf8"
);
const prepareSource = readFileSync(new URL("../../PrepareTab.tsx", import.meta.url), "utf8");

const preparedHeightBlock = prepareStyles.slice(
  prepareStyles.indexOf("@media (min-width: 1081px)"),
  prepareStyles.indexOf("@media (max-width: 1080px)")
);

assert.match(
  preparedHeightBlock,
  /\.prepare-layout\.is-prepared > \.prepare-rail > \.prepare-application\s*\{[\s\S]{0,180}?align-self:\s*start;[\s\S]{0,180}?min-height:\s*100%;/,
  "the prepared rail panel grows with wrapped content instead of stretching to a shorter scrollport track"
);

assert.match(
  preparedHeightBlock,
  /\.studio-body\[data-tab="prepare"\]\s*\{[\s\S]{0,220}?overflow:\s*hidden/,
  "Prepare uses one fixed studio-height shell in both intake and prepared states"
);
assert.match(
  preparedHeightBlock,
  /\.prepare-page\s*\{[\s\S]{0,180}?height:\s*100%;[\s\S]{0,180}?min-height:\s*0/,
  "the Prepare page keeps the same container height when no job is prepared"
);
assert.match(
  preparedHeightBlock,
  /\.prepare-layout\s*\{[\s\S]{0,160}?height:\s*100%;[\s\S]{0,160}?min-height:\s*0/,
  "both Prepare topologies fill the page's remaining height"
);

assert.doesNotMatch(
  prepareSource,
  /const can(?:Fetch|PreparePaste)\s*=.*jobAnalysisProviderReady/,
  "manual URL and paste preparation stay reachable without a configured AI provider"
);
assert.match(
  prepareSource,
  /Local brief ready\. Connect an AI provider to improve it\./,
  "Prepare explains the deterministic fallback without disabling the source action"
);

console.log("Prepare application rail layout eval: 6/6 checks passed");
