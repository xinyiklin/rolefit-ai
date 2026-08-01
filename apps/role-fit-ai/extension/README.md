# RoleFit AI — browser extension

A Manifest V3 popup (Chrome / Edge / Firefox) that prepares job postings in
RoleFit AI. Click the toolbar icon to see whether you've already tracked or
applied to that posting and open it in a fresh Prepare tab. Fit score, coverage,
and verdict are produced only by AI Review in the main app.

It sends requests **only** to your local RoleFit AI server at a validated
`http://localhost:<port>` origin. Source development defaults to `5181`. The
desktop companion writes its resolved active port into `runtime-config.js`
inside the materialized extension folder. The manifest grants
`http://localhost/*` because Chrome and Firefox host match patterns cannot
safely pin one localhost port; the popup never scans ports or accepts an
arbitrary origin.
The server also requires this installed extension's exact Origin. A manifest
host permission permits the request but does not prove which extension sent it.
On first use, the popup sends a short-lived local access request; approve that
exact origin once in the companion before analysis/preparation becomes
available. For preparation handoffs, the server prepares the raw posting text;
the receiving RoleFit tab then runs its own Distill-stage CLI or native API
provider, or falls straight to the deterministic parser when **Prepare job
details with AI** is off. Start the app
(`npm run dev:rolefit` from the repository root) before using it.

## Install (unpacked)

**Desktop release:** In the RoleFit companion, open **Browser extension** and
select **Open extension folder**. The companion materializes its allowlisted
extension files inside app data and writes the resolved local port into that
copy so Chrome, Edge, and Firefox can load it outside Electron's packaged
archive. **Copy path** copies that app-owned folder path. The section also has
click-to-copy controls for the exact Chrome (`chrome://extensions`), Edge
(`edge://extensions`), and Firefox
(`about:debugging#/runtime/this-firefox`) setup addresses. These are fixed
desktop API 12 targets: Electron main performs the clipboard write, the
renderer sends only a target id, no filesystem path or arbitrary text is
accepted from the renderer, and no renderer clipboard permission is needed.
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
change RoleFit's port, reload the unpacked extension once from the browser's
Extensions page after the companion restarts. Remove the paired origin from the
companion to revoke access. Unpacked Chrome ids can change if the extension is
moved or reloaded under a different identity; Firefox origins are
browser/profile-specific, so each distinct installation requires its own
one-time approval.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | MV3 manifest: `activeTab` + `scripting` + `storage` + `cookies` (the last so imports can open in the source tab's Firefox container), with `http://localhost/*` connectivity; host permission is not server authorization |
| `runtime-config.js` | validated localhost port; defaults to `5181` in source and is regenerated in the companion-owned materialized copy |
| `popup.html` / `popup.css` / `popup.js` | the popup UI (vanilla ESM, no build step) |
| `icons/icon.svg` | toolbar icon |

## How it works

1. On open, the popup injects a small extractor into the active tab
   (`document.body.innerText`, with site-specific selectors for LinkedIn,
   Indeed, Lever, Greenhouse, and Workday tried first).
2. It POSTs the text to `POST /api/extension/analyze`, which extracts job
   identity and checks the application tracker with a layered
   duplicate match (ATS posting id / normalized URL / requisition id in the
   posting / no-id company + title + description overlap), then renders the
   tracked-status banner. Shared posting or requisition ids are exact; a
   normalized URL is exact unless explicit ids conflict. Different explicit ids
   default to separate postings; only an exceptionally strong
   company/title/location/content match raises a review-only warning for a
   likely id input error. When a tracked application matches, the banner also
   shows a compact evidence line (e.g. "Same LinkedIn posting (#123)"),
   prefixed "Possible duplicate:" for a non-exact match. No-id fuzzy matching
   requires substantial descriptions with aligned metadata plus strong lexical
   and ordered-phrase overlap; small amounts of shared boilerplate do not
   produce a warning.
3. **Prepare in RoleFit AI** POSTs the page text to the existing
   `POST /api/extension/import` route and opens a fresh app tab with a short
   claim token. The server prepares the raw posting
   text in the BACKGROUND (e.g. fetching the full description for a Greenhouse
   link), so it survives the popup closing on focus loss; the app polls
   `GET /api/extension/inbox?tabId=...&claimToken=...`, which reports progress
   until the text is ready. The receiving tab then runs the AI distill itself
   with its own selected Distill provider and loads the brief into that tab's
   Prepare page. If AI Distill was selected and fails, the deterministic brief
   may remain visible for inspection, but the stage is failed and automatic
   tailoring stops. The deterministic parser is a successful path only when
   **Prepare job details with AI** is off.
4. A **Tailor resume after preparation** toggle (a checkbox in the popup,
   persisted via `chrome.storage.local`) makes the app continue from Prepare
   into tailoring once the brief and base resume are ready — no second click
   needed. Its existing inbox field remains `autoTailor`.
5. A **Prepare job details with AI** toggle (also persisted via
   `chrome.storage.local`, default **on**) controls whether the receiving tab
   runs the AI distiller on the prepared posting or falls straight to the
   deterministic parser. Turn it off to skip the provider call. The unchanged
   `distillAi` field travels through the import and inbox payloads.

Each preparation handoff is its own independent RoleFit tab. The claim token
keeps the new posting out of older visible tabs while still allowing a
no-strand fallback if the new tab never opens or closes before draining the
import inbox entry.

Duplicate detection is a workflow gate, not a score. A warning found before or
after Distill asks the user to continue the current pipeline or stop; stopping
prevents all later selected AI stages.

The extension does not read the workspace base resume or calculate a local fit
estimate. AI Review in the app returns the score, coverage, and verdict; the
server validates its response shape and anti-fabrication-sensitive edits. Its
output still requires human review.

No build or bundler — `popup.js` is a plain ES module loaded directly by
`popup.html`. There is nothing to compile.
