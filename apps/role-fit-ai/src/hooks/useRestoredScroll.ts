import { useLayoutEffect, useRef } from "react";

/**
 * Keeps a document scroller's offset across the unmount a studio tab switch
 * causes, so returning to Resume or Cover letter shows the part of the page the
 * user was reading rather than the top.
 *
 * Two details make this less trivial than assigning `scrollTop`:
 *
 * 1. The offset cannot be applied on the first commit. The engine paints the
 *    document after layout, so the scroller has no scrollable height yet and the
 *    assignment silently clamps to 0. The layout effect below therefore runs on
 *    every render and retries until the content is tall enough, then stops.
 * 2. It is read in a LAYOUT cleanup, from the element captured at mount. React
 *    runs those before it detaches the node, so the value is still real; a
 *    passive cleanup can see a detached element, whose `scrollTop` reads 0. A
 *    scroll listener would be the obvious alternative and is deliberately not
 *    used — it adds a handler on a hot path to learn something the element
 *    already knows, and scroll events do not fire at all in the QA browser pane,
 *    which would make this unverifiable there.
 */
export function useRestoredScroll(initialTop: number, onExit: (top: number) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const pendingRef = useRef(initialTop);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  useLayoutEffect(() => {
    const el = ref.current;
    const target = pendingRef.current;
    if (!el || target <= 0) return;
    // Strictly: wait for the offset to be reachable rather than clamping to
    // whatever is painted so far, because the first commits are a document of
    // zero height and clamping there would land every return near the top. A
    // document that comes back SHORTER than the offset therefore never
    // restores — acceptable, because the only way it gets shorter is being
    // replaced, and the host clears the stored offset when it opens one.
    if (el.scrollHeight - el.clientHeight < target) return;
    el.scrollTop = target;
    pendingRef.current = 0;
  });

  useLayoutEffect(() => {
    const el = ref.current;
    return () => onExitRef.current(el?.scrollTop ?? 0);
  }, []);

  return ref;
}
