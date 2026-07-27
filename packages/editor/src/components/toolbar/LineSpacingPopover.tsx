import { Check, ChevronDown, ListCollapse } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import {
  PARAGRAPH_LINE_HEIGHT_MAX,
  PARAGRAPH_LINE_HEIGHT_MIN,
  PARAGRAPH_SPACE_MAX_PT
} from "@typeset/engine/lib/inlineMarksText.ts";
import { Modal } from "../Modal.tsx";
import { Popover } from "../Popover";
import { ToolbarButton } from "./ToolbarButton";

export type CustomSpacingValues = {
  lineHeight: number;
  spaceBeforePt: number;
  spaceAfterPt: number;
};

export type ParagraphSpacingControls = {
  lineHeight: number | null;
  spaceBeforePt: number | null;
  spaceAfterPt: number | null;
  onLineHeightChange: (value: number) => void;
  onSpaceBeforeChange: (valuePt: number) => void;
  onSpaceAfterChange: (valuePt: number) => void;
  onCustomChange?: (values: CustomSpacingValues) => void;
  onRequestEditorFocus?: () => void;
  disabled?: boolean;
};

const LINE_HEIGHT_OPTIONS = [
  { value: 1, label: "Single" },
  { value: 1.15, label: "1.15" },
  { value: 1.5, label: "1.5" },
  { value: 2, label: "Double" }
] as const;

const ADDED_PARAGRAPH_SPACE_PT = 8;

const bounded = (value: string, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  const finite = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(max, Math.max(min, Math.round(finite * 10) / 10));
};

function CustomSpacingModal({
  controls,
  onClose
}: {
  controls: ParagraphSpacingControls;
  onClose: () => void;
}) {
  const [lineHeight, setLineHeight] = useState(
    () => Number(controls.lineHeight ?? 1.15).toString()
  );
  const [spaceBefore, setSpaceBefore] = useState(
    () => Number(controls.spaceBeforePt ?? 0).toString()
  );
  const [spaceAfter, setSpaceAfter] = useState(
    () => Number(controls.spaceAfterPt ?? 0).toString()
  );
  const close = () => {
    onClose();
    controls.onRequestEditorFocus?.();
  };

  const apply = (event: FormEvent) => {
    event.preventDefault();
    const values = {
      lineHeight: bounded(
        lineHeight,
        controls.lineHeight ?? 1.15,
        PARAGRAPH_LINE_HEIGHT_MIN,
        PARAGRAPH_LINE_HEIGHT_MAX
      ),
      spaceBeforePt: bounded(
        spaceBefore,
        controls.spaceBeforePt ?? 0,
        0,
        PARAGRAPH_SPACE_MAX_PT
      ),
      spaceAfterPt: bounded(
        spaceAfter,
        controls.spaceAfterPt ?? 0,
        0,
        PARAGRAPH_SPACE_MAX_PT
      )
    };
    if (controls.onCustomChange) controls.onCustomChange(values);
    else {
      controls.onLineHeightChange(values.lineHeight);
      controls.onSpaceBeforeChange(values.spaceBeforePt);
      controls.onSpaceAfterChange(values.spaceAfterPt);
    }
    close();
  };

  return (
    <Modal title="Custom spacing" onClose={close} showClose={false}>
      <form className="custom-spacing-modal" onSubmit={apply}>
        <div className="modal__body custom-spacing-modal__body">
          <label className="custom-spacing-modal__field">
            <span>Line spacing</span>
            <input
              data-autofocus
              type="number"
              inputMode="decimal"
              min={PARAGRAPH_LINE_HEIGHT_MIN}
              max={PARAGRAPH_LINE_HEIGHT_MAX}
              step="0.05"
              value={lineHeight}
              onChange={(event) => setLineHeight(event.target.value)}
            />
          </label>

          <fieldset className="custom-spacing-modal__paragraph">
            <legend>Paragraph spacing (pts)</legend>
            <div className="custom-spacing-modal__pair">
              <label className="custom-spacing-modal__field">
                <span>Before</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max={PARAGRAPH_SPACE_MAX_PT}
                  step="1"
                  value={spaceBefore}
                  onChange={(event) => setSpaceBefore(event.target.value)}
                />
              </label>
              <label className="custom-spacing-modal__field">
                <span>After</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max={PARAGRAPH_SPACE_MAX_PT}
                  step="1"
                  value={spaceAfter}
                  onChange={(event) => setSpaceAfter(event.target.value)}
                />
              </label>
            </div>
          </fieldset>
        </div>
        <footer className="modal__foot custom-spacing-modal__foot">
          <button type="button" className="custom-spacing-modal__cancel" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="custom-spacing-modal__apply">
            Apply
          </button>
        </footer>
      </form>
    </Modal>
  );
}

export function LineSpacingPopover({
  controls,
  disabled = false
}: {
  controls?: ParagraphSpacingControls;
  disabled?: boolean;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const unavailable = disabled || !controls || controls.disabled;
  const selectedLineHeight = LINE_HEIGHT_OPTIONS.find(
    (option) =>
      controls?.lineHeight !== null
      && Math.abs((controls?.lineHeight ?? 0) - option.value) < 0.005
  )?.value;

  useEffect(() => {
    if (unavailable) setCustomOpen(false);
  }, [unavailable]);

  const commit = (action: () => void) => {
    action();
    controls?.onRequestEditorFocus?.();
  };

  return (
    <>
      <Popover
        ariaLabel="Line and paragraph spacing"
        align="end"
        className="line-spacing-popover"
        trigger={(triggerProps, open) => (
          <ToolbarButton
            {...triggerProps}
            className={open ? "is-active" : ""}
            label="Line spacing"
            tooltip={unavailable ? "Place the caret on a line to change spacing" : "Line and paragraph spacing"}
            icon={<ListCollapse size={16} />}
            trailingIcon={<ChevronDown size={13} />}
            showLabel
            disabled={Boolean(unavailable)}
          />
        )}
      >
        {({ close }) => (
          <div className="line-spacing-menu">
            <div className="line-spacing-menu__options" role="group" aria-label="Line spacing">
              {LINE_HEIGHT_OPTIONS.map((option) => {
                const selected = selectedLineHeight === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={`line-spacing-menu__option${selected ? " is-selected" : ""}`}
                    aria-pressed={selected}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => commit(() => controls?.onLineHeightChange(option.value))}
                  >
                    <span className="line-spacing-menu__check" aria-hidden="true">
                      {selected ? <Check size={16} /> : null}
                    </span>
                    <span>{option.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="line-spacing-menu__section">
              <button
                type="button"
                className="line-spacing-menu__option"
                aria-pressed={(controls?.spaceBeforePt ?? 0) > 0}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() =>
                  commit(() =>
                    controls?.onSpaceBeforeChange(
                      (controls.spaceBeforePt ?? 0) > 0 ? 0 : ADDED_PARAGRAPH_SPACE_PT
                    )
                  )
                }
              >
                <span className="line-spacing-menu__check" aria-hidden="true">
                  {(controls?.spaceBeforePt ?? 0) > 0 ? <Check size={16} /> : null}
                </span>
                <span>{(controls?.spaceBeforePt ?? 0) > 0 ? "Remove space before paragraph" : "Add space before paragraph"}</span>
              </button>
              <button
                type="button"
                className="line-spacing-menu__option"
                aria-pressed={(controls?.spaceAfterPt ?? 0) > 0}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() =>
                  commit(() =>
                    controls?.onSpaceAfterChange(
                      (controls.spaceAfterPt ?? 0) > 0 ? 0 : ADDED_PARAGRAPH_SPACE_PT
                    )
                  )
                }
              >
                <span className="line-spacing-menu__check" aria-hidden="true">
                  {(controls?.spaceAfterPt ?? 0) > 0 ? <Check size={16} /> : null}
                </span>
                <span>{(controls?.spaceAfterPt ?? 0) > 0 ? "Remove space after paragraph" : "Add space after paragraph"}</span>
              </button>
            </div>

            <div className="line-spacing-menu__section">
              <button
                type="button"
                className="line-spacing-menu__option"
                onClick={() => {
                  close();
                  setCustomOpen(true);
                }}
              >
                <span className="line-spacing-menu__check" aria-hidden="true" />
                <span>Custom spacing</span>
              </button>
            </div>
          </div>
        )}
      </Popover>
      {customOpen && controls ? (
        <CustomSpacingModal
          controls={controls}
          onClose={() => setCustomOpen(false)}
        />
      ) : null}
    </>
  );
}
