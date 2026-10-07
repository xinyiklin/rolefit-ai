import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { Plus } from "lucide-react";
import type { ResumeData, ResumeEntry } from "@typeset/engine/lib/resumeData.ts";

import {
  appendProfileBlock,
  composeProfileHeading,
  defaultEntryHeading,
  entryLinkName,
  entryTitle,
  keepsOtherLinks,
  normalizeNoteBody,
  parseProfileNotes,
  profileNotesScope,
  relinkProfileBlock,
  removeProfileBlock,
  replaceProfileBlock,
  replaceProfilePreamble,
  splitProfileHeading,
  wordCount,
  writeProfileLines,
  type ProfileNoteBlock
} from "../../lib/profileNotes.ts";
import { stripInlineMarks } from "../../lib/inlineMarks";

export type ProfileNoteFocus = { line: number; nonce: number };

type ProfileNotesProps = {
  // The open resume whose entries organise the notes; null falls back to text.
  resume: ResumeData | null;
  background: string;
  // Stores the edit unless the caller refuses it (the storage limit); reports which.
  onBackgroundChange: (next: string) => boolean;
  focusRequest?: ProfileNoteFocus | null;
  textareaRef?: Ref<HTMLTextAreaElement>;
  textareaProps: {
    "aria-labelledby": string;
    "aria-describedby": string;
    "aria-invalid": true | undefined;
  };
};

type NotesView = "entries" | "text";

const BACKGROUND_PLACEHOLDER = "## Inventory tracker (personal project, 2024–present)\nBuilt a Django REST API with role-based access.\n\n## Acme Clinic — Support Specialist (professional, 2021–2023)\nLed the EHR migration for 12 staff.";

// Reasons worth a flag. "Names no entry" is what an unlinked note is, so it
// stays unlabelled; the others mean a heading the user probably meant to link.
const REGROUPS_OTHERS = "This would change how other notes link. Restructure it in Text view.";

const REASON_CHIPS: Partial<Record<NonNullable<ProfileNoteBlock["linkage"]["reason"]>, string>> = {
  "names more than one entry": "Names two entries",
  "parent heading is not a grouping heading": "Under an unlinked heading",
  "inside another entry's heading": "Inside another entry"
};

type LinkTarget = { entry: ResumeEntry; section: string; name: string | null };

function plain(value: string | null | undefined): string {
  return stripInlineMarks(value ?? "").trim();
}

function blockKey(block: ProfileNoteBlock): string {
  return block.linkage.status === "linked" && block.linkage.entryId ? `entry:${block.linkage.entryId}` : `general:${block.start}`;
}

function rowsFor(text: string): number {
  return Math.min(16, Math.max(6, text.split("\n").length + 1));
}

// What one editor can ask of the notes. A body or detail write takes the end
// of the editor's own lines and returns their new end, or null when refused;
// an editor updates its draft only when stored.
type BlockActions = {
  body: (value: string, end: number) => number | null;
  detail: (name: string, value: string, body: string, end: number) => number | null;
  // On leaving the notes: resync if typing started a new note.
  settle: (draft: string) => void;
  // Returns a message when the note cannot move there.
  relink: (entryId: string) => string | null;
  // Returns a message when the heading would link or merge into another note.
  checkHeading: (heading: string) => string | null;
  rename: (heading: string) => boolean;
  // Returns a message when removing would change how other notes link.
  remove: () => string | null;
};

type BlockEditorProps = {
  block: ProfileNoteBlock;
  targets: LinkTarget[];
  actions: BlockActions;
  autoFocus: boolean;
  onFocused: () => void;
};

// Edits one block. The name links it, so on a linked note it changes only
// through Linked to. Body and detail keep local drafts so the stored text's
// trimming never eats a trailing space or newline mid-typing, and the focused
// editor owns its span of lines (a length from its start) until focus leaves
// it; the parent remounts every editor whenever the notes' structure changes.
function BlockEditor({ block, targets, actions, autoFocus, onFocused }: BlockEditorProps) {
  const linkedId = block.linkage.status === "linked" ? block.linkage.entryId : undefined;
  const { name, detail: storedDetail } = splitProfileHeading(block.heading);
  const [detail, setDetail] = useState(storedDetail);
  const [heading, setHeading] = useState(block.heading);
  const [body, setBody] = useState(block.body);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [linkError, setLinkError] = useState("");
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const ownLength = useRef(block.end - block.start);
  // A shift in the lines above can hand this instance another note (same key);
  // unless it is being typed in, it adopts that note's stored text.
  const identity = `${block.start}\n${block.heading}`;
  const [shownIdentity, setShownIdentity] = useState(identity);
  if (shownIdentity !== identity && !rootRef.current?.contains(document.activeElement)) {
    setShownIdentity(identity);
    setDetail(storedDetail);
    setHeading(block.heading);
    setBody(block.body);
    setConfirmRemove(false);
    setLinkError("");
    ownLength.current = block.end - block.start;
  }

  useEffect(() => {
    if (!autoFocus) return;
    // One frame so this beats the dialog's initial focus on its close button.
    const frame = window.requestAnimationFrame(() => {
      notesRef.current?.focus();
      onFocused();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [autoFocus]);

  const headingProblem = !linkedId && heading.trim() !== block.heading ? actions.checkHeading(heading) : null;
  const reason = block.linkage.reason ? REASON_CHIPS[block.linkage.reason] : undefined;
  const linkedTitle = targets.find((target) => target.entry.id === linkedId);

  return (
    <div
      className="profile-notes__editor"
      ref={rootRef}
      onBlur={(event) => {
        // Settle only when focus leaves the whole note, so a click on its own
        // controls is not lost to a remount.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) actions.settle(body);
      }}
    >
      <label className="profile-notes__field">
        <span>Linked to</span>
        <select className="select--compact" value={linkedId ?? ""} onChange={(event) => setLinkError(actions.relink(event.target.value) ?? "")}>
          <option value="">Not linked</option>
          {[...new Set(targets.map((target) => target.section))].map((section) => (
            <optgroup key={section} label={section}>
              {targets.filter((target) => target.section === section).map((target) => (
                <option key={target.entry.id} value={target.entry.id} disabled={!target.name && target.entry.id !== linkedId}>
                  {entryTitle(target.entry)}{target.name ? "" : " (name shared)"}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <p className="profile-notes__link-state" role={linkError ? "alert" : undefined}>
        {linkError || (linkedId
          ? `Resume Polish uses these notes for ${linkedTitle ? entryTitle(linkedTitle.entry) : block.linkage.entry}.`
          : reason
            ? `${reason}, so this heading doesn't link. AI steps read it as general background.`
            : "AI steps read it as general background.")}
      </p>

      {linkedId ? (
        <label className="profile-notes__field">
          <span>Type and dates</span>
          <input
            className="text-input"
            type="text"
            value={detail}
            placeholder="personal project, 2025–present"
            onChange={(event) => {
              const end = actions.detail(name, event.target.value, body, block.start + ownLength.current);
              if (end === null) return;
              ownLength.current = end - block.start;
              setDetail(event.target.value);
              setLinkError("");
            }}
          />
        </label>
      ) : (
        <label className="profile-notes__field">
          <span>Heading</span>
          <input
            className="text-input"
            type="text"
            value={heading}
            aria-invalid={headingProblem ? true : undefined}
            onChange={(event) => setHeading(event.target.value)}
            onBlur={() => {
              // The heading stores on blur so a half-typed name cannot move the note.
              const stored = heading.trim() && heading.trim() !== block.heading && !headingProblem && actions.rename(heading);
              if (!stored) setHeading(block.heading);
            }}
          />
          {headingProblem ? <small className="profile-notes__warn">{headingProblem}</small> : null}
        </label>
      )}

      <label className="profile-notes__field">
        <span>Notes</span>
        <textarea
          ref={notesRef}
          className="textarea"
          rows={rowsFor(body)}
          value={body}
          placeholder="What you did, where, and what came of it."
          onChange={(event) => {
            const end = actions.body(event.target.value, block.start + ownLength.current);
            if (end === null) return;
            ownLength.current = end - block.start;
            setBody(event.target.value);
            setLinkError("");
          }}
        />
      </label>

      <div className="profile-notes__editor-actions">
        {confirmRemove ? (
          <>
            <span className="profile-notes__confirm">Remove this note?</span>
            <button
              className="ghost-button is-compact"
              type="button"
              onClick={() => {
                const problem = actions.remove();
                if (!problem) return;
                setLinkError(problem);
                setConfirmRemove(false);
              }}
            >
              Remove
            </button>
            <button className="ghost-button is-compact" type="button" onClick={() => setConfirmRemove(false)}>Keep</button>
          </>
        ) : (
          <button className="ghost-button is-compact" type="button" onClick={() => { setConfirmRemove(true); setLinkError(""); }}>Remove note</button>
        )}
      </div>
    </div>
  );
}

function PreambleEditor({ initial, onBody }: { initial: string; onBody: (value: string) => boolean }) {
  const [body, setBody] = useState(initial);
  return (
    <div className="profile-notes__editor">
      <p className="profile-notes__link-state">Text above the first heading. AI steps read it as general background.</p>
      <label className="profile-notes__field">
        <span>Notes</span>
        <textarea
          className="textarea"
          rows={rowsFor(body)}
          value={body}
          onChange={(event) => {
            if (onBody(event.target.value)) setBody(event.target.value);
          }}
        />
      </label>
    </div>
  );
}

type ListRowProps = { label: string; meta: string; flag?: string; active: boolean; empty?: boolean; onSelect: () => void };

function ListRow({ label, meta, flag, active, empty, onSelect }: ListRowProps) {
  return (
    <button type="button" className="profile-notes__item" aria-current={active || undefined} data-empty={empty || undefined} onClick={onSelect}>
      <span className="profile-notes__item-name" title={label}>{label}</span>
      {flag ? <span className="proposal-chip">{flag}</span> : null}
      <span className="profile-notes__item-meta">{meta}</span>
    </button>
  );
}

function words(...bodies: string[]): string {
  const total = bodies.reduce((sum, body) => sum + wordCount(body), 0);
  return `${total} word${total === 1 ? "" : "s"}`;
}

export function ProfileNotes({ resume, background, onBackgroundChange, focusRequest, textareaRef, textareaProps }: ProfileNotesProps) {
  const [view, setView] = useState<NotesView>("entries");
  const [selected, setSelected] = useState<string | null>(null);
  const [focusLine, setFocusLine] = useState<number | null>(null);
  // Bumped whenever the notes' structure changes, or the text changes from
  // outside this view (Text view, another tab): every editor remounts from the
  // stored text, so no draft outlives the block it was typed into.
  const [revision, setRevision] = useState(0);
  const written = useRef(background);
  const listRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const scope = resume ? profileNotesScope(resume) : null;

  useEffect(() => {
    if (background === written.current) return;
    written.current = background;
    setRevision((current) => current + 1);
  }, [background]);

  useEffect(() => {
    if (!focusRequest || !scope) return;
    const block = parseProfileNotes(scope, background).blocks.find((candidate) => candidate.start === focusRequest.line);
    setView("entries");
    setSelected(block ? blockKey(block) : null);
    setFocusLine(focusRequest.line);
    // Only a new request moves the selection; later edits must not.
  }, [focusRequest?.nonce]);

  const textarea = (
    <textarea
      ref={textareaRef}
      className="textarea settings-background"
      {...textareaProps}
      value={background}
      onChange={(event) => onBackgroundChange(event.target.value)}
      placeholder={BACKGROUND_PLACEHOLDER}
      rows={18}
    />
  );
  if (!resume || !scope) {
    return (
      <>
        {textarea}
        <p className="settings-panel__supporting-copy profile-notes__fallback">Open your resume to organise these notes by entry.</p>
      </>
    );
  }

  const notes = parseProfileNotes(scope, background);
  const sections = resume.sections.filter((section) => section.type === "standard" && section.items.length);
  const targets: LinkTarget[] = sections.flatMap((section) => section.items.map((entry) => ({
    entry,
    section: plain(section.heading),
    name: entryLinkName(scope, entry)
  })));
  const covered = targets.filter((target) => notes.byEntry.has(target.entry.id)).length;
  const keys = [
    ...targets.map((target) => `entry:${target.entry.id}`),
    ...(notes.preamble ? ["preamble"] : []),
    ...notes.general.map(blockKey)
  ];
  const active = selected && keys.includes(selected) ? selected : keys[0] ?? null;

  const blockAt = (text: string, start: number) => parseProfileNotes(scope, text).blocks.find((candidate) => candidate.start === start);
  const write = (next: string, structural: boolean): boolean => {
    if (!onBackgroundChange(next)) return false;
    written.current = next;
    if (structural) setRevision((current) => current + 1);
    return true;
  };
  const select = (key: string) => {
    setSelected(key);
    setFocusLine(null);
    // Stacked on narrow panels: bring the editor into view under the list.
    window.requestAnimationFrame(() => {
      const list = listRef.current;
      const editor = editorRef.current;
      if (list && editor && editor.offsetTop >= list.offsetTop + list.offsetHeight) editor.scrollIntoView({ block: "nearest" });
    });
  };
  const addBlock = (heading: string) => {
    const appended = appendProfileBlock(background, heading, scope);
    const block = blockAt(appended.background, appended.start);
    if (!write(appended.background, true)) return;
    if (block) setSelected(blockKey(block));
    setFocusLine(appended.start);
  };
  const preambleBody = (value: string): boolean => {
    if (!notes.preamble) return false;
    const next = replaceProfilePreamble(background, notes.preamble.end, value);
    const split = (parseProfileNotes(scope, next).preamble?.body ?? "") !== normalizeNoteBody(value);
    return write(next, split);
  };

  const actionsFor = (block: ProfileNoteBlock): BlockActions => ({
    body: (value, end) => {
      // The heading line stays byte for byte.
      const next = writeProfileLines(background, block.start, end, background.split("\n")[block.start], value);
      return write(next.background, false) ? next.end : null;
    },
    detail: (name, value, body, end) => {
      const headingLine = `${"#".repeat(block.level)} ${composeProfileHeading(name, value) || block.heading}`;
      const next = writeProfileLines(background, block.start, end, headingLine, body);
      return write(next.background, false) ? next.end : null;
    },
    settle: (draft) => {
      const after = blockAt(background, block.start);
      if (after && after.body === normalizeNoteBody(draft)) return;
      setRevision((current) => current + 1);
      if (after) setSelected(blockKey(after));
    },
    relink: (entryId) => {
      const target = targets.find((candidate) => candidate.entry.id === entryId);
      const { name, detail } = splitProfileHeading(block.heading);
      const next = target?.name
        ? relinkProfileBlock(background, block, target.name)
        : replaceProfileBlock(background, block, composeProfileHeading(`${name} notes`, detail), block.body);
      const after = blockAt(next, block.start);
      // Judged in place: a nested note can stay tied to the heading around it.
      const moved = target ? after?.linkage.entryId === entryId : after && after.linkage.status !== "linked";
      if (!after || !moved) return "This note sits under another heading, so it can't move here. Restructure it in Text view.";
      if (!keepsOtherLinks(scope, background, next, block.start, block.end)) return REGROUPS_OTHERS;
      if (write(next, true)) setSelected(blockKey(after));
      return null;
    },
    checkHeading: (heading) => {
      if (!heading.trim()) return null;
      const next = replaceProfileBlock(background, block, heading, block.body);
      const after = blockAt(next, block.start);
      if (!after) return "That heading would merge these notes into the note above.";
      if (after.linkage.status === "linked") return `This name links to ${after.linkage.entry}. Choose it in Linked to instead.`;
      return keepsOtherLinks(scope, background, next, block.start, block.end) ? null : REGROUPS_OTHERS;
    },
    rename: (heading) => write(replaceProfileBlock(background, block, heading, block.body), false),
    remove: () => {
      const next = removeProfileBlock(background, block);
      if (!keepsOtherLinks(scope, background, next, block.start, block.end)) return REGROUPS_OTHERS;
      write(next, true);
      return null;
    }
  });
  const editorFor = (block: ProfileNoteBlock) => (
    <BlockEditor
      key={`${revision}:${block.start}:${block.linkage.entryId ?? ""}`}
      block={block}
      targets={targets}
      actions={actionsFor(block)}
      autoFocus={focusLine === block.start}
      onFocused={() => setFocusLine(null)}
    />
  );

  const activeTarget = targets.find((target) => `entry:${target.entry.id}` === active);
  const activeGeneral = notes.general.find((block) => blockKey(block) === active);

  return (
    <div className="profile-notes">
      <div className="profile-notes__bar">
        <div className="profile-notes__views" role="group" aria-label="Background view">
          {(["entries", "text"] as const).map((option) => (
            <button key={option} type="button" className="profile-notes__view" aria-pressed={view === option} onClick={() => setView(option)}>
              {option === "entries" ? "By entry" : "Text"}
            </button>
          ))}
        </div>
        <span className="profile-notes__coverage">{covered} of {targets.length} entries have notes</span>
      </div>

      {view === "text" ? textarea : (
        <div className="profile-notes__layout">
          <div className="profile-notes__list" ref={listRef}>
            {sections.map((section) => (
              <section className="profile-notes__group" key={section.id} aria-label={plain(section.heading)}>
                <div className="menu-subhead"><span className="menu-subhead__title">{plain(section.heading)}</span></div>
                {section.items.map((entry) => {
                  const blocks = notes.byEntry.get(entry.id) ?? [];
                  const key = `entry:${entry.id}`;
                  return (
                    <ListRow
                      key={entry.id}
                      label={entryTitle(entry)}
                      meta={blocks.length ? words(...blocks.map((block) => block.body)) : "Add"}
                      empty={!blocks.length}
                      active={active === key}
                      onSelect={() => select(key)}
                    />
                  );
                })}
              </section>
            ))}
            <section className="profile-notes__group" aria-label="Other notes">
              <div className="menu-subhead"><span className="menu-subhead__title">Other notes</span></div>
              {notes.preamble ? (
                <ListRow label="Before the first heading" meta={words(notes.preamble.body)} active={active === "preamble"} onSelect={() => select("preamble")} />
              ) : null}
              {notes.general.map((block) => (
                <ListRow
                  key={blockKey(block)}
                  label={block.heading}
                  meta={words(block.body)}
                  flag={block.linkage.reason ? REASON_CHIPS[block.linkage.reason] : undefined}
                  active={active === blockKey(block)}
                  onSelect={() => select(blockKey(block))}
                />
              ))}
              <button className="ghost-button is-compact profile-notes__add-general" type="button" onClick={() => addBlock("New note")}>
                <Plus size={13} aria-hidden="true" /> Add note
              </button>
            </section>
          </div>

          <div className="profile-notes__detail" ref={editorRef}>
            {activeTarget ? (
              <EntryDetail
                target={activeTarget}
                blocks={notes.byEntry.get(activeTarget.entry.id) ?? []}
                editorFor={editorFor}
                onAdd={(name) => addBlock(defaultEntryHeading(activeTarget.entry, name))}
              />
            ) : null}
            {activeGeneral ? editorFor(activeGeneral) : null}
            {active === "preamble" && notes.preamble ? (
              <PreambleEditor key={revision} initial={notes.preamble.body} onBody={preambleBody} />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

type EntryDetailProps = {
  target: LinkTarget;
  blocks: ProfileNoteBlock[];
  editorFor: (block: ProfileNoteBlock) => ReactNode;
  onAdd: (name: string) => void;
};

// One entry: what the resume shows, then each note linked to it.
function EntryDetail({ target, blocks, editorFor, onAdd }: EntryDetailProps) {
  const { entry, section, name } = target;
  const subtitle = plain(entry.subtitleLeft);
  const title = entryTitle(entry);
  const dates = plain(entry.titleRight) || plain(entry.subtitleRight);
  return (
    <>
      <header className="profile-notes__detail-head">
        <h3>{title}</h3>
        <p>{[subtitle !== title ? subtitle : "", dates, section].filter(Boolean).join(" · ")}</p>
      </header>

      {blocks.map(editorFor)}

      {blocks.length ? null : name ? (
        <div className="profile-notes__empty">
          <p>No notes for {title} yet.</p>
          <button className="ghost-button is-compact" type="button" onClick={() => onAdd(name)}>
            <Plus size={13} aria-hidden="true" /> Add notes
          </button>
        </div>
      ) : (
        <p className="profile-notes__empty">Another entry or section shares this name, so notes can't link to it. Rename one on the resume.</p>
      )}

      <details className="profile-notes__resume">
        <summary>On your resume now · {entry.bullets.length} bullet{entry.bullets.length === 1 ? "" : "s"}</summary>
        {entry.bullets.length ? (
          <ul>{entry.bullets.map((bullet) => <li key={bullet.id}>{stripInlineMarks(bullet.text)}</li>)}</ul>
        ) : <p>No bullets.</p>}
      </details>
    </>
  );
}
