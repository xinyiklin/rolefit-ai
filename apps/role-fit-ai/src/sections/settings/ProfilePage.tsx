import {
  AVAILABILITY_NOTICE_OPTIONS,
  CITIZENSHIP_OPTIONS,
  DECLARED_ANSWER_OPTIONS,
  EDUCATION_LEVEL_OPTIONS,
  MAJOR_MAX_LENGTH,
  type AvailabilityNotice,
  type CitizenshipStatus,
  type DeclaredAnswer,
  type EducationLevel
} from "../../lib/candidateFacts";
import type { SettingsDialogProps } from "../SettingsDialog";

type ProfilePageProps = Pick<SettingsDialogProps,
  | "citizenshipStatus" | "onCitizenshipChange"
  | "legallyAuthorizedToWork" | "onLegallyAuthorizedChange"
  | "requiresSponsorship" | "onRequiresSponsorshipChange"
  | "educationLevel" | "onEducationLevelChange"
  | "major" | "onMajorChange"
  | "gpa" | "onGpaChange"
  | "availabilityNotice" | "onAvailabilityNoticeChange"
  | "availabilityDate" | "onAvailabilityDateChange"
>;

export function ProfilePage({
  citizenshipStatus,
  onCitizenshipChange,
  legallyAuthorizedToWork,
  onLegallyAuthorizedChange,
  requiresSponsorship,
  onRequiresSponsorshipChange,
  educationLevel,
  onEducationLevelChange,
  major,
  onMajorChange,
  gpa,
  onGpaChange,
  availabilityNotice,
  onAvailabilityNoticeChange,
  availabilityDate,
  onAvailabilityDateChange
}: ProfilePageProps) {
  return (
    <>
      <p className="settings-panel__intro">
        Optional facts beyond your resume. Nothing here is sent to the AI until you fill it in.
      </p>

      <div className="settings-profile__facts">
        <div className="menu-subhead">
          <span className="menu-subhead__title">Eligibility</span>
        </div>

        <label className="field field--inline">
          <span><strong>Citizenship</strong></span>
          <select
            className="select--compact"
            value={citizenshipStatus}
            onChange={(event) => onCitizenshipChange(event.target.value as CitizenshipStatus)}
          >
            {/* Neutral default: shown until a concrete status is picked, but not a
                selectable menu entry (anti-fabrication opt-in gate). */}
            <option value="unspecified" disabled hidden>Not specified</option>
            {CITIZENSHIP_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="field field--inline">
          <span><strong>U.S. work authorization</strong></span>
          <select
            className="select--compact"
            value={legallyAuthorizedToWork}
            onChange={(event) => onLegallyAuthorizedChange(event.target.value as DeclaredAnswer)}
          >
            {DECLARED_ANSWER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="field field--inline">
          <span><strong>Requires visa sponsorship</strong></span>
          <select
            className="select--compact"
            value={requiresSponsorship}
            onChange={(event) => onRequiresSponsorshipChange(event.target.value as DeclaredAnswer)}
          >
            {DECLARED_ANSWER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <div className="menu-subhead">
          <span className="menu-subhead__title">Education</span>
        </div>

        <label className="field field--inline">
          <span><strong>Highest completed level</strong></span>
          <select
            className="select--compact"
            value={educationLevel}
            onChange={(event) => onEducationLevelChange(event.target.value as EducationLevel)}
          >
            {/* Same opt-in gate as citizenship: a degree is one of the easiest
                things for a resume model to invent, so the default claims none. */}
            <option value="unspecified" disabled hidden>Not specified</option>
            {EDUCATION_LEVEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        {educationLevel === "unspecified" ? (
          <p className="micro-status">Choose a level to include your education as evidence.</p>
        ) : (
          <>
            <label className="field field--inline">
              <span>Field of study <small>(optional)</small></span>
              <input
                className="text-input"
                type="text"
                maxLength={MAJOR_MAX_LENGTH}
                value={major}
                placeholder="e.g. Mechanical Engineering"
                onChange={(event) => onMajorChange(event.target.value)}
              />
            </label>
            <label className="field field--inline" htmlFor="candidate-gpa">
              <span>GPA <small>(optional)</small></span>
              <input
                id="candidate-gpa"
                className="text-input text-input--narrow"
                type="number"
                min={0}
                max={4}
                step={0.01}
                inputMode="decimal"
                value={gpa ?? ""}
                placeholder="e.g. 3.8"
                onChange={(event) => {
                  const value = event.target.value;
                  onGpaChange(value === "" ? undefined : Number(value));
                }}
              />
            </label>
          </>
        )}

        <div className="menu-subhead">
          <span className="menu-subhead__title">Availability</span>
        </div>

        <label className="field field--inline">
          <span><strong>Earliest start</strong></span>
          <select
            className="select--compact"
            value={availabilityNotice}
            onChange={(event) => {
              const next = event.target.value as AvailabilityNotice;
              onAvailabilityNoticeChange(next);
              if (next !== "specific-date") onAvailabilityDateChange("");
            }}
          >
            {AVAILABILITY_NOTICE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        {availabilityNotice === "specific-date" ? (
          <label className="field field--inline" htmlFor="candidate-availability-date">
            <span>Earliest available date</span>
            <input
              id="candidate-availability-date"
              className="text-input text-input--narrow"
              type="date"
              value={availabilityDate}
              onChange={(event) => onAvailabilityDateChange(event.target.value)}
            />
          </label>
        ) : null}
      </div>
    </>
  );
}
