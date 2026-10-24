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
- Show macOS Apple silicon and Windows x64 choices explicitly (no Intel macOS,
  D096).
  Do not guess architecture from user-agent data.
- Direct links are fail-closed: accept either a complete canonical signed
  `rolefit-vX.Y.Z` release or, only when no complete signed release exists, a
  complete `rolefit-preview-vX.Y.Z-beta.N` GitHub prerelease with the exact
  expected assets. Prefer the newest complete signed RoleFit release even when
  a newer unsigned preview exists. The repository may also publish other
  products, so select from the bounded public release list rather than trusting
  repository-wide `/latest`. On a missing,
  partial, malformed, rate-limited, or unavailable response, retain both
  choices but link safely to the Releases page instead of inventing an asset
  URL.
- An unsigned preview must be labeled as unsigned beside the active download
  status and in every artifact format label. State that macOS Gatekeeper and
  Windows SmartScreen warnings are expected; never describe a preview as
  signed, notarized, trusted, or verified by a platform identity.

## Design and verification

- Wear the RoleFit brand direction (DESIGN.md § Public product/download page,
  D097) over the workspace tokens without copying the Drafting Desk shell:
  `landing.css` imports `../../src/styles/tokens.css` (CSS only, never app
  code), so token changes reach this page; landing-only values (brand tints,
  art opacity, shadows, page width) stay in `landing.css`. Light and dark follow
  the OS with no override; no webfonts. Cards and panels share one frosted
  glass recipe (`--glass*` tokens in `landing.css`) with opaque fallbacks for
  no `backdrop-filter` and `prefers-reduced-transparency`; keep text contrast at
  AA over the brightest art behind any glass. Product claims must stay
  short, concrete, and consistent with the local-first trust boundary.
- Brand art lives in `public/assets/art/`: the user-supplied transparent
  `waves-sides.webp` (hero) and `ribbon.webp` (download band, cropped to its own
  bounds), `ribbon-low.webp` (behind the workspace gallery: derived from
  `ribbon.webp`, flattened to 58% height, mirrored, with both ends faded to
  transparent, so every ribbon shares one art style), `ribbon-accent.webp`
  (behind the privacy diagram; generated, accepted only after a side-by-side
  match with `ribbon.webp`), and the kit's
  mobile hero SVG. `rolefit-social-preview.png` and `extension-import.webp`
  were also generated that way; check their text by eye whenever they are
  regenerated, and never accept invented UI labels. Decorative art enters as
  `aria-hidden` images, never a stylesheet `url()` (the build guard rejects
  `url()` in the bundled CSS); the import illustration is content, with alt
  text and a figcaption. The hero art is masked to a wash behind the copy and fades at the
  hero's edge. The ribbon is always shown whole, never cropped or masked, and
  always passes behind content: the low-profile ribbon under the workspace
  gallery's lower edge (the cards sit on it), and the band ribbon behind the
  download card. The user chose this placement over a standalone band and over no
  mid-page ribbon (2026-10-24). `public/assets/logo-symbol.svg`
  is the bare ribbon-R mark; the favicons and touch icon come from
  `desktop/assets/generate_icons.py`. `public/assets/browsers/` holds the
  Chrome and Firefox logos, cut from the browsers' own installed app icons;
  use them only to name supported browsers, never restyled.
- `.device-laptop` is the reusable laptop frame: put any image or element in
  `.device-laptop__screen`; `public/assets/device/laptop.webp` has a transparent
  screen whose measured insets live in that CSS block. A new frame asset needs
  its screen insets re-measured.
- Platform buttons appear in the hero and the download panel; every
  `a[data-download-target]` is upgraded by `main.ts`, and each carries a
  `[data-format]` line that names an unsigned preview. Keep the visible text
  as the accessible name (no `aria-label` override), so the format line and
  "Unsigned" reach screen readers.
- Preserve semantic landmarks, keyboard focus, WCAG AA contrast, useful image
  alternatives, and reduced-motion behavior at desktop and narrow widths.
- The section scroll-reveal and the hero entrance are progressive enhancements,
  not required layout. Keep them one-shot, collapse them fully under
  `prefers-reduced-motion`, and never let a `[data-reveal]` block stay hidden
  without JavaScript: the hidden state is gated behind the script-added
  `.reveal-ready` class, so absent that class every block must render visible.
- Product screenshots in `public/assets/` (and their `docs/` twins) come from a
  copy of the synthetic workspace test pack served through
  `ROLEFIT_WORKSPACE_DIR` on a spare port, never from a real workspace. The
  Prepare and Applications shots show a saved synthetic application whose
  record carries a synthetic Fit Assessment snapshot (no provider or model
  attribution), restored through Edit preparation; captures are light theme.
- **Capture at device scale factor 2.** The cards scale a 1440-wide shot down to
  roughly 550-750 CSS px, so a 1x file lands under one device pixel per CSS
  pixel on an ordinary HiDPI screen and reads blurry; the companion shot was the
  worst at 0.68x. Keep each `<img>` `width`/`height` equal to the file's real
  intrinsic size (2880x1800 for the app, whatever the Electron window yields for
  the companion); the app shots keep their aspect ratio, so layout does not
  move, and a companion recapture may change its height slightly.
- A screenshot whose pixels contain the app version belongs in
  `screenshot-manifest.json` with the version it was captured at. The page also
  renders the live release version from GitHub, so a stale stamp contradicts the
  same page; `assertScreenshotVersionStamps` fails the release and Pages deploy
  gates until the image is retaken and the manifest updated. The manifest sits
  outside `public/`, so it never ships.
- Keep the version out of product chrome that marketing screenshots show
  (user decision, 2026-10-08). The companion shows it only in Settings, so the
  Overview screenshot is retaken when its UI changes, not on every version
  bump, and the manifest may be empty. Prefer this over adding a stamped image.
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
