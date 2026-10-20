import { useEffect, useRef, useState, type RefObject } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { ApplicationStatus } from "../../hooks/useApplications";
import { STATUS_LABEL, formatCompactDate } from "../../lib/applicationDisplay";
import {
  deriveTimeline,
  interviewLabel,
  newStageEntryId,
  type TimelineRow
} from "../../lib/applicationStageHistory";
import { toDateInput, toIso, todayIso } from "../../lib/dateInput";
import {
  INTERVIEW_KINDS,
  INTERVIEW_KIND_LABEL,
  STAGE_HISTORY_MAX_ENTRIES,
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
  confirmDiscard
}: ApplicationTimelinePopoverProps) {
  const logRef = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const full = stageHistory.length >= STAGE_HISTORY_MAX_ENTRIES;

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
    // A cleared date input keeps the last day; every entry needs one.
    if (value) editDraft((entry) => ({ ...entry, at: toIso(value) }));
  }

  // The draft's controls unmount with it, so focus returns to the Log buttons.
  function finishDraft() {
    openDraft(null);
    window.requestAnimationFrame(() => logRef.current?.focus());
  }

  async function run(action: () => Promise<boolean>, failure: string) {
    setBusy(true);
    setError("");
    const saved = await action().catch(() => false);
    setBusy(false);
    if (saved) finishDraft();
    else setError(failure);
  }

  function save() {
    if (draft) void run(() => onSaveEntry(draft.entry), "This entry could not be saved. It is still here; try again.");
  }

  function remove() {
    if (draft) void run(() => onRemoveEntry(draft.entry.id), "This entry could not be removed. Try again.");
  }

  const logDisabled = full || Boolean(draft) || busy;

  return (
    <AnchoredPopover
      open={open}
      id="application-timeline"
      label="Timeline"
      triggerRef={triggerRef}
      anchorRef={anchorRef}
      placement="right"
      initialFocusRef={submitted ? logRef : undefined}
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
                  aria-label={`Edit ${title}, ${formatCompactDate(row.at)}`}
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
                    {error ? <p className="application-timeline__error" role="alert">{error}</p> : null}
                    <div className="application-timeline__entry-actions">
                      {!draft.isNew ? (
                        confirmRemove ? (
                          <button type="button" className="secondary-button is-compact danger-button" disabled={busy} onClick={remove}>
                            <Trash2 size={13} aria-hidden="true" /> Confirm remove
                          </button>
                        ) : (
                          <button type="button" className="ghost-button is-compact danger-button" disabled={busy} onClick={() => setConfirmRemove(true)}>
                            <Trash2 size={13} aria-hidden="true" /> Remove
                          </button>
                        )
                      ) : null}
                      <button type="button" className="secondary-button is-compact" disabled={busy} onClick={finishDraft}>
                        Cancel
                      </button>
                      <button type="button" className="primary-button is-compact" disabled={busy || !draftChanged} onClick={save}>
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

      {full ? (
        <p className="application-muted">This application holds the most history entries one record can keep. Remove one to log more.</p>
      ) : null}

      {submitted ? (
        <div className="application-timeline__log">
          <button ref={logRef} type="button" className="secondary-button is-compact" disabled={logDisabled} onClick={() => add("interview")}>
            <Plus size={13} aria-hidden="true" /> Interview
          </button>
          <button type="button" className="secondary-button is-compact" disabled={logDisabled} onClick={() => add("response")}>
            <Plus size={13} aria-hidden="true" /> Response
          </button>
          <button type="button" className="secondary-button is-compact" disabled={logDisabled} onClick={() => add("followup")}>
            <Plus size={13} aria-hidden="true" /> Follow-up
          </button>
        </div>
      ) : null}
    </AnchoredPopover>
  );
}
