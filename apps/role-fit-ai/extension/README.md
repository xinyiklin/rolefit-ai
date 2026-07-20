# RoleFit AI — browser extension

A Manifest V3 popup (Chrome / Edge / Firefox) that imports job postings into
RoleFit AI. Click the toolbar icon to see whether you've already tracked or
applied to that posting and import it into a fresh app tab. Fit score, coverage,
and verdict are produced only by AI Review in the main app.

It sends requests **only** to your local RoleFit AI server at
`http://localhost:5181`. The manifest grants `http://localhost/*`, which covers
HTTP on the `localhost` hostname across ports because Chrome and Firefox host
match patterns cannot safely pin one localhost port. The popup target itself
remains fixed to canonical port `5181`. A custom companion port is therefore
for direct browser use, not extension imports.
The server also requires this installed extension's exact Origin. A manifest
host permission permits the request but does not prove which extension sent it.
On first use, the popup sends a short-lived local access request; approve that
exact origin once in the companion before analyze/import becomes available.
For imports, the server prepares the raw posting text; the receiving RoleFit tab
then runs its own Distill-stage CLI or native API provider, or falls straight to the
deterministic parser when **Distill with AI** is off. Start the app
(`npm run dev:rolefit` from the repository root) before using it.

## Install (unpacked)

- **Chrome / Edge** — open `chrome://extensions`, enable **Developer mode**,
  click **Load unpacked**, and select this `extension/` folder.
- **Firefox** — open `about:debugging#/runtime/this-firefox`, click
  **Load Temporary Add-on…**, and select `manifest.json`.

After loading the extension, start the RoleFit companion on port `5181` and
open the popup on a job page. The first request is intentionally blocked and
appears in the companion under **Browser extension**. Select **Approve** once,
allow the companion to restart its local service, and reopen the popup. Remove
the paired origin from the companion to revoke access. Unpacked Chrome ids can
change if the extension is moved or reloaded under a different identity;
Firefox origins are browser/profile-specific, so each distinct installation
requires its own one-time approval.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | MV3 manifest: `activeTab` + `scripting` + `storage` + `cookies` (the last so imports can open in the source tab's Firefox container), with `http://localhost/*` connectivity for the fixed port `5181` popup target; host permission is not server authorization |
| `popup.html` / `popup.css` / `popup.js` | the popup UI (vanilla ESM, no build step) |
| `icons/icon.svg` | toolbar icon |

## How it works

1. On open, the popup injects a small extractor into the active tab
   (`document.body.innerText`, with site-specific selectors for LinkedIn,
   Indeed, Lever, Greenhouse, and Workday tried first).
2. It POSTs the text to `POST /api/extension/analyze`, which extracts job
   identity and checks the application tracker with a layered
   duplicate match (ATS posting id / normalized URL / requisition id in the
   posting / company + title + description overlap), then renders the tracked-
   status banner. When a tracked application matches,
   the banner also shows a compact evidence line (e.g. "Same LinkedIn posting
   (#123)"), prefixed "Possible duplicate:" for a non-exact match. Fuzzy
   company/title matches require substantial descriptions with at least 60%
   overlap; small amounts of shared boilerplate do not produce a warning.
3. **Import** POSTs the page text to `POST /api/extension/import` and opens a
   fresh app tab with a short claim token. The server prepares the raw posting
   text in the BACKGROUND (e.g. fetching the full description for a Greenhouse
   link), so it survives the popup closing on focus loss; the app polls
   `GET /api/extension/inbox?tabId=...&claimToken=...`, which reports progress
   until the text is ready. The receiving tab then runs the AI distill itself
   with its own selected Distill provider and loads the brief into that tab's
   Job field. If AI Distill was selected and fails, the deterministic brief may
   remain visible for inspection, but the stage is failed and automatic polish
   stops. The deterministic parser is a successful path only when **Distill
   with AI** is off.
4. A **Polish automatically after import** toggle (a checkbox in the popup,
   persisted via `chrome.storage.local`) makes the app jump straight to polish
   once the brief and your base resume are ready — no second click needed.
5. A **Distill with AI** toggle (also persisted via `chrome.storage.local`,
   default **on**) controls whether the receiving tab runs the AI distiller on
   the imported posting or falls straight to the deterministic parser. Turn it
   off to skip the provider call for an import. The flag rides the import as
   `distillAi` and is handed back to the app in the inbox payload.

Each import is its own independent RoleFit tab. The claim token keeps the new
posting out of older visible tabs while still allowing a no-strand fallback if
the new tab never opens or closes before draining the import.

Duplicate detection is a workflow gate, not a score. A warning found before or
after Distill asks the user to continue the current pipeline or stop; stopping
prevents all later selected AI stages.

The extension does not read the workspace base resume or calculate a local fit
estimate. AI Review in the app returns the score, coverage, and verdict; the
server validates its response shape and anti-fabrication-sensitive edits. Its
output still requires human review.

No build or bundler — `popup.js` is a plain ES module loaded directly by
`popup.html`. There is nothing to compile.
