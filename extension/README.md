# RoleFit AI — browser extension

A Manifest V3 popup (Chrome / Edge / Firefox) that brings the RoleFit AI fit
check to any job posting. Click the toolbar icon on a posting to see a local
fit-score estimate, matched vs missing keywords, whether you've already tracked
or applied to that exact posting, and a one-click import into a fresh app tab.

It talks **only** to your local RoleFit AI server at `http://localhost:5181`.
For imports, the server prepares the raw posting text; the receiving RoleFit tab
then runs its own Distill-stage CLI/API/local provider, or falls straight to the
deterministic parser when **Distill with AI** is off. Start the app
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
   your workspace base resume and checks the application tracker with a layered
   duplicate match (ATS posting id / normalized URL / requisition id in the
   posting / company + title + description overlap), then renders the fit ring,
   keyword chips, and applied-status banner. When a tracked application matches,
   the banner also shows a compact evidence line (e.g. "Same LinkedIn posting
   (#123)"), prefixed "Possible duplicate:" for a non-exact match.
3. **Import** POSTs the page text to `POST /api/extension/import` and opens a
   fresh app tab with a short claim token. The server prepares the raw posting
   text in the BACKGROUND (e.g. fetching the full description for a Greenhouse
   link), so it survives the popup closing on focus loss; the app polls
   `GET /api/extension/inbox?tabId=...&claimToken=...`, which reports progress
   until the text is ready. The receiving tab then runs the AI distill itself
   with its own selected Distill provider (deterministic engine as fallback)
   and loads the brief into that tab's Job field.
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

The fit score is a local keyword-overlap estimate only. Polishing in the app
provides the fuller provider-backed review with deterministic
grounding/sanitization checks; its output still requires human review.

No build or bundler — `popup.js` is a plain ES module loaded directly by
`popup.html`. There is nothing to compile.
