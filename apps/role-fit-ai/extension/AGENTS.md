# RoleFit Browser Extension Guide

Applies to `apps/role-fit-ai/extension/`. The extension is a no-build Manifest
V3 client of the local RoleFit server.

- Keep `popup.js` plain browser ESM and `popup.css` self-contained; do not add a
  bundler or framework without explicit approval.
- Request only permissions required by the current import/container behavior.
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
  popup keeps its API target fixed to the canonical port `5181`. Companion
  custom ports are browser-only until a separate extension port/discovery
  contract is implemented; do not imply otherwise in either surface.
- Manifest host permission allows the popup to attempt the localhost request;
  it does not authenticate the extension to RoleFit. Keep the Firefox add-on
  id stable, but configure the actual browser/profile Origin reported by
  `location.origin`; do not add a repo-authored Chrome manifest key or a static
  bearer value as a substitute for server-side identity validation.
- `Distill with AI` and auto-polish intent travel with the inbox entry; the app
  owns provider execution and fail/duplicate gates.
- Keep popup copy aligned with `extension/README.md` and server route shapes.
- Verify syntax, manifest validity, duplicate/import responses, and the fresh-tab
  handoff. Browser manual checks are required for popup interaction changes.
