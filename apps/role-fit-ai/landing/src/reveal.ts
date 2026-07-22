// Scroll reveal: each [data-reveal] block fades and lifts into place the first
// time it enters the viewport, then stays (one-shot, never loops). This is a
// progressive enhancement — the hidden start state lives behind `.reveal-ready`
// in CSS, and this only adds that class when motion is allowed. With JS
// disabled or under reduced motion, `.reveal-ready` is never set and every
// block simply stays visible. Anything already on screen at load reveals in the
// same frame so it never flashes hidden; the rest reveals via
// IntersectionObserver, with a scroll listener as the fallback for engines that
// lack it, and a focusin escape hatch so keyboard focus never rests on a block
// that is still faded out. Off-screen blocks stay hidden until reached — never a
// blanket reveal — so lingering on the hero does not skip the effect.
export function setupReveal(): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const blocks = Array.from(
    document.querySelectorAll<HTMLElement>("[data-reveal]"),
  );
  if (blocks.length === 0) return;

  document.documentElement.classList.add("reveal-ready");

  const pending = new Set(blocks);
  const reveal = (el: HTMLElement): void => {
    if (pending.delete(el)) el.classList.add("is-visible");
  };
  const inView = (el: HTMLElement): boolean => {
    const rect = el.getBoundingClientRect();
    return rect.top < window.innerHeight * 0.92 && rect.bottom > 0;
  };
  const revealInView = (): void => {
    for (const el of [...pending]) if (inView(el)) reveal(el);
  };

  revealInView();
  // Everything was already on screen (short page / tall viewport): nothing left
  // to observe, so skip wiring up the focus net and observer entirely.
  if (pending.size === 0) return;

  // Keyboard safety net: if focus lands inside a not-yet-revealed block (a
  // keyboard user tabbing straight to a footer or download link), reveal it at
  // once so focus never rests on content that is still faded out.
  document.addEventListener("focusin", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const block = target.closest<HTMLElement>("[data-reveal]");
    if (block) reveal(block);
  });

  const Observer = window.IntersectionObserver as
    | typeof IntersectionObserver
    | undefined;
  if (!Observer) {
    const onScroll = (): void => {
      revealInView();
      if (pending.size === 0) {
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onScroll);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return;
  }

  const observer = new Observer(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) reveal(entry.target as HTMLElement);
      }
      if (pending.size === 0) observer.disconnect();
    },
    { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
  );
  for (const block of pending) observer.observe(block);
}
