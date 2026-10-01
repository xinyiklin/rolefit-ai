// Settings > Profile holds the basic facts and one Background field; Guidance
// holds only drafting preferences. Static markup, not browser layout coverage.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const bundled = await build({
  stdin: {
    contents: `
      import React from "react";
      import { renderToStaticMarkup } from "react-dom/server";
      import { SettingsDialog, SETTINGS_SECTIONS } from "../SettingsDialog.tsx";
      export { SETTINGS_SECTIONS };
      const noop = () => {};
      export function render(section, profileBackground) {
        return renderToStaticMarkup(
          <SettingsDialog
            section={section}
            onSectionChange={noop}
            onClose={noop}
            stages={{}}
            onStageChange={noop}
            onStageProviderChange={noop}
            onCopyStage={noop}
            providers={[]}
            availabilityStatus="ready"
            availabilityMessage=""
            onRefreshProviders={noop}
            fitAssessmentAuto={true}
            onFitAssessmentAutoChange={noop}
            resumePolishAuto={false}
            onResumePolishAutoChange={noop}
            resumePolishAutoThreshold="REASONABLE"
            onResumePolishAutoThresholdChange={noop}
            coverPolishAuto={false}
            onCoverPolishAutoChange={noop}
            coverPolishAutoThreshold="STRONG"
            onCoverPolishAutoThresholdChange={noop}
            citizenshipStatus="unspecified"
            onCitizenshipChange={noop}
            legallyAuthorizedToWork="unspecified"
            onLegallyAuthorizedChange={noop}
            requiresSponsorship="unspecified"
            onRequiresSponsorshipChange={noop}
            educationLevel="unspecified"
            onEducationLevelChange={noop}
            major=""
            onMajorChange={noop}
            gpa={undefined}
            onGpaChange={noop}
            availabilityNotice="unspecified"
            onAvailabilityNoticeChange={noop}
            availabilityDate=""
            onAvailabilityDateChange={noop}
            profileBackground={profileBackground}
            onProfileBackgroundChange={noop}
            workspacePreferencesStatus="idle"
            boldBulletKeywords={true}
            onBoldBulletKeywordsChange={noop}
            customInstructions=""
            onCustomInstructionsChange={noop}
            stageCustomInstructions={{}}
            onStageCustomInstructionChange={noop}
            onReset={noop}
          />
        );
      }
    `,
    resolveDir: fileURLToPath(new URL(".", import.meta.url)),
    loader: "tsx"
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  write: false,
  logLevel: "silent"
});
const module = { exports: {} };
new Function("require", "module", "exports", bundled.outputFiles[0].text)(
  createRequire(import.meta.url), module, module.exports
);
const { render, SETTINGS_SECTIONS } = module.exports;

assert.deepEqual(
  SETTINGS_SECTIONS.map((section) => section.label),
  ["AI stages", "Profile", "Guidance"],
  "Settings lists AI stages, Profile, and Guidance"
);

const empty = render("about", "");
for (const fact of ["Citizenship", "U.S. work authorization", "Requires visa sponsorship", "Highest completed level", "Earliest start"]) {
  assert.match(empty, new RegExp(fact), `Profile keeps the ${fact} fact`);
}
assert.match(empty, /id="profile-background-title">Background</, "Profile has one Background field");
assert.equal((empty.match(/<textarea/g) ?? []).length, 1, "the Background is the Profile's only text area");
assert.match(empty, /aria-labelledby="profile-background-title"/);
assert.match(empty, /0 \/ 12,000/, "the empty Background shows its count");
assert.match(empty, /placeholder="## [^"]*\(personal project, [^"]*\)[^"]*## [^"]*\(professional, /, "the placeholder is a heading example with type and dates");
assert.doesNotMatch(empty, /Experience evidence|experience-profile|Add experience source/i, "the experience rows are gone");
assert.doesNotMatch(empty, /aria-invalid|role="status">Over/, "a short Background is not over the limit");
assert.match(empty, /id="profile-background-notice" role="status"><\/p>/, "the empty status region stays mounted so later notices are announced");

const over = render("about", "x".repeat(12_001));
assert.match(over, /12,001 \/ 12,000/);
assert.match(over, /settings-background__count is-over/);
assert.match(over, /aria-invalid="true"/);
assert.match(over, /aria-describedby="profile-background-hint profile-background-notice"/);
assert.match(over, /Over 12,000 characters\. AI steps won&#x27;t run until it&#x27;s shorter\./);

// Fit measures NFKC text, so "…" counts as three characters toward the limit.
const expanding = render("about", "…".repeat(4_001));
assert.match(expanding, /12,003 \/ 12,000/, "the count uses the NFKC-aware measure");
assert.match(expanding, /aria-invalid="true"/);

const guidance = render("guidance", "Stored Background text.");
assert.match(guidance, /Custom instructions/);
assert.match(guidance, /Bold keywords in bullets/);
assert.doesNotMatch(guidance, /Honest context|Stored Background text|profile-background/, "Guidance no longer holds the Background");

console.log("Settings Profile markup probes passed");
