import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { ApplicationActionStatus } from "../lib/applicationActionStatus.ts";

const SUCCESS_HOLD_MS = 6000;
// Matches the task cards' leave transition.
const FADE_MS = 300;

type ActionStatusProps = {
  status: ApplicationActionStatus | null;
  suspendExpiry: boolean;
  onDismiss: () => void;
  onDismissButton: () => void;
};

export function ActionStatus({ status, suspendExpiry, onDismiss, onDismissButton }: ActionStatusProps) {
  if (!status) return null;
  return (
    <ActionStatusCard
      status={status}
      suspendExpiry={suspendExpiry}
      onDismiss={onDismiss}
      onDismissButton={onDismissButton}
    />
  );
}

function ActionStatusCard({
  status,
  suspendExpiry,
  onDismiss,
  onDismissButton
}: {
  status: ApplicationActionStatus;
  suspendExpiry: boolean;
  onDismiss: () => void;
  onDismissButton: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const isError = status.tone === "error";
  const expires = !isError && !suspendExpiry && !hovered && !focused;

  useEffect(() => {
    setLeaving(false);
    if (!expires) return;
    const fade = window.setTimeout(() => setLeaving(true), SUCCESS_HOLD_MS);
    const remove = window.setTimeout(onDismiss, SUCCESS_HOLD_MS + FADE_MS);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(remove);
    };
  }, [expires, status, onDismiss]);

  return (
    <div
      className={`action-status${isError ? " action-status--error" : ""}${leaving ? " is-leaving" : ""}`}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <div
        className="action-status__text"
        role={isError ? "alert" : "status"}
        aria-atomic="true"
      >
        <p className="action-status__headline">{status.headline}</p>
        {status.detail ? <p className="action-status__detail">{status.detail}</p> : null}
      </div>
      <button
        type="button"
        className="action-status__dismiss"
        onClick={onDismissButton}
        aria-label="Dismiss action status"
      >
        <X size={13} aria-hidden="true" />
      </button>
    </div>
  );
}
