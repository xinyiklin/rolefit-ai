// Settings > Background lists the open resume's entries beside the selected
// note's editor: Linked to, Type and dates, Notes, and the entry's resume
// bullets; unlinked notes sit under Other notes; the plain text field remains
// when no real resume is open. Static markup, not browser layout coverage.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const bundled = await build({
  stdin: {
    contents: `
      import React from "react";
      import { renderToStaticMarkup } from "react-dom/server";
      import { ProfileNotes } from "../settings/ProfileNotes.tsx";
      const noop = () => {};
      const resume = {
        header: null,
        sections: [
          { id: "exp", type: "standard", heading: "Experience", items: [
            { id: "acme", titleLeft: "<b>Acme Corp</b>", titleRight: "2024", subtitleLeft: "Engineer", subtitleRight: "", bullets: [{ id: "b1", text: "Built <b>billing</b>." }] }
          ] },
          { id: "proj", type: "standard", heading: "Projects", items: [
            { id: "rf", titleLeft: "RoleFit AI", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: [] }
          ] },
          { id: "skl", type: "skills", heading: "Skills", items: [{ id: "lang", titleLeft: "Languages", titleRight: "", subtitleLeft: "Python", subtitleRight: "", bullets: [] }] }
        ]
      };
      export function render(resumeArg, background) {
        return renderToStaticMarkup(
          <ProfileNotes
            resume={resumeArg}
            background={background}
            onBackgroundChange={noop}
            textareaProps={{ "aria-labelledby": "profile-background-title", "aria-describedby": "profile-background-hint", "aria-invalid": undefined }}
          />
        );
      }
      export { resume };
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
new Function("require", "module", "exports", bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { render, resume } = module.exports;

const background = "Lead line.\n\n## Acme Corp (professional, 2024)\nShipped billing exports.\nLed the migration.\n\n## Old Startup\nGone now.\n\n## Beta Labs\nNames nothing.";
const byEntry = render(resume, background);
assert.match(byEntry, /aria-pressed="true">By entry</, "By entry is the pressed view");
assert.match(byEntry, /1 of 2 entries have notes/, "coverage counts standard entries only");
assert.match(byEntry, /aria-label="Experience"[\s\S]*?aria-current="true"[^>]*><span class="profile-notes__item-name" title="Acme Corp">Acme Corp<\/span><span class="profile-notes__item-meta">6 words</, "the first entry is selected and shows its size without inline marks");
assert.match(byEntry, /data-empty="true"><span class="profile-notes__item-name" title="RoleFit AI">RoleFit AI<\/span><span class="profile-notes__item-meta">Add</, "an entry without notes offers to add them");
assert.match(byEntry, /aria-label="Other notes"[\s\S]*Before the first heading[\s\S]*Old Startup[\s\S]*Beta Labs[\s\S]*Add note/, "other notes list the preamble and every unlinked block in order");
assert.doesNotMatch(byEntry, /proposal-chip/, "names-no-entry rows carry no flag");
assert.doesNotMatch(byEntry, /Languages/, "skills sections are not entries");

// The selected entry's editor.
assert.match(byEntry, /<h3>Acme Corp<\/h3><p>Engineer · 2024 · Experience<\/p>/, "the editor names the entry, its subtitle, dates, and section");
assert.match(byEntry, /<option value="acme" selected="">Acme Corp<\/option>/, "Linked to shows the linked entry");
assert.match(byEntry, /<option value="">Not linked<\/option>/);
assert.match(byEntry, /Resume Polish uses these notes for Acme Corp\./, "one line states what the link does");
assert.match(byEntry, /Type and dates<\/span><input[^>]*value="professional, 2024"/, "only the heading's detail is editable on a linked note");
assert.doesNotMatch(byEntry, />Heading<\/span>/, "a linked note's name is not a free field");
assert.match(byEntry, /<textarea[^>]*>Shipped billing exports\.\nLed the migration\.<\/textarea>/, "the notes edit in place");
assert.match(byEntry, /On your resume now · 1 bullet<\/summary><ul><li>Built billing\.<\/li><\/ul>/, "the resume bullets sit folded beside the notes");

const ambiguous = render({ ...resume, sections: [{ id: "exp", type: "standard", heading: "Experience", items: [
  { id: "a1", titleLeft: "Beta Labs", titleRight: "", subtitleLeft: "Lab", subtitleRight: "", bullets: [] },
  { id: "a2", titleLeft: "Beta Labs", titleRight: "", subtitleLeft: "Lab", subtitleRight: "", bullets: [] }
] }] }, "## Beta Labs\nShared name.");
assert.match(ambiguous, /<span class="proposal-chip">Names two entries<\/span>/, "a surprising reason gets a flag");
assert.match(ambiguous, /notes can&#x27;t link to it/, "the empty entry says why it cannot take notes");
const withGamma = render({ ...resume, sections: [{ id: "exp", type: "standard", heading: "Experience", items: [
  { id: "g", titleLeft: "Gamma", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: [] },
  { id: "a1", titleLeft: "Beta Labs", titleRight: "", subtitleLeft: "Lab", subtitleRight: "", bullets: [] },
  { id: "a2", titleLeft: "Beta Labs", titleRight: "", subtitleLeft: "Lab", subtitleRight: "", bullets: [] }
] }] }, "## Gamma\nNotes.");
assert.match(withGamma, /<option value="a1" disabled="">Beta Labs \(name shared\)<\/option>/, "an entry no name can reach is offered disabled");

// With no entries, the first unlinked note is selected: a free heading.
const general = render({ header: null, sections: [] }, "## Beta Labs\nNames nothing.");
assert.match(general, /<option value="" selected="">Not linked<\/option>/);
assert.match(general, /Heading<\/span><input[^>]*value="Beta Labs"/, "an unlinked note's heading is editable");
assert.match(general, /AI steps read it as general background\./);

const noResume = render(null, background);
assert.match(noResume, /<textarea[^>]*aria-labelledby="profile-background-title"/, "without a real resume the plain field remains");
assert.match(noResume, /Open your resume to organise these notes by entry\./);
assert.doesNotMatch(noResume, /profile-notes__item/);

console.log("profile notes markup probes passed");
