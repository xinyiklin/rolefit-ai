# RoleFit Browser Extension Guide

Applies to `apps/role-fit-ai/extension/`. The extension is a no-build Manifest
V3 client of the local RoleFit server.

- Keep `popup.js` plain browser ESM and `popup.css` self-contained; do not add a
  bundler or framework without explicit approval.
- This directory is loaded by the browser exactly as it sits, so it holds only
  shipped files plus these two guides. Chrome refuses to load a directory
  containing any entry whose name begins with `_`, which is why the popup and
  settings contracts live in `apps/role-fit-ai/__evals__/` rather than here.
  `EXTENSION_FILES` in `desktop/extension-bundle.cts` is the single definition
  of the shipped set — the contract eval parses it and the bundle probe imports
  it, so add a new file there and nowhere else. Dotfiles are ignored by that
  check: macOS writes `.DS_Store` into the folder the install flow asks the user
  to pick, and the browser does not care.
- Every local request carries a timeout. An unbounded `fetch` to a port that
  accepts the connection and never answers hangs the popup behind a progress bar
  with no exit, and strands the keyboard command with no popup to report it. A
  timed-out request reads differently from an unreachable one; keep both.
- Route a failure to the recovery that can actually fix it. Only the status
  handshake failing means the port might be wrong, so only it reaches the port
  form; a slow analyze or import is a retry, and a pairing request that went
  unanswered is "unconfirmed", not "approve this". A view whose title asserts one
  cause while its copy states another is a defect even when both strings are true.
- No failure may be silent. An action that fails and then recovers must leave the
  reason on screen — the inline notice exists for exactly the case where a
  reconnect redraws an identical view and the failure becomes invisible.
- Model the import as `idle → importing → opened`, not a boolean. The terminal
  state is what stops a finished import from reading as a stuck "Preparing", and
  what keeps a completed action from inviting a duplicate.
- Storage and badge writes absorb their own rejections. Both return promises in
  Firefox, so `void call()` inside a `try` leaves an unhandled rejection — the
  `try` guards only the synchronous Chrome form.
- Rendering replaces `#root` wholesale, so anything that must outlive a render
  lives outside it. The live region is a persistent element in `popup.html` that
  `render()` writes into — a `role="status"` node rebuilt each time announces
  nothing reliably — and only asynchronous state (progress, import phase) is
  announced, since a settled view is there to be read. Keyboard focus survives
  through `data-focus-key`: the key is read from `activeElement` and from a
  `focusin` tracker, because a handler that disables its own control (Save,
  Reset) has already blurred it. When the keyed control is gone, focus parks on
  the view, which carries the `view` key so a two-step transition
  (loading → job) keeps handing focus forward instead of dropping to `<body>`.
- Module ownership: `bridge.js` is the only client of the local server and the
  only page-capture path; `settings.js` is the only `chrome.storage.local`
  boundary; `popup.js` is UI and flow state; `background.js` is the keyboard
  command only. A second fetch to a RoleFit route, a second extractor, or a
  second storage reader outside those owners is a defect, not a shortcut — both
  entry points must clear the same `confirmPairedService` gate before any page
  text leaves the browser.
- The popup and the `import-job` command are two entry points to one flow. The
  command runs with no popup rendered, so it reports through the toolbar badge
  plus a one-shot `chrome.storage.local` notice the popup shows and clears on
  its next open. Never let a headless failure fail silently, and never let a
  stale notice read as the current state (it is TTL-bounded).
- The command is a user gesture, which is what grants `activeTab` for its
  capture. Keep it that way: do not add a job-board host permission, a content
  script, or an alarm/periodic capture to make the shortcut work.
- `background.js` is declared for both engines (`service_worker` for Chrome,
  `scripts` for Firefox, `type: "module"` for both). Firefox needs 128+ for a
  module event page, which is why `strict_min_version` is `128.0`; Chrome logs
  an unrecognized-key warning for `scripts` and uses the service worker.
- Detect the engine with a long-standing engine-only API
  (`browser.runtime.getBrowserInfo`), never with the newest API you happen to
  want. Detecting Firefox by `commands.openShortcutSettings` (Firefox 137+) sent
  every older Firefox down the Chrome path and into a `chrome://` URL it is not
  allowed to open. Each capability is then feature-detected separately, with a
  spoken fallback when the browser cannot be navigated to its own settings.
- Report what is actually known. A failed or empty `commands.getAll` means the
  shortcuts are unreadable, not that the user cleared them — Firefox reads the
  manifest once at load, so an add-on loaded before a `commands` change has none
  registered while its popup files are re-read on every open. That combination
  is a stale load, and the popup says so instead of showing "not assigned".
- The popup's `#root` ships a static failure line that the first render
  replaces. An install missing one of its ES modules would otherwise open as a
  blank popup with nothing to act on.
- Request only permissions required by the current import/container behavior.
  The keyboard path added none.
- The extension may extract the visible posting and query duplicate status. It
  never reads the workspace resume and never calculates a fit score/verdict.
- Keep all server access fixed to local RoleFit routes. The localhost server
  must require the popup's exact configured Origin through
  `EXTENSION_ALLOWED_ORIGINS`; an extension URL scheme alone is never an
  identity, and an unset/invalid allowlist must reject every analyze/import
  request. A valid unapproved origin may request first-use approval but receives
  no tracker/import data until the user approves it in the companion. Preserve
  exact-Origin CORS and the claim-token handoff into a fresh app tab.
- Chrome and Firefox host match patterns cannot safely express one localhost
  port, so the manifest permits only the `http://localhost/*` host while the
  popup accepts only the validated numeric localhost port from its one
  versioned `chrome.storage.local` record `{schemaVersion: 1, localSitePort}`.
  Source `runtime-config.js` defaults to `5181` and is only the validated
  first-install seed; saved storage wins. Never scan localhost ports, use a
  locator, open a second listener, or accept a page-supplied API origin.
  Changing ports is recovered in the popup's inline Settings view without an
  extension reload. Port and shortcut settings live in that view, not in a
  separate options page: the port must be editable at the moment the connection
  fails, which is inside the popup's own error state.
- Before sending page text, the popup calls same-port `GET
  /api/extension/status` and requires the exact RoleFit service marker.
  Privileged extension-page GETs may omit `Origin`, so `paired: false` sends the
  popup through the origin-bearing pairing POST; only that POST or a status GET
  carrying the exact Origin can confirm approval. Status and pairing expose no
  posting/tracker data; analyze and import remain blocked until the exact
  extension Origin is approved.
- Manifest host permission allows the popup to attempt the localhost request;
  it does not authenticate the extension to RoleFit. Keep the Firefox add-on
  id stable, but configure the actual browser/profile Origin reported by
  `location.origin`; do not add a repo-authored Chrome manifest key or a static
  bearer value as a substitute for server-side identity validation.
- The popup has no AI/deterministic or automatic-tailor toggles. Extension
  intake sends only `text`, `url`, and `claimToken` to import; the same-origin
  inbox delivers only `text` and `url`. The app always owns provider-backed AI
  job analysis, duplicate gates, the deterministic brief used only for failed-run
  inspection, and the stop on Prepare. Claim-token routing and Firefox
  container preservation remain part of the handoff. This holds for the
  keyboard command exactly as it does for the popup button.
- Visual contract: the popup is the Drafting Desk at 344px, not a second visual
  world. Hairlines and paper tones carry structure, ledger rows with dotted
  leaders carry facts, status is a dot beside a word, and the forest accent is
  reserved for the one primary action. No filled status banners, no icon-plus-
  heading cards, no glyph or emoji icons (icons are inline stroke SVG), and no
  motion beyond the masthead working rule. Popup type runs below the DESIGN.md
  ramp on purpose — 344px chrome cannot carry the 1440px desk's sizes.
- Keep popup copy aligned with `extension/README.md` and server route shapes.
  Copy is one short line: an error names the problem and its recovery.
- Verify syntax, manifest validity, generated-port validation,
  duplicate/import responses, and the fresh-tab handoff. Browser manual checks
  are required for popup interaction changes; the popup renders against stubbed
  extension APIs, so state coverage does not need a real unpacked install.
