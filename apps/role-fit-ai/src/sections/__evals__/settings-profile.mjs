// Settings is five pages in two groups: Profile holds the declared facts,
// Background the notes, Guidance every instruction, Automation what runs after
// Prepare, and Models each stage's provider. Static markup, not browser layout
// coverage.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const bundled = await build({
  stdin: {
    contents: `
      import React from "react";
      import { renderToStaticMarkup } from "react-dom/server";
      import { SettingsDialog, SETTINGS_GROUPS } from "../SettingsDialog.tsx";
      import { AI_STAGES } from "../../config/aiStages.ts";
      export { SETTINGS_GROUPS };
      const noop = () => {};
      const stages = Object.fromEntries(AI_STAGES.map((stage) => [stage.id, { provider: "claude-cli", selectedModel: "", cliReasoningEffort: "" }]));
      export function render(section, profileBackground, profileResume = null) {
        return renderToStaticMarkup(
          <SettingsDialog
            section={section}
            onSectionChange={noop}
            onClose={noop}
            stages={stages}
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
            profileResume={profileResume}
            workspacePreferencesStatus="idle"
            boldBulletKeywords={true}
            onBoldBulletKeywordsChange={noop}
            customInstructions=""
            onCustomInstructionsChange={noop}
            stageCustomInstructions={{ "cover-polish": "Keep it to three paragraphs." }}
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
const { render, SETTINGS_GROUPS } = module.exports;

assert.deepEqual(
  SETTINGS_GROUPS.map((group) => [group.label, group.sections.map((section) => section.label)]),
  [["You", ["Profile", "Background"]], ["AI", ["Guidance", "Automation", "Models"]]],
  "Settings groups five pages under You and AI"
);

const profile = render("profile", "Stored Background text.");
for (const fact of ["Citizenship", "U.S. work authorization", "Requires visa sponsorship", "Highest completed level", "Earliest start"]) {
  assert.match(profile, new RegExp(fact), `Profile keeps the ${fact} fact`);
}
assert.match(profile, /role="group" aria-label="You"[\s\S]*aria-current="true">Profile</, "the open page is marked in its group");
assert.doesNotMatch(profile, /<textarea|Stored Background text|profile-background/, "the Background has its own page");
assert.doesNotMatch(profile, /settings-dialog__card" data-section/, "the card has one size for every page");

const empty = render("background", "");
assert.match(empty, /aria-current="true">Background</);
assert.match(empty, /id="profile-background-title">Background</, "the Background field keeps its accessible name");
assert.equal((empty.match(/<textarea/g) ?? []).length, 1, "without a resume the Background is one text area");
assert.match(empty, /aria-labelledby="profile-background-title"/);
assert.match(empty, /0 \/ 12,000/, "the empty Background shows its count");
assert.match(empty, /placeholder="## [^"]*\(personal project, [^"]*\)[^"]*## [^"]*\(professional, /, "the placeholder is a heading example with type and dates");
assert.doesNotMatch(empty, /aria-invalid|role="status">Over/, "a short Background is not over the limit");
assert.match(empty, /id="profile-background-notice" role="status"><\/p>/, "the empty status region stays mounted so later notices are announced");

const over = render("background", "x".repeat(12_001));
assert.match(over, /12,001 \/ 12,000/);
assert.match(over, /settings-background__count is-over/);
assert.match(over, /aria-invalid="true"/);
assert.match(over, /aria-describedby="profile-background-hint profile-background-notice"/);
assert.match(over, /Over 12,000 characters\. AI steps won&#x27;t run until it&#x27;s shorter\./);

// Fit measures NFKC text, so "…" counts as three characters toward the limit.
const expanding = render("background", "…".repeat(4_001));
assert.match(expanding, /12,003 \/ 12,000/, "the count uses the NFKC-aware measure");
assert.match(expanding, /aria-invalid="true"/);

const resume = {
  header: null,
  sections: [{ id: "proj", type: "standard", heading: "Projects", items: [{ id: "rf", titleLeft: "RoleFit AI", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: [] }] }]
};
const byEntry = render("background", "## RoleFit AI (personal project)\nBuilt it.", resume);
assert.match(byEntry, /1 of 1 entries have notes/);
assert.match(byEntry, /profile-notes__item-name" title="RoleFit AI">RoleFit AI</);
assert.doesNotMatch(byEntry, /textarea settings-background/, "the entries view replaces the raw field");
assert.match(byEntry, /id="profile-background-notice" role="status"><\/p>/, "the status region stays mounted under either view");

const guidance = render("guidance", "Stored Background text.");
assert.match(guidance, /Custom instructions/);
assert.match(guidance, /Bold keywords in bullets/);
for (const stage of ["Resume Polish", "Cover letter Polish", "Application questions"]) {
  assert.match(guidance, new RegExp(`<strong>${stage}</strong>`), `Guidance holds the ${stage} override`);
}
assert.doesNotMatch(guidance, /<strong>(Job analysis|Fit Assessment|Final application review)<\/strong>/, "stages without instructions have no override row");
assert.match(guidance, /aria-expanded="true"[^>]*>[\s\S]*?<strong>Cover letter Polish<\/strong>/, "a set override starts open");
assert.match(guidance, /Keep it to three paragraphs\./);
assert.doesNotMatch(guidance, /Stored Background text|profile-background/, "Guidance does not hold the Background");

const automation = render("automation", "");
assert.match(automation, /Run Fit Assessment after Prepare/);
assert.match(automation, /Automatically Polish resume[\s\S]*Minimum fit[\s\S]*Automatically Polish cover letter[\s\S]*Minimum fit/);
assert.doesNotMatch(automation, /settings-stage"/, "Automation holds no provider rows");

const models = render("models", "");
assert.match(models, /settings-stages__head[^>]*><span>Stage<\/span><span>Provider<\/span><span>Model<\/span><span>Effort<\/span>/, "Models heads its columns once");
assert.equal((models.match(/<section class="settings-stage"/g) ?? []).length, 6, "one row per configurable stage");
assert.match(models, /aria-label="Resume Polish provider"/, "each select names its stage");
assert.match(models, /No providers added/);
assert.doesNotMatch(models, /<textarea|Add instructions|Run Fit Assessment/, "instructions and automation live on their own pages");

console.log("Settings pages markup probes passed");
