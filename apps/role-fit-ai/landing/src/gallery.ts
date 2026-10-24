// The workspace gallery is a native scroll-snap list (swipe, trackpad, and
// keyboard scrolling work without script); the arrow buttons step it by one
// card and mark themselves disabled at either end. They use aria-disabled, not
// disabled, so a keyboard user's focus stays on the button that reached the end.
export function setupGallery(reducedMotion: MediaQueryList): void {
  const gallery = document.getElementById("feature-gallery");
  const buttons = document.querySelectorAll<HTMLButtonElement>("[data-gallery-step]");
  if (!gallery || buttons.length === 0) return;

  const step = (): number => {
    const card = gallery.querySelector("li");
    const gap = Number.parseFloat(getComputedStyle(gallery).columnGap) || 0;
    return card ? card.getBoundingClientRect().width + gap : gallery.clientWidth;
  };

  const sync = (): void => {
    const max = gallery.scrollWidth - gallery.clientWidth - 1;
    for (const button of buttons) {
      const direction = Number(button.dataset.galleryStep);
      const atEnd = direction < 0 ? gallery.scrollLeft <= 0 : gallery.scrollLeft >= max;
      button.setAttribute("aria-disabled", String(atEnd));
    }
  };

  for (const button of buttons) {
    button.addEventListener("click", () => {
      if (button.getAttribute("aria-disabled") === "true") return;
      gallery.scrollBy({
        left: Number(button.dataset.galleryStep) * step(),
        behavior: reducedMotion.matches ? "auto" : "smooth",
      });
    });
  }
  gallery.addEventListener("scroll", sync, { passive: true });
  window.addEventListener("resize", sync, { passive: true });
  sync();
}
