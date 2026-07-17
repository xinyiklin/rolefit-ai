import type { ReactNode } from "react";
import { CaseSensitive } from "lucide-react";
import { NavMenu } from "./NavMenu";
import {
  type BodyAlign,
  type DocStyleControls,
  type HeaderAlign,
  type HeadingCase,
  type NameSize,
  JAKE_STYLE_DEFAULTS
} from "../hooks/useDocStyle";
import type { FieldMark } from "../lib/inlineMarksText";

// Section-heading letter case — a single mutually-exclusive choice (small caps,
// full caps, or plain Title Case), so it's a segmented pick, not a toggle.
const HEADING_CASES: { value: HeadingCase; label: string }[] = [
  { value: "smallcaps", label: "Small caps" },
  { value: "uppercase", label: "Uppercase" },
  { value: "none", label: "Normal" }
];

// Header block (name + contact) alignment: left / center / right.
const HEADER_ALIGNS: { value: HeaderAlign; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" }
];

// Body-paragraph alignment (bullets, skills, summaries): left / justify /
// center / right.
const BODY_ALIGNS: { value: BodyAlign; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "justify", label: "Justify" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" }
];

// Name size tiers — the three calibrated engine sizes (Small / Medium / Large).
const NAME_SIZES: { value: NameSize; label: string }[] = [
  { value: "large", label: "Small" },
  { value: "xlarge", label: "Medium" },
  { value: "huge", label: "Large" }
];

// Quick-pick contact dividers; a 2-char free input covers anything else.
const COMMON_DIVIDERS = ["|", "•", "·", "–", "/"];

function StyleChip({
  on,
  onClick,
  children,
  disabled = false
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`format-chip${on ? " is-on" : ""}`}
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

// Text-style controls for the resume page, grouped by the resume element they
// act on (Headings / Entries / Skills / Contact) so every control for a part
// sits together. Kept separate from the Format menu (spacing/layout). Applies
// live to the editor + print mirror and is consumed by the owned
// editor/preview/PDF engine.
export function StyleMenu({
  docStyle,
  titlesBold,
  subtitlesItalic,
  onEntriesMark
}: {
  docStyle: DocStyleControls;
  // Entry title/subtitle emphasis is real inline formatting (per-entry
  // overridable), not a render flag: these reflect the current state and the
  // chips bulk-apply/remove the mark across every standard entry.
  titlesBold: boolean;
  subtitlesItalic: boolean;
  onEntriesMark: (field: "title" | "subtitle", mark: FieldMark, on: boolean) => void;
}) {
  const { style, set, applyStyle } = docStyle;

  return (
    <NavMenu
      icon={<CaseSensitive size={14} aria-hidden={true} />}
      ariaLabel="Resume text style"
      label={<span className="nav-menu__label">Style</span>}
      className="style-menu"
    >
      <div className="format-slider-groups">
        <div className="format-slider-group format-style-group">
          <span className="format-slider-group__label">Headings</span>
          <div className="format-emphasis">
            <div className="format-emphasis__row">
              <span className="format-emphasis__kind">Case</span>
              <div className="format-emphasis__chips">
                {HEADING_CASES.map((opt) => (
                  <StyleChip
                    key={opt.value}
                    on={style.headingCase === opt.value}
                    onClick={() => set("headingCase", opt.value)}
                  >
                    {opt.label}
                  </StyleChip>
                ))}
              </div>
            </div>
            <div className="format-emphasis__row">
              <span className="format-emphasis__kind">Style</span>
              <div className="format-emphasis__chips">
                {/* Small caps has no bold face (lmodern), so bold has no effect
                    there — show it disabled/off rather than pretending it applies. */}
                <StyleChip
                  on={style.boldHeadings && style.headingCase !== "smallcaps"}
                  disabled={style.headingCase === "smallcaps"}
                  onClick={() => set("boldHeadings", !style.boldHeadings)}
                >
                  Bold
                </StyleChip>
              </div>
            </div>
          </div>
        </div>

        <div className="format-slider-group format-style-group">
          <span className="format-slider-group__label">Entries</span>
          <div className="format-emphasis">
            <div className="format-emphasis__row">
              <span className="format-emphasis__kind" style={{ fontWeight: 700 }}>
                Bold
              </span>
              <div className="format-emphasis__chips">
                <StyleChip on={titlesBold} onClick={() => onEntriesMark("title", "bold", !titlesBold)}>
                  Titles
                </StyleChip>
              </div>
            </div>
            <div className="format-emphasis__row">
              <span className="format-emphasis__kind" style={{ fontStyle: "italic" }}>
                Italic
              </span>
              <div className="format-emphasis__chips">
                <StyleChip on={subtitlesItalic} onClick={() => onEntriesMark("subtitle", "italic", !subtitlesItalic)}>
                  Subtitles
                </StyleChip>
              </div>
            </div>
          </div>
        </div>

        <div className="format-slider-group format-style-group">
          <span className="format-slider-group__label">Skills</span>
          <div className="format-emphasis">
            <div className="format-emphasis__row">
              <span className="format-emphasis__kind" style={{ fontWeight: 700 }}>
                Bold
              </span>
              <div className="format-emphasis__chips">
                <StyleChip on={style.boldSkillLabels} onClick={() => set("boldSkillLabels", !style.boldSkillLabels)}>
                  Labels
                </StyleChip>
              </div>
            </div>
          </div>
        </div>

        <div className="format-slider-group format-style-group">
          <span className="format-slider-group__label">Alignment</span>
          <div className="format-emphasis">
            <div className="format-emphasis__row">
              <span className="format-emphasis__kind">Header</span>
              <div className="format-emphasis__chips">
                {HEADER_ALIGNS.map((opt) => (
                  <StyleChip
                    key={opt.value}
                    on={style.headerAlign === opt.value}
                    onClick={() => set("headerAlign", opt.value)}
                  >
                    {opt.label}
                  </StyleChip>
                ))}
              </div>
            </div>
            <div className="format-emphasis__row">
              <span className="format-emphasis__kind">Body</span>
              <div className="format-emphasis__chips">
                {BODY_ALIGNS.map((opt) => (
                  <StyleChip
                    key={opt.value}
                    on={style.bodyAlign === opt.value}
                    onClick={() => set("bodyAlign", opt.value)}
                  >
                    {opt.label}
                  </StyleChip>
                ))}
              </div>
            </div>
            <div className="format-emphasis__row">
              <span className="format-emphasis__kind">Headings</span>
              <div className="format-emphasis__chips">
                {HEADER_ALIGNS.map((opt) => (
                  <StyleChip
                    key={opt.value}
                    on={style.headingAlign === opt.value}
                    onClick={() => set("headingAlign", opt.value)}
                  >
                    {opt.label}
                  </StyleChip>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="format-slider-group format-style-group">
          <span className="format-slider-group__label">Name</span>
          <div className="format-emphasis">
            <div className="format-emphasis__row">
              <span className="format-emphasis__kind">Size</span>
              <div className="format-emphasis__chips">
                {NAME_SIZES.map((opt) => (
                  <StyleChip
                    key={opt.value}
                    on={style.nameSize === opt.value}
                    onClick={() => set("nameSize", opt.value)}
                  >
                    {opt.label}
                  </StyleChip>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="format-slider-group format-style-group">
          <span className="format-slider-group__label">Contact</span>
          <div className="format-emphasis">
            <div className="format-emphasis__row">
              <span className="format-emphasis__kind">Divider</span>
              <div className="format-emphasis__chips">
                {COMMON_DIVIDERS.map((divider) => (
                  <StyleChip
                    key={divider}
                    on={style.contactDivider === divider}
                    onClick={() => set("contactDivider", divider)}
                  >
                    {divider}
                  </StyleChip>
                ))}
                <input
                  type="text"
                  className="format-divider-input"
                  value={style.contactDivider}
                  maxLength={2}
                  aria-label="Custom contact divider"
                  placeholder="…"
                  onChange={(event) => set("contactDivider", event.target.value.slice(0, 2))}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="style-menu__foot">
        <button
          type="button"
          className="secondary-button is-compact"
          onClick={() => applyStyle(JAKE_STYLE_DEFAULTS)}
          title="Set every text style to Jake's template defaults"
        >
          Jake’s defaults
        </button>
      </div>
    </NavMenu>
  );
}
