import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Square } from "lucide-react";

// A double-click must not land its second click on the opposite action: Polish
// then Stop, or Stop then Polish again.
const ACTION_GUARD_MS = 600;

type PolishActionButtonProps = {
  label: string;
  disabled: boolean;
  starting?: boolean;
  polishing: boolean;
  onPolish: () => void;
  onStop: () => void;
};

// The rail's one primary action. While a run is in flight the same button is
// its Stop: it reads "Polishing…" and turns to Stop on hover or focus.
export function PolishActionButton({
  label,
  disabled,
  starting = false,
  polishing,
  onPolish,
  onStop
}: PolishActionButtonProps) {
  const [stopArmed, setStopArmed] = useState(false);
  const stoppedAtRef = useRef(-Infinity);
  useEffect(() => {
    if (!polishing) return;
    const timer = window.setTimeout(() => setStopArmed(true), ACTION_GUARD_MS);
    return () => {
      window.clearTimeout(timer);
      setStopArmed(false);
    };
  }, [polishing]);

  if (polishing) {
    return (
      <button
        type="button"
        className={`primary-button is-compact polish-action is-polishing${stopArmed ? " is-armed" : ""}`}
        title="Stop Polish"
        onClick={() => {
          if (!stopArmed) return;
          stoppedAtRef.current = performance.now();
          onStop();
        }}
      >
        {/* The name carries both words, so it matches either visible face. */}
        <span className="sr-only">Polishing… Stop</span>
        {/* Both faces share one grid cell, so the swap never changes the width. */}
        <span className="polish-action__face polish-action__face--busy" aria-hidden="true">
          <LoaderCircle className="spin" size={13} />
          Polishing…
        </span>
        <span className="polish-action__face polish-action__face--stop" aria-hidden="true">
          <Square size={9} fill="currentColor" strokeWidth={0} />
          Stop
        </span>
      </button>
    );
  }
  return (
    <button
      type="button"
      className="primary-button is-compact"
      disabled={disabled || starting}
      aria-busy={starting}
      onClick={() => {
        if (performance.now() - stoppedAtRef.current < ACTION_GUARD_MS) return;
        onPolish();
      }}
    >
      {starting ? "Starting…" : label}
    </button>
  );
}
