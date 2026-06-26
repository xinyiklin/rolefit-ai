import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Plus, X } from "lucide-react";

import type { ResumeData, ResumeSectionType } from "../../lib/resumeData";
import type { TailorMode } from "../../lib/tailorScope";
import type { ResumeEditorActions } from "../../hooks/useResumeEditor";
import type { TailorChangeTarget } from "../../resume/types";
import { EditableInput } from "./fields";
import { pageBreakId, type ResumePageBreaks } from "./pagination";
import { SectionEditor } from "./SectionEditor";
import { SortableList } from "./sortable";

type ResumeEditorProps = {
  data: ResumeData;
  actions: ResumeEditorActions;
  // Doc-style CSS variables from the Format menu (line spacing, weights, etc.).
  style?: CSSProperties;
  tailorModes?: Record<string, TailorMode>;
  onSetTailorMode?: (sectionId: string, mode: TailorMode) => void;
  highlightTarget?: TailorChangeTarget | null;
};

type AddPosition = "top" | "bottom";

// The section-type picker offers these up front so the user chooses the shape
// (bulleted entries vs skill list vs summary) rather than relying on heading text.
const SECTION_TYPE_OPTIONS: { type: ResumeSectionType; title: string; sub: string }[] = [
  { type: "summary", title: "Summary", sub: "Short paragraph — professional summary or objective" },
  {
    type: "standard",
    title: "Bulleted entries",
    sub: "Title, dates & bullet points — experience, projects, education"
  },
  { type: "skills", title: "Skill list", sub: "Label + inline list — e.g. Languages: Python, SQL" }
];

// The editable on-page resume. Shares the `.resume-doc` look so it reads like the
// document it produces; every field is a live control wired to the editor reducer.
export function ResumeEditor({ data, actions, style, tailorModes = {}, onSetTailorMode, highlightTarget = null }: ResumeEditorProps) {
  // Which add-section picker is open (top or bottom corner), if any. Both corners
  // share one open-at-a-time state so opening one closes the other.
  const [openPicker, setOpenPicker] = useState<AddPosition | null>(null);
  const [pageBreaks, setPageBreaks] = useState<Record<string, number>>({});
  const [pageCount, setPageCount] = useState(1);
  const docRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const topAddRef = useRef<HTMLDivElement>(null);
  const bottomAddRef = useRef<HTMLDivElement>(null);
  const topTriggerRef = useRef<HTMLButtonElement>(null);
  const bottomTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!openPicker) return;
    const containerRef = openPicker === "top" ? topAddRef : bottomAddRef;
    const triggerRef = openPicker === "top" ? topTriggerRef : bottomTriggerRef;
    // pointerdown (not mousedown) so touch taps outside also close the picker.
    function onPointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpenPicker(null);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenPicker(null);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openPicker]);

  function addSectionOfType(type: ResumeSectionType, position: AddPosition) {
    actions.addSection(type, position);
    setOpenPicker(null);
  }

  function renderAddSection(position: AddPosition) {
    const open = openPicker === position;
    const containerRef = position === "top" ? topAddRef : bottomAddRef;
    const triggerRef = position === "top" ? topTriggerRef : bottomTriggerRef;
    const label = position === "top" ? "Add section at top" : "Add section";
    return (
      <div className={`rdx-add-section rdx-add-section--${position}${open ? " is-open" : ""}`} ref={containerRef}>
        <button
          ref={triggerRef}
          type="button"
          className="rdx-add rdx-add--section"
          onClick={() => setOpenPicker((current) => (current === position ? null : position))}
          aria-haspopup="true"
          aria-expanded={open}
          title={label}
          aria-label={label}
        >
          <Plus size={14} aria-hidden="true" />
          <span>{label}</span>
        </button>
        {open ? (
          <div className="rdx-add-section__menu" aria-label="Choose a section type">
            {SECTION_TYPE_OPTIONS.map((option) => (
              <button
                key={option.type}
                type="button"
                className="rdx-add-section__option"
                onClick={() => addSectionOfType(option.type, position)}
              >
                <span className="rdx-add-section__option-title">{option.title}</span>
                <span className="rdx-add-section__option-sub">{option.sub}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  function resolveCssLengthPx(value: string, fontSizePx: number, fallbackPx: number) {
    const trimmed = value.trim();
    const amount = parseFloat(trimmed);
    if (!Number.isFinite(amount)) return fallbackPx;
    if (trimmed.endsWith("rem")) {
      const rootFontSize = parseFloat(window.getComputedStyle(document.documentElement).fontSize);
      return amount * (Number.isFinite(rootFontSize) ? rootFontSize : fontSizePx);
    }
    if (trimmed.endsWith("em")) return amount * fontSizePx;
    return amount;
  }

  useLayoutEffect(() => {
    const doc = docRef.current;
    const content = contentRef.current;
    if (!doc || !content) return;

    const raf = window.requestAnimationFrame(() => {
      const breakTargets = [...content.querySelectorAll<HTMLElement>("[data-page-break-id]")];
      if (!breakTargets.length) {
        setPageBreaks((current) => (Object.keys(current).length ? {} : current));
        setPageCount(1);
        return;
      }

      const docRect = doc.getBoundingClientRect();
      const computed = window.getComputedStyle(content);
      const docComputed = window.getComputedStyle(doc);
      const pageHeight = docRect.width * 11 / 8.5;
      const fontSize = parseFloat(computed.fontSize) || 16;
      const pageGap = resolveCssLengthPx(docComputed.getPropertyValue("--doc-page-gap"), fontSize, fontSize * 2);
      const paddingTop = parseFloat(computed.paddingTop) || 0;
      const paddingBottom = parseFloat(computed.paddingBottom) || 0;
      const pageStride = pageHeight + pageGap;

      let existingBefore = 0;
      let newBefore = 0;
      let pageIndex = 0;
      let contentBottom = paddingTop;
      const nextBreaks: ResumePageBreaks = {};

      // The element whose bottom must stay glued to the target's top when the
      // target sits near a page bottom. Standard entries keep the head + first
      // bullet together, then split between later bullets. A section keeps its
      // heading with that same first keep unit, so headings are never stranded.
      // Skill rows and summary paragraphs stay atomic leaves.
      function keepUnitElement(target: HTMLElement): HTMLElement {
        const kind = (target.dataset.pageBreakId ?? "").split(":")[0];
        if (kind === "section") {
          const firstRow = target.querySelector<HTMLElement>("[data-page-break-id]");
          return firstRow ? keepUnitElement(firstRow) : target;
        }
        if (kind === "entry") {
          // Skill/summary rows have no entry head and no inner break targets.
          if (!target.querySelector(":scope > .rdx-entry__head")) return target;
          return target.querySelector<HTMLElement>("[data-page-break-id]") ?? target;
        }
        return target;
      }

      for (const target of breakTargets) {
        const breakId = target.dataset.pageBreakId ?? "";
        if (!breakId) continue;
        existingBefore += pageBreaks[breakId] ?? 0;

        const rect = target.getBoundingClientRect();
        const descendantBreakHeight = [...target.querySelectorAll<HTMLElement>("[data-page-break-id]")]
          .reduce((sum, child) => {
            const childBreakId = child.dataset.pageBreakId ?? "";
            return sum + (pageBreaks[childBreakId] ?? 0);
          }, 0);
        const naturalTop = rect.top - docRect.top - existingBefore;
        const naturalBottom = rect.bottom - docRect.top - existingBefore - descendantBreakHeight;
        const topWithBreaks = naturalTop + newBefore;
        const bottomWithBreaks = naturalBottom + newBefore;

        // Containers break on their keep unit's bottom, not their own.
        const keepEl = keepUnitElement(target);
        let keepBottomWithBreaks = bottomWithBreaks;
        if (keepEl !== target) {
          const keepRect = keepEl.getBoundingClientRect();
          // Existing spacers rendered between the target's top and the keep
          // unit's bottom (a prior pass may have broken before — or inside —
          // the first row) inflate the measured keep bottom; back them out.
          let breaksWithinKeep = 0;
          for (const child of target.querySelectorAll<HTMLElement>("[data-page-break-id]")) {
            if (child.getBoundingClientRect().top <= keepRect.bottom - 1) {
              breaksWithinKeep += pageBreaks[child.dataset.pageBreakId ?? ""] ?? 0;
            }
          }
          keepBottomWithBreaks = keepRect.bottom - docRect.top - existingBefore - breaksWithinKeep + newBefore;
        }

        while (topWithBreaks >= (pageIndex + 1) * pageStride + paddingTop - 1) {
          pageIndex += 1;
        }

        const pageStart = pageIndex * pageStride;
        const pageContentTop = pageStart + paddingTop;
        const pageContentBottom = pageStart + pageHeight - paddingBottom;
        const startsCurrentPage = topWithBreaks <= pageContentTop + 1;
        let insertedBreak = 0;

        if (!startsCurrentPage && keepBottomWithBreaks > pageContentBottom) {
          const nextPageTop = pageStart + pageHeight + pageGap + paddingTop;
          const breakHeight = Math.max(0, nextPageTop - topWithBreaks);
          nextBreaks[breakId] = breakHeight;
          newBefore += breakHeight;
          insertedBreak = breakHeight;
          pageIndex += 1;
        }

        contentBottom = Math.max(contentBottom, bottomWithBreaks + insertedBreak);
      }

      const requiredBottom = Math.max(pageHeight, contentBottom + paddingBottom);
      let nextPageCount = 1;
      while (requiredBottom > nextPageCount * pageHeight + (nextPageCount - 1) * pageGap + 1) {
        nextPageCount += 1;
      }

      setPageBreaks((current) => (JSON.stringify(current) === JSON.stringify(nextBreaks) ? current : nextBreaks));
      setPageCount((current) => (current === nextPageCount ? current : nextPageCount));
    });

    return () => window.cancelAnimationFrame(raf);
  }, [data, pageBreaks, style]);

  const editorStyle = { ...style, "--doc-page-count": pageCount } as CSSProperties;
  const pages = Array.from({ length: pageCount }, (_, index) => index);

  return (
    <article className="resume-doc resume-doc--editable resume-doc--paged" style={editorStyle} ref={docRef}>
      <div className="rdx-page-stack" aria-hidden="true">
        {pages.map((page) => (
          <div className="rdx-page-sheet" key={page} />
        ))}
      </div>

      <div className="rdx-page-content" ref={contentRef}>
        <EditableInput
          className="rdx-name"
          value={data.name}
          placeholder="Your Name"
          aria-label="Candidate name"
          onChange={actions.setName}
        />

        <div className="rdx-contact">
          {data.contact.map((piece, index) => (
            <span className="rdx-contact__chip" key={index}>
              <EditableInput
                className="rdx-contact__input"
                value={piece}
                autoSize
                placeholder="email · phone · link"
                aria-label={`Contact ${index + 1}`}
                onChange={(value) => actions.updateContact(index, value)}
              />
              <button
                type="button"
                className="rdx-contact__remove"
                onClick={() => actions.removeContact(index)}
                title="Remove contact"
                aria-label="Remove contact"
              >
                <X size={11} aria-hidden="true" />
              </button>
            </span>
          ))}
          <button
            type="button"
            className="rdx-add rdx-add--inline"
            onClick={actions.addContact}
            title="Add contact"
            aria-label="Add contact"
          >
            <Plus size={12} aria-hidden="true" />
            <span>Contact</span>
          </button>
        </div>

        {renderAddSection("top")}

        <SortableList ids={data.sections.map((section) => section.id)} onReorder={actions.reorderSections}>
          {data.sections.map((section, i) => {
            const isTarget = highlightTarget?.sectionId === section.id;
            const breakId = pageBreakId("section", section.id);
            return (
              <Fragment key={section.id}>
                {pageBreaks[breakId] ? (
                  <div
                    className="rdx-page-break"
                    style={{ height: pageBreaks[breakId] }}
                    aria-hidden="true"
                  />
                ) : null}
                <SectionEditor
                  section={section}
                  index={i}
                  siblingCount={data.sections.length}
                  actions={actions}
                  pageBreaks={pageBreaks}
                  tailorMode={tailorModes[section.id] ?? "off"}
                  onSetTailorMode={onSetTailorMode}
                  highlightedEntryId={isTarget ? (highlightTarget?.entryId ?? null) : null}
                  highlightedBulletId={isTarget ? (highlightTarget?.bulletId ?? null) : null}
                />
              </Fragment>
            );
          })}
        </SortableList>

        {renderAddSection("bottom")}
      </div>
    </article>
  );
}
