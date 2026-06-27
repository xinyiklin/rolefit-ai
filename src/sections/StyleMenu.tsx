import type { ReactNode } from "react";
import { CaseSensitive } from "lucide-react";
import { NavMenu } from "./NavMenu";
import { type DocStyleControls, type HeadingCase, JAKE_STYLE_DEFAULTS } from "../hooks/useDocStyle";

// Section-heading letter case — a single mutually-exclusive choice (small caps,
// full caps, or plain Title Case), so it's a segmented pick, not a toggle.
const HEADING_CASES: { value: HeadingCase; label: string }[] = [
  { value: "smallcaps", label: "Small caps" },
  { value: "uppercase", label: "Uppercase" },
  { value: "none", label: "Normal" }
];

// Quick-pick contact dividers; a 2-char free input covers anything else.
const COMMON_DIVIDERS = ["|", "•", "·", "–", "/"];

function StyleChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className={`format-chip${on ? " is-on" : ""}`}
      aria-pressed={on}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

// Text-style controls for the resume page, grouped by the resume element they
// act on (Headings / Entries / Skills / Contact) so every control for a part
// sits together. Kept separate from the Format menu (spacing/layout). Applies
// live to the editor + print mirror and is forwarded to the LaTeX renderer for
// the .tex / PDF exports.
export function StyleMenu({ docStyle }: { docStyle: DocStyleControls }) {
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
                <StyleChip on={style.boldHeadings} onClick={() => set("boldHeadings", !style.boldHeadings)}>
                  Bold
                </StyleChip>
                <StyleChip on={style.sectionRule} onClick={() => set("sectionRule", !style.sectionRule)}>
                  Underline
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
                <StyleChip on={style.boldTitles} onClick={() => set("boldTitles", !style.boldTitles)}>
                  Titles
                </StyleChip>
              </div>
            </div>
            <div className="format-emphasis__row">
              <span className="format-emphasis__kind" style={{ fontStyle: "italic" }}>
                Italic
              </span>
              <div className="format-emphasis__chips">
                <StyleChip on={style.italicSubtitles} onClick={() => set("italicSubtitles", !style.italicSubtitles)}>
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
