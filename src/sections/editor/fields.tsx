import { useLayoutEffect, useRef, type ClipboardEvent, type KeyboardEvent } from "react";

import { inlineMarksToHtml, serializeRichHtml } from "../../lib/inlineMarks";

type RichFieldProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  "aria-label"?: string;
  className?: string;
  autoSize?: boolean;
  multiline?: boolean;
  onEnter?: () => void;
};

function applyFormatHotkey(event: KeyboardEvent<HTMLElement>, emitChange: () => void) {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
  const key = event.key.toLowerCase();
  if (key !== "b" && key !== "i" && key !== "u") return;
  event.preventDefault();
  document.execCommand(key === "b" ? "bold" : key === "i" ? "italic" : "underline");
  emitChange();
}

function insertPlainText(text: string) {
  document.execCommand("insertText", false, text);
}

function RichEditableField({
  value,
  onChange,
  placeholder,
  "aria-label": ariaLabel,
  className = "",
  autoSize,
  multiline = false,
  onEnter
}: RichFieldProps) {
  const ref = useRef<HTMLDivElement>(null);
  const focusedRef = useRef(false);
  const lastHtmlRef = useRef("");

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const html = inlineMarksToHtml(value);
    lastHtmlRef.current = html;
    if (focusedRef.current && serializeRichHtml(el, multiline) === value) return;
    if (el.innerHTML !== html) el.innerHTML = html;
  }, [multiline, value]);

  function emitChange() {
    const el = ref.current;
    if (!el) return;
    const next = serializeRichHtml(el, multiline);
    if (!next && !el.textContent?.trim()) el.innerHTML = "";
    if (next !== value) onChange(next);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    applyFormatHotkey(event, emitChange);
    if (event.defaultPrevented) return;
    if (event.key === "Enter" && !multiline) {
      event.preventDefault();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && onEnter) {
      event.preventDefault();
      onEnter();
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    insertPlainText(multiline ? text : text.replace(/\s*\r?\n+\s*/g, " "));
    emitChange();
  }

  function handleBlur() {
    focusedRef.current = false;
    emitChange();
    const el = ref.current;
    if (el && lastHtmlRef.current !== inlineMarksToHtml(value)) {
      lastHtmlRef.current = inlineMarksToHtml(value);
    }
  }

  return (
    <div
      ref={ref}
      className={`rdx-input${multiline ? " rdx-textarea" : ""}${autoSize ? " rdx-input--autosize" : ""} ${className}`.trim()}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline={multiline || undefined}
      aria-label={ariaLabel}
      data-placeholder={placeholder}
      spellCheck={multiline}
      tabIndex={0}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onInput={emitChange}
      onPaste={handlePaste}
    />
  );
}

// A single-line resume field that blends into the document. The visible control
// is contenteditable so bold/italic/underline render inline; value still stores a
// lightweight serialized form for ResumeData and LaTeX export.
export function EditableInput(props: Omit<RichFieldProps, "multiline" | "onEnter">) {
  return <RichEditableField {...props} />;
}

// Multi-line bullet/skills field. Enter can create the next bullet; Shift+Enter
// inserts a line break inside the current field.
export function AutoTextarea(props: Omit<RichFieldProps, "autoSize" | "multiline">) {
  return <RichEditableField {...props} multiline />;
}
