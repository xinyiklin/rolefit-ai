import type { Ref } from "react";
import { SlidersHorizontal } from "lucide-react";
import { CITIZENSHIP_OPTIONS, type CitizenshipStatus } from "../lib/candidateFacts";
import { NavMenu } from "./NavMenu";

type PolishMenuProps = {
  includeCoverLetter: boolean;
  setIncludeCoverLetter: (v: boolean) => void;
  polishStages: "tailor" | "review" | "both";
  setPolishStages: (v: "tailor" | "review" | "both") => void;
  honestContext: string;
  setHonestContext: (v: string) => void;
  citizenshipStatus: CitizenshipStatus;
  setCitizenshipStatus: (v: CitizenshipStatus) => void;
  legallyAuthorizedToWork: boolean;
  setLegallyAuthorizedToWork: (v: boolean) => void;
  requiresSponsorship: boolean;
  setRequiresSponsorship: (v: boolean) => void;
  customInstructions: string;
  setCustomInstructions: (v: string) => void;
  // Controlled open state — lets App.tsx open the menu programmatically.
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  // Forwarded ref for the honest-context textarea so App.tsx can focus it.
  honestContextRef?: Ref<HTMLTextAreaElement>;
};

const STAGE_OPTIONS: { value: "tailor" | "review" | "both"; label: string }[] = [
  { value: "tailor", label: "Tailor only" },
  { value: "review", label: "Review only" },
  { value: "both", label: "Both" }
];

// Navbar dropdown for the optional inputs that steer a polish run. The AiMenu,
// separately, picks the model/provider.
export function PolishMenu({
  includeCoverLetter,
  setIncludeCoverLetter,
  polishStages,
  setPolishStages,
  honestContext,
  setHonestContext,
  citizenshipStatus,
  setCitizenshipStatus,
  legallyAuthorizedToWork,
  setLegallyAuthorizedToWork,
  requiresSponsorship,
  setRequiresSponsorship,
  customInstructions,
  setCustomInstructions,
  open,
  onOpenChange,
  honestContextRef
}: PolishMenuProps) {
  return (
    <NavMenu
      className="options-menu"
      icon={<SlidersHorizontal size={13} aria-hidden={true} />}
      ariaLabel="Polish options"
      label={
        <>
          <span className="nav-menu__label">Options</span>
        </>
      }
      open={open}
      onOpenChange={onOpenChange}
    >
      <label className="check-row">
        <input
          checked={includeCoverLetter}
          onChange={(event) => setIncludeCoverLetter(event.target.checked)}
          type="checkbox"
        />
        <span>
          <strong>Cover letter</strong>
        </span>
      </label>

      <div role="group" aria-labelledby="polish-stages-label" className="field">
        <span id="polish-stages-label">
          <strong>Polish stages</strong>
        </span>
        <div className="segmented-control" role="radiogroup" aria-labelledby="polish-stages-label">
          {STAGE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`segmented-control__option${polishStages === opt.value ? " is-selected" : ""}`}
            >
              <input
                type="radio"
                name="polish-stages"
                value={opt.value}
                checked={polishStages === opt.value}
                onChange={() => setPolishStages(opt.value)}
                className="sr-only"
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>

      {/* Work authorization group (compact: single-line toggles, no sub-hints) */}
      <div className="menu-subhead" style={{ marginTop: 'var(--s1)' }}>
        <span className="menu-subhead__title">Work authorization</span>
      </div>

      <label className="field field--inline">
        <span><strong>Citizenship</strong></span>
        <select
          className="select--compact"
          value={citizenshipStatus}
          onChange={(event) => setCitizenshipStatus(event.target.value as CitizenshipStatus)}
        >
          {/* Neutral default: shown until a concrete status is picked, but not a
              selectable menu entry (anti-fabrication opt-in gate). */}
          <option value="unspecified" disabled hidden>Not specified</option>
          {CITIZENSHIP_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </label>

      {/* Work-auth facts are sent to the AI only once a citizenship is chosen, so
          the checkboxes stay hidden (and inert) until then — nothing about
          citizenship/authorization is asserted by default. */}
      {citizenshipStatus === "unspecified" ? (
        <p className="micro-status">Pick a citizenship status to include work-authorization facts when tailoring.</p>
      ) : (
        <>
          <label className="check-row">
            <input
              checked={legallyAuthorizedToWork}
              onChange={(event) => setLegallyAuthorizedToWork(event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong>Legally authorized to work in U.S.</strong>
            </span>
          </label>

          <label className="check-row">
            <input
              checked={requiresSponsorship}
              onChange={(event) => setRequiresSponsorship(event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong>Will require sponsorship</strong>
            </span>
          </label>
        </>
      )}

      <label className="field">
        <span>
          Honest context <small>(true facts not on your resume, used only as evidence)</small>
        </span>
        <textarea
          ref={honestContextRef}
          className="textarea"
          value={honestContext}
          onChange={(event) => setHonestContext(event.target.value)}
          placeholder="e.g., shipped a PostgreSQL migration with zero downtime; led a 3-person hackathon team; merged PR to django-rest-framework."
          rows={6}
        />
      </label>

      <label className="field">
        <span>
          Custom instructions <small>(optional; steer tone, length, emphasis)</small>
        </span>
        <textarea
          className="textarea"
          value={customInstructions}
          onChange={(event) => setCustomInstructions(event.target.value)}
          placeholder="e.g., aim for one page; lead each bullet with a metric; use British spelling; don't add a summary section."
          rows={6}
        />
      </label>
    </NavMenu>
  );
}
