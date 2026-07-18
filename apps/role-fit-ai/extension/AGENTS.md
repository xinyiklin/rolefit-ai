# RoleFit Browser Extension Guide

Applies to `apps/role-fit-ai/extension/`. The extension is a no-build Manifest
V3 client of the local RoleFit server.

- Keep `popup.js` plain browser ESM and `popup.css` self-contained; do not add a
  bundler or framework without explicit approval.
- Request only permissions required by the current import/container behavior.
- The extension may extract the visible posting and query duplicate status. It
  never reads the workspace resume and never calculates a fit score/verdict.
- Keep all server access fixed to local RoleFit routes. Preserve exact
  extension-origin CORS and the claim-token handoff into a fresh app tab.
- `Distill with AI` and auto-polish intent travel with the inbox entry; the app
  owns provider execution and fail/duplicate gates.
- Keep popup copy aligned with `extension/README.md` and server route shapes.
- Verify syntax, manifest validity, duplicate/import responses, and the fresh-tab
  handoff. Browser manual checks are required for popup interaction changes.
