import { useEffect, useState } from "react";

// Below this width the studio layout (tab rail, Format/Style menus, the
// page-proportional resume preview) gets too cramped to use — the app is a
// desktop-width tool. Single knob: bump it if the breakpoint should move.
export const MIN_VIEWPORT_WIDTH = 720;

const tooNarrow = () => typeof window !== "undefined" && window.innerWidth < MIN_VIEWPORT_WIDTH;

// Full-cover notice shown when the window is narrower than the app supports.
// Dismissible ("Continue anyway") for anyone who wants to push through; once the
// window is widened past the threshold it hides on its own.
export function ViewportGate() {
  const [narrow, setNarrow] = useState(tooNarrow);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const onResize = () => setNarrow(tooNarrow());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (!narrow || dismissed) return null;

  return (
    <div className="viewport-gate" role="alertdialog" aria-modal="true" aria-labelledby="viewport-gate-title">
      <div className="viewport-gate__card">
        <span className="viewport-gate__brand">RoleFit AI</span>
        <h2 className="viewport-gate__title" id="viewport-gate-title">
          Best on a wider screen
        </h2>
        <p className="viewport-gate__body">
          The resume editor is built for desktop-width windows and gets cramped below {MIN_VIEWPORT_WIDTH}px.
          Widen this window — or open RoleFit AI on a larger screen — for the full layout.
        </p>
        <button type="button" className="secondary-button" onClick={() => setDismissed(true)}>
          Continue anyway
        </button>
      </div>
    </div>
  );
}
