import { memo, type CSSProperties } from "react";

import type { ResumeData, ResumeEntry, ResumeSectionData } from "../lib/resumeData";
import { renderInlineMarks } from "../lib/inlineMarks";

// Read-only mirror of the structured editor (`ResumeEditor`). It renders the same
// `ResumeData` model with the SAME `.rdx-*` classes the editor uses, but with
// static spans in place of inputs/textareas and no controls or add-affordances.
// The print layer renders this, so "PDF · clean" (window.print) produces a page
// that matches what you edit — no lossy text re-parse, no separate layout. Empty
// optional slots are omitted so the printed page stays clean.
//
// Every level is memoized: this lives in an off-screen print layer that re-renders
// on every keystroke (data is a new ResumeData each edit), but the reducer keeps
// identity for untouched sections/entries, so only the edited row actually re-renders.

const ReadonlyEntry = memo(function ReadonlyEntry({ entry }: { entry: ResumeEntry }) {
  const hasSubRow = Boolean(entry.subtitleLeft || entry.subtitleRight);
  return (
    <div className="rdx-entry">
      <div className="rdx-entry__head">
        <div className="rdx-entry__rows">
          <div className="rdx-entry__row">
            <span className="rdx-entry__title">{renderInlineMarks(entry.titleLeft)}</span>
            {entry.titleRight ? <span className="rdx-entry__meta">{renderInlineMarks(entry.titleRight)}</span> : null}
          </div>
          {hasSubRow ? (
            <div className="rdx-entry__row rdx-entry__row--sub">
              <span className="rdx-entry__subtitle">{renderInlineMarks(entry.subtitleLeft)}</span>
              {entry.subtitleRight ? (
                <span className="rdx-entry__location">{renderInlineMarks(entry.subtitleRight)}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {entry.bullets.length ? (
        <ul className="rdx-bullets">
          {entry.bullets.map((bullet) => (
            <li className="rdx-bullet" key={bullet.id}>
              <span className="rdx-bullet__dot" aria-hidden="true">
                •
              </span>
              <span className="rdx-bullet__text">{renderInlineMarks(bullet.text)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
});

const ReadonlySkillRow = memo(function ReadonlySkillRow({ entry }: { entry: ResumeEntry }) {
  return (
    <div className="rdx-skills-row">
      <div className="rdx-skills-row__content">
        <span className="rdx-skills-row__label">{renderInlineMarks(entry.titleLeft)}</span>
        <span className="rdx-skills-row__colon" aria-hidden="true">
          :
        </span>
        <span className="rdx-skills-row__skills">{renderInlineMarks(entry.subtitleLeft)}</span>
      </div>
    </div>
  );
});

const ReadonlySummaryRow = memo(function ReadonlySummaryRow({ entry }: { entry: ResumeEntry }) {
  return (
    <div className="rdx-summary-row">
      {entry.bullets.map((bullet) => (
        <p className="rdx-summary-row__text" key={bullet.id}>
          {renderInlineMarks(bullet.text)}
        </p>
      ))}
    </div>
  );
});

const ReadonlySection = memo(function ReadonlySection({ section }: { section: ResumeSectionData }) {
  const isSkills = section.type === "skills";
  const isSummary = section.type === "summary";
  return (
    <section className={`rdx-section${isSkills ? " rdx-section--skills" : ""}${isSummary ? " rdx-section--summary" : ""}`}>
      <div className="rdx-section__head">
        <div className="rdx-section__heading">{section.heading}</div>
      </div>
      {section.items.map((entry) =>
        isSkills ? (
          <ReadonlySkillRow key={entry.id} entry={entry} />
        ) : isSummary ? (
          <ReadonlySummaryRow key={entry.id} entry={entry} />
        ) : (
          <ReadonlyEntry key={entry.id} entry={entry} />
        )
      )}
    </section>
  );
});

export const ResumeReadonlyDocument = memo(function ResumeReadonlyDocument({
  data,
  style
}: {
  data: ResumeData;
  // The user's doc-style CSS variables, so the printed page matches the editor.
  style?: CSSProperties;
}) {
  return (
    <article className="resume-doc resume-doc--editable resume-doc--readonly" style={style}>
      {data.name ? <div className="rdx-name">{data.name}</div> : null}

      {data.contact.length ? (
        <div className="rdx-contact">
          {data.contact.map((piece, index) => (
            <span className="rdx-contact__chip" key={index}>
              <span className="rdx-contact__input">{piece}</span>
            </span>
          ))}
        </div>
      ) : null}

      {data.sections.map((section) => (
        <ReadonlySection key={section.id} section={section} />
      ))}
    </article>
  );
});
