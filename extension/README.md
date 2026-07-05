# RoleFit AI — browser extension

A Manifest V3 popup (Chrome / Edge / Firefox) that brings the RoleFit AI fit
check to any job posting. Click the toolbar icon on a posting to see a local
fit-score estimate, matched vs missing keywords, whether you've already tracked
or applied to that exact posting, and a one-click import into a fresh app tab.

It talks **only** to your local RoleFit AI server at `http://localhost:5181`.
The local server may then run the configured AI distiller for imports, so posting
text can go through the app's Distill-stage CLI/API provider unless you use a
local model or fall back to the deterministic parser. Start the app
(`npm run dev`) before using it.

## Install (unpacked)

- **Chrome / Edge** — open `chrome://extensions`, enable **Developer mode**,
  click **Load unpacked**, and select this `extension/` folder.
- **Firefox** — open `about:debugging#/runtime/this-firefox`, click
  **Load Temporary Add-on…**, and select `manifest.json`.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | MV3 manifest — `activeTab` + `scripting` + `storage` + `cookies` (the last so imports can open in the source tab's Firefox container), host access to `localhost:5181` only |
| `popup.html` / `popup.css` / `popup.js` | the popup UI (vanilla ESM, no build step) |
| `icons/icon.svg` | toolbar icon |

## How it works

1. On open, the popup injects a small extractor into the active tab
   (`document.body.innerText`, with site-specific selectors for LinkedIn,
   Indeed, Lever, Greenhouse, and Workday tried first).
2. It POSTs the text to `POST /api/extension/analyze`, which scores it against
   your workspace base resume and checks the application tracker by normalized
   URL, then renders the fit ring, keyword chips, and applied-status banner.
3. **Import** POSTs the page text to `POST /api/extension/import` and opens a
   fresh app tab with a short claim token. The server distills the posting in
   the BACKGROUND (AI distiller, with the deterministic engine as fallback), so
   it survives the popup closing on focus loss; the app polls
   `GET /api/extension/inbox?tabId=...&claimToken=...`, which reports progress
   until the brief is ready, then loads the structured fields into that new
   tab's Job field.
4. A **Tailor automatically after import** toggle (a checkbox in the popup,
   persisted via `chrome.storage.local`) makes the app jump straight to polish
   once the brief and your base resume are ready — no second click needed.

Each import is its own independent RoleFit tab. The claim token keeps the new
posting out of older visible tabs while still allowing a no-strand fallback if
the new tab never opens or closes before draining the import.

The fit score is a local keyword-overlap estimate only. The authoritative,
anti-fabrication-gated verdict still comes from polishing in the app.

No build or bundler — `popup.js` is a plain ES module loaded directly by
`popup.html`. There is nothing to compile.
