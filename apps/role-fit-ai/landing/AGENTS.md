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
- `npm run build:landing --workspace apps/role-fit-ai` must typecheck the
  landing, run the release-catalog probes, build only `dist-landing/`, and pass
  the output-boundary guard.
- Release parsing belongs in a pure module with offline probes. Material UI
  changes require real-browser desktop and narrow-width evidence.
