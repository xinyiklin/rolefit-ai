import { ExternalLink, Link2, Unlink } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { normalizeLinkDestination } from "@typeset/engine/lib/links";
import { Popover } from "../Popover";
import { ToolbarButton } from "./ToolbarButton";

export type LinkControlProps = {
  href: string | null;
  // The current display text (selection or the existing link's text); pre-fills
  // the Text field so the visible text can differ from the URL.
  text: string;
  automatic: boolean;
  disabled: boolean;
  onApply: (payload: { text: string; href: string }) => void;
  onRemove: () => void;
  // Optional controlled open state so the editor's right-click "Add/Edit link"
  // items can drive this same popover. Falls back to internal state (Ctrl/⌘K).
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function LinkControl({
  href,
  text,
  automatic,
  disabled,
  onApply,
  onRemove,
  open: controlledOpen,
  onOpenChange
}: LinkControlProps) {
  const [textDraft, setTextDraft] = useState(text);
  const [linkDraft, setLinkDraft] = useState(href ?? "");
  const [error, setError] = useState("");
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (disabled || event.altKey || event.shiftKey || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      setOpen(true);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [disabled, setOpen]);

  // Seed both fields from the current link each time the popover opens — covers
  // the trigger/⌘K path and the editor forcing it open via the controlled prop
  // (which never fires the Popover's own onOpenChange).
  useEffect(() => {
    if (open) {
      setTextDraft(text);
      setLinkDraft(href ?? "");
      setError("");
    }
  }, [open, href, text]);

  return (
    <Popover
      ariaLabel={href ? "Edit link" : "Insert link"}
      align="center"
      className="link-control"
      initialFocus="first"
      open={open}
      onOpenChange={setOpen}
      trigger={(triggerProps, open) => (
        <ToolbarButton
          {...triggerProps}
          label={href ? "Edit link" : "Insert link"}
          tooltip={href ? "Edit link" : "Insert link"}
          shortcut="Ctrl/⌘K"
          icon={<Link2 size={16} />}
          pressed={Boolean(href) || open}
          onMouseDown={(event) => event.preventDefault()}
          disabled={disabled}
        />
      )}
    >
      {({ close }) => (
        <form
          className="link-control__panel"
          onSubmit={(event) => {
            event.preventDefault();
            const normalized = normalizeLinkDestination(linkDraft);
            if (!normalized) {
              setError("Enter an email address or an http(s) link.");
              return;
            }
            // Fall back to the URL as the visible text when the Text field is left
            // empty (matches Google Docs).
            onApply({ text: textDraft.trim() || linkDraft.trim(), href: normalized });
            close();
          }}
        >
          <div className="link-control__heading">
            <strong>{href ? "Edit link" : "Insert link"}</strong>
            {automatic ? <span>Detected</span> : null}
          </div>
          <label className="link-control__field">
            <span>Text</span>
            <input
              type="text"
              value={textDraft}
              placeholder="Text to display"
              onChange={(event) => setTextDraft(event.target.value)}
            />
          </label>
          <label className="link-control__field">
            <span>Link</span>
            <input
              type="text"
              inputMode="url"
              value={linkDraft}
              placeholder="example.com or name@example.com"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "link-control-error" : undefined}
              onChange={(event) => {
                setLinkDraft(event.target.value);
                setError("");
              }}
            />
          </label>
          {error ? <p id="link-control-error" className="link-control__error" role="alert">{error}</p> : null}
          <div className="link-control__actions">
            {href ? (
              <button
                type="button"
                className="link-control__remove"
                onClick={() => {
                  onRemove();
                  close();
                }}
              >
                <Unlink size={14} aria-hidden="true" />
                Remove
              </button>
            ) : <span />}
            <div className="link-control__actions-end">
              {href ? (
                <a
                  className="link-control__open"
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => close()}
                >
                  <ExternalLink size={14} aria-hidden="true" />
                  Open
                </a>
              ) : null}
              <button type="submit" className="link-control__apply">Apply</button>
            </div>
          </div>
        </form>
      )}
    </Popover>
  );
}
