import { useEffect, useState, type ReactNode } from "react";

// At or below this width the studio layout is replaced by the focused screen-
// size notice.
const MIN_VIEWPORT_WIDTH = 720;

const tooNarrow = () => typeof window !== "undefined" && window.innerWidth <= MIN_VIEWPORT_WIDTH;

// Scope the unsupported-width notice to precise resume authoring. Tracking,
// analytics, and materials remain available at narrow widths and high browser
// zoom instead of the entire product becoming a non-dismissible wall.
export function ViewportGate({ children }: { children: ReactNode }) {
  const [narrow, setNarrow] = useState(tooNarrow);

  useEffect(() => {
    const onResize = () => setNarrow(tooNarrow());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (!narrow) return children;

  return (
    <div className="viewport-gate" role="status" aria-labelledby="viewport-gate-title" tabIndex={-1}>
      <div className="viewport-gate__card">
        <h2 className="viewport-gate__title" id="viewport-gate-title">
          Resume authoring needs more room
        </h2>
        <p className="viewport-gate__body">
          Widen this window for precise editing. Materials, Applications, and Analytics remain available from the left rail.
        </p>
      </div>
    </div>
  );
}
