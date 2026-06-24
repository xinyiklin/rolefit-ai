# RoleFit AI — browser extension

A Manifest V3 popup (Chrome / Edge / Firefox) that brings the RoleFit AI fit
check to any job posting. Click the toolbar icon on a posting to see a local
fit-score estimate, matched vs missing keywords, whether you've already tracked
or applied to that exact posting, and a one-click import into the app.

It talks **only** to your local RoleFit AI server at `http://localhost:5181` —
nothing leaves your machine. Start the app (`npm run dev`) before using it.

## Install (unpacked)

- **Chrome / Edge** — open `chrome://extensions`, enable **Developer mode**,
  click **Load unpacked**, and select this `extension/` folder.
- **Firefox** — open `about:debugging#/runtime/this-firefox`, click
  **Load Temporary Add-on…**, and select `manifest.json`.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | MV3 manifest — `activeTab` + `scripting`, host access to `localhost:5181` only |
| `popup.html` / `popup.css` / `popup.js` | the popup UI (vanilla ESM, no build step) |
| `icons/icon.svg` | toolbar icon |

## How it works

1. On open, the popup injects a small extractor into the active tab
   (`document.body.innerText`, with site-specific selectors for LinkedIn,
   Indeed, Lever, Greenhouse, and Workday tried first).
2. It POSTs the text to `POST /api/extension/analyze`, which scores it against
   your workspace base resume and checks the application tracker by normalized
   URL, then renders the fit ring, keyword chips, and applied-status banner.
3. **Import** POSTs the page text to `POST /api/extension/import` (an in-memory
   inbox) and focuses the app tab; the app polls `GET /api/extension/inbox`,
   pulls the text once, and distills it into the Job field — the same pipeline
   as the in-app "Distill paste".

The fit score is a local keyword-overlap estimate only. The authoritative,
anti-fabrication-gated verdict still comes from polishing in the app.

No build or bundler — `popup.js` is a plain ES module loaded directly by
`popup.html`. There is nothing to compile.
