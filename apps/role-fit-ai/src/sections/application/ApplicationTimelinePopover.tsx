import { useEffect, useRef, useState, type RefObject } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { ApplicationStatus } from "../../hooks/useApplications";
import { STATUS_LABEL, formatCompactDate } from "../../lib/applicationDisplay";
import {
  deriveTimeline,
  interviewLabel,
  newStageEntryId,
  stageHistoryFits,
  type TimelineRow
} from "../../lib/applicationStageHistory";
import { toDateInput, toIso, todayIso } from "../../lib/dateInput";
import {
  INTERVIEW_KINDS,
  INTERVIEW_KIND_LABEL,
  STAGE_HISTORY_NOTE_MAX_LENGTH,
  type InterviewKind,
  type StageHistoryEntry
} from "../../../shared/applicationStageHistoryContract";
import { AnchoredPopover } from "./AnchoredPopover";

type ApplicationTimelinePopoverProps = {
  open: boolean;
  triggerRef: RefObject<HTMLElement | null>;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: (restoreFocus?: boolean) => void;
  // The saved record's stage and history; entries save on their own.
  savedStatus: ApplicationStatus;
  appliedAt?: string;
  notApplyingAt?: string;
  stageHistory: StageHistoryEntry[];
  // History starts at submission; Drafts and job-only Skipped decisions have none.
  submitted: boolean;
  // The stage the form's Save changes records, when the form moved the stage.
  pendingStage: ApplicationStatus | null;
  onSaveEntry: (entry: StageHistoryEntry) => Promise<boolean>;
  onRemoveEntry: (id: string) => Promise<boolean>;
  // Reports an unsaved entry so the host can guard its own close and navigation.
  onUnsavedChange: (unsaved: boolean) => void;
  // Asks before an unsaved entry is discarded; resolves true to discard.
  confirmDiscard: () => Promise<boolean>;
  // The window is busy or the record changed elsewhere: drafts stay, saves wait.
  locked: boolean;
};

const PENDING_STAGE_ID = "pending-stage";

const ROW_TITLE: Record<"applied" | "skipped" | "response" | "followup", string> = {
  applied: "Applied",
  skipped: "Skipped",
  response: "Employer response",
  followup: "Follow-up sent"
};

function rowTitle(row: TimelineRow) {
  if (row.kind === "stage") return STATUS_LABEL[row.entry.status];
  if (row.kind === "interview") return interviewLabel(row);
  return ROW_TITLE[row.kind];
}

function rowMarker(row: TimelineRow) {
  if (row.kind === "applied") return "stage-dot stage-dot--applied";
  if (row.kind === "skipped") return "stage-dot stage-dot--not_applying";
  if (row.kind === "stage") return `stage-dot stage-dot--${row.entry.status}`;
  return "application-timeline__marker";
}

type Draft = { entry: StageHistoryEntry; isNew: boolean };

export function ApplicationTimelinePopover({
  open,
  triggerRef,
  anchorRef,
  onClose,
  savedStatus,
  appliedAt,
  notApplyingAt,
  stageHistory,
  submitted,
  pendingStage,
  onSaveEntry,
  onRemoveEntry,
  onUnsavedChange,
  confirmDiscard,
  locked
}: ApplicationTimelinePopoverProps) {
  const logRef = useRef<HTMLButtonElement>(null);
  const logGroupRef = useRef<HTMLDivElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Where focus goes once the draft row has committed or unmounted. An effect,
  // not a frame callback, so it lands before the modal's focus trap looks.
  const [refocus, setRefocus] = useState<"log" | "save" | null>(null);
  // Room for one more entry, and for an interview that also records its stage move.
  const savedFacts = { status: savedStatus, appliedAt, notApplyingAt, stageHistory };
  const placeholder: StageHistoryEntry = { id: "room-check", type: "followup", at: todayIso() };
  const canLogEntry = stageHistoryFits(savedFacts, savedStatus, [placeholder]);
  const canLogInterview = stageHistoryFits(savedFacts, savedStatus === "applied" ? "interviewing" : savedStatus, [placeholder]);

  // The open draft shows in place of its saved entry, or after them when new.
  const shown = draft
    ? draft.isNew
      ? [...stageHistory, draft.entry]
      : stageHistory.map((entry) => (entry.id === draft.entry.id ? draft.entry : entry))
    : stageHistory;
  const pendingEntry: StageHistoryEntry | null = pendingStage && pendingStage !== "draft"
    ? { id: PENDING_STAGE_ID, type: "stage", status: pendingStage, at: todayIso() }
    : null;
  const rows = deriveTimeline({
    status: savedStatus,
    appliedAt,
    notApplyingAt,
    stageHistory: pendingEntry ? [...shown, pendingEntry] : shown
  });
  const savedEntry = draft && !draft.isNew ? stageHistory.find((entry) => entry.id === draft.entry.id) : undefined;
  const draftChanged = draft ? draft.isNew || JSON.stringify(savedEntry) !== JSON.stringify(draft.entry) : false;

  useEffect(() => onUnsavedChange(draftChanged), [draftChanged, onUnsavedChange]);

  // An entry removed elsewhere (another tab, a conflict refresh) ends its edit.
  useEffect(() => {
    if (draft && !draft.isNew && !stageHistory.some((entry) => entry.id === draft.entry.id)) {
      setDraft(null);
      setConfirmRemove(false);
      setError("That entry was removed elsewhere, so your edit to it was not saved.");
    }
  }, [draft, stageHistory]);

  // The host may close the popover itself (after confirming); start clean next time.
  useEffect(() => {
    if (!open) {
      setDraft(null);
      setConfirmRemove(false);
      setError("");
    }
  }, [open]);

  function openDraft(next: Draft | null) {
    setDraft(next);
    setConfirmRemove(false);
    setError("");
  }

  // An unsaved entry survives stray clicks, scrolls and resizes; Escape and
  // Done ask before discarding it. Saved entries are already in the tracker.
  async function close(restoreFocus?: boolean, dismissed?: boolean) {
    if (draftChanged && (dismissed || !(await confirmDiscard()))) return;
    openDraft(null);
    onClose(restoreFocus);
  }

  function add(type: "interview" | "response" | "followup") {
    const id = newStageEntryId();
    const at = todayIso();
    openDraft({
      isNew: true,
      entry: type === "interview" ? { id, type, kind: "recruiter_screen", at } : { id, type, at }
    });
  }

  function editDraft(change: (entry: StageHistoryEntry) => StageHistoryEntry) {
    setDraft((current) => (current ? { ...current, entry: change(current.entry) } : current));
  }

  function changeNote(value: string) {
    editDraft((entry) => {
      if (entry.type === "stage") return entry;
      const { note: _previous, ...rest } = entry;
      return value.trim() ? { ...rest, note: value } : rest;
    });
  }

  function changeDate(value: string) {
    // A cleared or half-typed date keeps the last valid day; every entry needs one.
    const at = toIso(value);
    if (at) editDraft((entry) => ({ ...entry, at }));
  }

  // The draft's controls unmount with it, so focus returns to the first
  // available Log button, or Done when the timeline is full or locked.
  function finishDraft() {
    openDraft(null);
    setRefocus("log");
  }

  useEffect(() => {
    if (refocus === "log" && !draft) {
      const panel = logGroupRef.current?.closest(".application-popover") ?? document.getElementById("application-timeline");
      const target = Array.from(logGroupRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((button) => !button.disabled)
        ?? panel?.querySelector<HTMLButtonElement>(".application-popover__actions button");
      target?.focus();
      setRefocus(null);
    } else if (refocus === "save" && !busy) {
      (saveRef.current && !saveRef.current.disabled ? saveRef : cancelRef).current?.focus();
      setRefocus(null);
    }
  }, [busy, draft, refocus]);

  // Save stays focusable while busy (aria-disabled), so the modal focus trap
  // never pulls focus out of the popover mid-save; a failure keeps focus here.
  async function run(action: () => Promise<boolean>, failure: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    const saved = await action().catch(() => false);
    setBusy(false);
    if (saved) {
      finishDraft();
      return;
    }
    setError(failure);
    setRefocus("save");
  }

  function save() {
    if (draft) void run(() => onSaveEntry(draft.entry), "This entry could not be saved. It is still here; try again.");
  }

  function remove() {
    if (draft) void run(() => onRemoveEntry(draft.entry.id), "This entry could not be removed. Try again.");
  }

  const logBlocked = Boolean(draft) || busy || locked;

  return (
    <AnchoredPopover
      open={open}
      id="application-timeline"
      label="Timeline"
      triggerRef={triggerRef}
      anchorRef={anchorRef}
      placement="right"
      initialFocusRef={submitted && canLogInterview && !locked ? logRef : undefined}
      className="application-timeline"
      onClose={(restoreFocus, dismissed) => void close(restoreFocus, dismissed)}
    >
      <h3 className="application-timeline__title">Timeline</h3>
      {!submitted ? (
        <p className="application-muted">History starts when the application is submitted.</p>
      ) : null}

      {rows.length ? (
        <ol className="application-timeline__list">
          {rows.map((row) => {
            const title = rowTitle(row);
            const pending = "entry" in row && row.entry.id === PENDING_STAGE_ID;
            const editing = Boolean(draft) && "entry" in row && row.entry.id === draft?.entry.id;
            const summary = (
              <>
                <span className={rowMarker(row)} aria-hidden="true" />
                <span className="application-timeline__label">
                  <strong>{title}</strong>
                  {"entry" in row && row.entry.type !== "stage" && row.entry.note ? <span>{row.entry.note}</span> : null}
                </span>
                {row.kind === "interview" && row.scheduled ? <span className="application-timeline__tag">Scheduled</span> : null}
                {pending || (editing && draft?.isNew) ? <span className="application-timeline__tag">Unsaved</span> : null}
                <time className="is-data" dateTime={row.at}>{formatCompactDate(row.at)}</time>
              </>
            );
            if (!("entry" in row) || pending) {
              return <li className="application-timeline__row" key={row.key}>{summary}</li>;
            }
            const { entry } = row;
            return (
              <li className={`application-timeline__row is-editable${editing ? " is-editing" : ""}`} key={row.key}>
                <button
                  type="button"
                  className="application-timeline__summary"
                  aria-expanded={editing}
                  aria-label={`Edit ${title}${row.kind === "interview" && row.scheduled ? ", scheduled" : ""}, ${formatCompactDate(row.at)}`}
                  disabled={busy || (Boolean(draft) && !editing)}
                  onClick={() => openDraft(editing ? null : { entry, isNew: false })}
                >
                  {summary}
                </button>
                {editing && draft ? (
                  <div className="application-timeline__fields" role="group" aria-label={`${title} details`}>
                    {draft.entry.type === "interview" ? (
                      <select
                        className="text-input"
                        aria-label="Interview type"
                        value={draft.entry.kind}
                        autoFocus
                        disabled={busy}
                        onChange={(event) => editDraft((current) => ({ ...current, kind: event.target.value as InterviewKind }))}
                      >
                        {INTERVIEW_KINDS.map((kind) => (
                          <option key={kind} value={kind}>{INTERVIEW_KIND_LABEL[kind]}</option>
                        ))}
                      </select>
                    ) : null}
                    <input
                      className="text-input is-data"
                      type="date"
                      aria-label="Date"
                      max="9999-12-31"
                      value={toDateInput(draft.entry.at)}
                      autoFocus={draft.entry.type !== "interview"}
                      disabled={busy}
                      onChange={(event) => changeDate(event.target.value)}
                    />
                    {draft.entry.type !== "stage" ? (
                      <input
                        className="text-input application-timeline__note"
                        aria-label="Note"
                        value={draft.entry.note ?? ""}
                        maxLength={STAGE_HISTORY_NOTE_MAX_LENGTH}
                        placeholder="Note (optional)"
                        disabled={busy}
                        onChange={(event) => changeNote(event.target.value)}
                      />
                    ) : null}
                    {draft.isNew && draft.entry.type === "interview" && savedStatus === "applied" ? (
                      <p className="application-timeline__hint">Saving also moves the stage to Interviewing.</p>
                    ) : null}
                    {locked ? (
                      <p className="application-timeline__hint">This application changed elsewhere. Choose Use latest version, then save this entry.</p>
                    ) : null}
                    {error ? <p className="application-timeline__error" role="alert">{error}</p> : null}
                    <div className="application-timeline__entry-actions">
                      {!draft.isNew ? (
                        confirmRemove ? (
                          <button type="button" className="secondary-button is-compact danger-button" disabled={locked} aria-disabled={busy} onClick={remove}>
                            <Trash2 size={13} aria-hidden="true" /> Confirm remove
                          </button>
                        ) : (
                          <button type="button" className="ghost-button is-compact danger-button" disabled={busy} onClick={() => setConfirmRemove(true)}>
                            <Trash2 size={13} aria-hidden="true" /> Remove
                          </button>
                        )
                      ) : null}
                      <button ref={cancelRef} type="button" className="secondary-button is-compact" disabled={busy} onClick={finishDraft}>
                        Cancel
                      </button>
                      <button ref={saveRef} type="button" className="primary-button is-compact" disabled={locked || !draftChanged} aria-disabled={busy} onClick={save}>
                        {busy ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}

      {!draft && error ? <p className="application-timeline__error" role="alert">{error}</p> : null}
      {submitted && !canLogInterview ? (
        <p className="application-muted">
          {canLogEntry
            ? "Logging an interview here also records its stage move, which needs one more free entry. Remove an entry to log one."
            : "This application holds the most history entries one record can keep. Remove one to log more."}
        </p>
      ) : null}

      {submitted ? (
        <div className="application-timeline__log" ref={logGroupRef}>
          <button ref={logRef} type="button" className="secondary-button is-compact" aria-label="Log interview" disabled={logBlocked || !canLogInterview} onClick={() => add("interview")}>
            <Plus size={13} aria-hidden="true" /> Interview
          </button>
          <button type="button" className="secondary-button is-compact" aria-label="Log employer response" disabled={logBlocked || !canLogEntry} onClick={() => add("response")}>
            <Plus size={13} aria-hidden="true" /> Response
          </button>
          <button type="button" className="secondary-button is-compact" aria-label="Log follow-up sent" disabled={logBlocked || !canLogEntry} onClick={() => add("followup")}>
            <Plus size={13} aria-hidden="true" /> Follow-up
          </button>
        </div>
      ) : null}
    </AnchoredPopover>
  );
}
