// Chromium can repaint backdrop-filter layers from stale textures while the
// window is being resized (blank cards, a copy of the header inside them).
// While the width is changing, `.is-resizing` swaps the frosted glass for its
// opaque fallback; once resizing settles the layers rebuild at the final size.
// Height-only changes (a mobile URL bar collapsing on scroll) are ignored.
export function setupResizeGuard(): void {
  const root = document.documentElement;
  let lastWidth = window.innerWidth;
  let settle = 0;
  window.addEventListener("resize", () => {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    root.classList.add("is-resizing");
    window.clearTimeout(settle);
    settle = window.setTimeout(() => root.classList.remove("is-resizing"), 200);
  });
}
