# RoleFit AI — browser extension

A Manifest V3 popup (Chrome / Edge / Firefox) that prepares job postings in
RoleFit AI. Click the toolbar icon to see whether you've already tracked or
applied to that posting and open it in a fresh Prepare tab. Fit score, coverage,
and verdict are produced only by AI Review in the main app.

Two ways to import the posting you are reading:

- **The popup** — the toolbar icon (or `Ctrl+Shift+Y` / `⌘⇧Y`) shows the role,
  where it was captured from, and its tracker status, then **Prepare in
  RoleFit**.
- **The keyboard** — `Ctrl+Shift+U` / `⌘⇧U` imports the current page straight
  into a fresh RoleFit tab without opening the popup. If it cannot finish, the
  toolbar icon shows a badge and the popup explains why the next time you open
  it.

Both shortcuts are editable in your browser's extension-shortcut settings; the
popup's **Settings** view shows the keys currently assigned and links there. If
that view says the shortcuts are **unavailable**, the browser has no commands
registered for this install — reload the extension (Firefox reads
`manifest.json` only when the add-on is loaded, while it re-reads the popup
files every time you open them, so an add-on loaded before this change shows
the new UI with no shortcuts).
Both paths do exactly the same thing: import the posting and stop on Prepare
after AI-backed job analysis. Neither one tailors or polishes anything
automatically.

It sends requests **only** to your local RoleFit AI server at the validated
`http://localhost:<port>` origin stored in one versioned
`chrome.storage.local` record: `{schemaVersion: 1, localSitePort}`. Source
development and first installation default to `5181`; `runtime-config.js` is
only the validated first-install seed, and saved browser storage wins. The
popup never scans localhost ports, uses a locator, opens a second listener, or
accepts a page-selected API origin. The manifest grants `http://localhost/*`
because Chrome and Firefox host match patterns cannot safely pin one localhost
port.
The server also requires this installed extension's exact Origin. A manifest
host permission permits the request but does not prove which extension sent it.
Before it sends job text, the popup calls the same-port `GET
/api/extension/status` endpoint and requires the exact RoleFit service marker
and schema. Privileged extension-page GETs may omit `Origin`; that content-free
response reports `paired: false`, then the popup uses the origin-bearing pairing
POST to confirm an existing approval or request a short-lived one. Approve that
exact origin once in the companion before analysis or import becomes available.
For preparation handoffs, the server resolves the
captured posting text; the receiving RoleFit tab then always runs its selected
provider-backed job analysis. Start the app
(`npm run dev:rolefit` from the repository root) before using it.

## Install (unpacked)

**Desktop release:** In the RoleFit companion, open **Browser extension** and
select **Open extension folder**. The companion materializes its allowlisted
extension files inside app data and writes the resolved local port into
`runtime-config.js` as the first-install seed so Chrome, Edge, and Firefox can
load it outside Electron's packaged archive. **Copy path** copies that
app-owned folder path. The section also has click-to-copy controls for the
exact Chrome (`chrome://extensions`), Edge (`edge://extensions`), and Firefox
(`about:debugging#/runtime/this-firefox`) setup addresses, plus **Copy port**
for the active numeric port. These are fixed desktop API 13 targets:
Electron main performs the clipboard write, the renderer sends only a target
id, no filesystem path or arbitrary text is accepted from the renderer, and no
renderer clipboard permission is needed.
Each action keeps visible feedback on its hovered or focused control and uses a
visually hidden polite announcement for assistive technology. Keep that folder
in place after loading it. There is no browser-store package yet.

**Source development:** Load this repository's `extension/` folder directly;
the browser-specific steps below apply to either folder.

- **Chrome / Edge** — open `chrome://extensions`, enable **Developer mode**,
  click **Load unpacked**, and select the folder RoleFit opened (or this
  `extension/` folder during source development).
- **Firefox** — open `about:debugging#/runtime/this-firefox`, click
  **Load Temporary Add-on…**, and select `manifest.json` in that folder.

After loading the extension, start the RoleFit companion and open the popup on
a job page. The first request is intentionally blocked and appears in the
companion under **Browser extension**. Select **Approve** once, allow the
companion to restart its local service, and reopen the popup. If you later
change RoleFit's port, copy the active port from the companion and save it in
the popup's inline **Settings** view; it reconnects without an extension reload.
Remove the paired origin from the companion to revoke access. Unpacked Chrome
ids can change if the extension is
moved or reloaded under a different identity; Firefox origins are
browser/profile-specific, so each distinct installation requires its own
one-time approval.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | MV3 manifest: `activeTab` + `scripting` + `storage` + `cookies` (the last so imports can open in the source tab's Firefox container), with `http://localhost/*` connectivity; host permission is not server authorization |
| `runtime-config.js` | validated first-install localhost-port seed; defaults to `5181` in source and is regenerated in the companion-owned materialized copy |
| `settings.js` | versioned `chrome.storage.local` port record, validation, migration, reset-to-`5181`, and the one-shot keyboard-import notice |
| `bridge.js` | the only client of the local RoleFit routes and the only page-capture path, shared by the popup and the keyboard command |
| `background.js` | the `import-job` keyboard command; captures and imports with no popup open, reporting through the toolbar badge and a stored notice |
| `popup.html` / `popup.css` / `popup.js` | the popup UI (vanilla ESM, no build step) |
| `icons/icon.svg` | toolbar icon |

Firefox 128+ is required (`strict_min_version`), because the event page behind
the keyboard command is an ES module.

## How it works

1. On open, the popup injects a small extractor into the active tab
   (`document.body.innerText`, with site-specific selectors for LinkedIn,
   Indeed, Lever, Greenhouse, and Workday tried first).
2. It POSTs the text to `POST /api/extension/analyze`, which extracts job
   identity and checks the application tracker with a layered
   duplicate match (ATS posting id / normalized URL / requisition id in the
   posting / no-id company + title + description overlap), then renders the
   tracked-status row. Shared posting or requisition ids are exact; a
   normalized URL is exact unless explicit ids conflict. Different explicit ids
   default to separate postings; only an exceptionally strong
   company/title/location/content match raises a review-only warning for a
   likely id input error. When a tracked application matches, the popup also
   shows a compact evidence line (e.g. "Same LinkedIn posting (#123)"),
   prefixed "Possible duplicate ·" for a non-exact match. No-id fuzzy matching
   requires substantial descriptions with aligned metadata plus strong lexical
   and ordered-phrase overlap; small amounts of shared boilerplate do not
   produce a warning.
3. **Prepare in RoleFit** sends exactly `{text, url, claimToken}` to
   `POST /api/extension/import` and opens a fresh app tab with that short claim
   token. The server resolves the raw posting text in the background (for
   example, fetching the full description for a Greenhouse link), so it
   survives popup focus loss. The app polls
   `GET /api/extension/inbox?tabId=...&claimToken=...`; progress is reported
   while that resolve runs, and the delivered inbox payload contains only
   `{text, url}`. The receiving tab always runs provider-backed job analysis and
   loads the brief into that tab's Prepare page. If the analysis fails, a
   deterministic brief may remain available for inspection, but the stage is
   failed and Tailor/Review do not start automatically.
4. The `Ctrl+Shift+U` / `⌘⇧U` command runs steps 1 and 3 with no popup open,
   through the same shared bridge and the same status/approval handshake. It
   skips the tracker preview in step 2 — the app still runs its own duplicate
   gates on arrival. A failure leaves a badge on the toolbar icon and a single
   short explanation the popup shows and clears the next time you open it.
5. The popup has no extension AI/deterministic or automatic-tailor toggles.
   Neither entry point has one. The handoff stops on Prepare after the
   duplicate gates and the Job analysis stage.
   The claim token keeps the new posting out of older visible tabs, and the
   extension preserves the source tab's Firefox container when the browser
   accepts that option, with a normal fresh-tab fallback elsewhere.

Each preparation handoff is its own independent RoleFit tab. The claim token
keeps the new posting out of older visible tabs while still allowing a
no-strand fallback if the new tab never opens or closes before draining the
import inbox entry.

Duplicate detection is a workflow gate, not a score. A warning found before or
after Job analysis asks the user to continue the current pipeline or stop; stopping
prevents all later selected AI stages.

The extension does not read the workspace base resume or calculate a local fit
estimate. AI Review in the app returns the score, coverage, and verdict; the
server validates its response shape and anti-fabrication-sensitive edits. Its
output still requires human review.

No build or bundler — `popup.js` is a plain ES module loaded directly by
`popup.html`. There is nothing to compile.
