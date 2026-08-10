# RoleFit Public Landing Guide

Applies to `apps/role-fit-ai/landing/` and `vite.landing.config.ts`. Follow the
root and RoleFit app guides first.

## Boundary

- This directory owns the static public product and download page. It is a
  separate Vite entry graph from the localhost Drafting Desk in `src/`.
- The hosted page may fetch public release metadata from GitHub and link to
  canonical GitHub Release assets. It never calls loopback or RoleFit `/api/*`
  routes, probes whether software is installed, pairs with Electron, collects
  provider credentials, or renders the full RoleFit application.
- The installed companion is the supported product launcher. It starts the
  loopback server, manages providers, and opens the full app in the user's
  browser. The public page only explains and distributes that local runtime.
- Show macOS Apple silicon, macOS Intel, and Windows x64 choices explicitly.
  Do not guess architecture from user-agent data.
- Direct links are fail-closed: accept either a complete canonical signed
  `rolefit-vX.Y.Z` release or, only when no complete signed release exists, a
  complete `rolefit-preview-vX.Y.Z-beta.N` GitHub prerelease with the exact
  expected assets. Prefer the newest complete signed RoleFit release even when
  a newer unsigned preview exists. The repository may also publish other
  products, so select from the bounded public release list rather than trusting
  repository-wide `/latest`. On a missing,
  partial, malformed, rate-limited, or unavailable response, retain the three
  choices but link safely to the Releases page instead of inventing an asset
  URL.
- An unsigned preview must be labeled as unsigned beside the active download
  status and in every artifact format label. State that macOS Gatekeeper and
  Windows SmartScreen warnings are expected; never describe a preview as
  signed, notarized, trusted, or verified by a platform identity.

## Design and verification

- Use RoleFit's calm editorial palette and typography without copying the
  dense Drafting Desk shell. Product claims must stay short, concrete, and
  consistent with the local-first trust boundary.
- Preserve semantic landmarks, keyboard focus, WCAG AA contrast, useful image
  alternatives, and reduced-motion behavior at desktop and narrow widths.
- The section scroll-reveal and card hover-lift are progressive enhancements,
  not required layout. Keep them one-shot, collapse them fully under
  `prefers-reduced-motion`, and never let a `[data-reveal]` block stay hidden
  without JavaScript: the hidden state is gated behind the script-added
  `.reveal-ready` class, so absent that class every block must render visible.
- Product screenshots in `public/assets/` (and their `docs/` twins) come from a
  copy of the synthetic workspace test pack served through
  `ROLEFIT_WORKSPACE_DIR` on a spare port, never from a real workspace.
- **Capture at device scale factor 2.** The cards scale a 1440-wide shot down to
  roughly 550-750 CSS px, so a 1x file lands under one device pixel per CSS
  pixel on an ordinary HiDPI screen and reads blurry; the companion shot was the
  worst at 0.68x. Keep each `<img>` `width`/`height` equal to the file's real
  intrinsic size (2880x1800 for the app, whatever the Electron window yields for
  the companion) — the aspect ratio is unchanged, so layout does not move.
- A screenshot whose pixels contain the app version belongs in
  `screenshot-manifest.json` with the version it was captured at. The page also
  renders the live release version from GitHub, so a stale stamp contradicts the
  same page; `assertScreenshotVersionStamps` fails the release and Pages deploy
  gates until the image is retaken and the manifest updated. The manifest sits
  outside `public/`, so it never ships.
- `npm run build:landing --workspace apps/role-fit-ai` must typecheck the
  landing, run the release-catalog probes, build only `dist-landing/`, and pass
  the output-boundary guard.
- Release parsing belongs in a pure module with offline probes.
- **Deliberate exception to the flag-first browser-QA default:** this is the
  public product page, so material UI changes require real-browser desktop and
  narrow-width evidence rather than a flagged risk. Note that the QA pane is
  paint-gated — `IntersectionObserver`, rAF, and transitions do not fire while
  it is occluded, so scroll reveals read as permanently hidden. Force frames
  with a real scroll or screenshot gesture, or force `.reveal-ready` and the
  end state and inspect the wiring.
