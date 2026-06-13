import { BriefcaseBusiness, DownloadCloud, Link2, Sparkles } from "lucide-react";
import { NavMenu } from "./NavMenu";

type JobMenuProps = {
  jobDescription: string;
  setJobDescription: (v: string) => void;
  jobUrl: string;
  setJobUrl: (v: string) => void;
  onExtractFromLink: () => void | Promise<void>;
  isExtractingLink: boolean;
  onDistillPaste: () => void;
  linkStatus: string;
  jobReady: boolean;
};

// Navbar dropdown for the job target: the optional posting URL (with one-click
// extract) and the job description the polish/review run against.
export function JobMenu({
  jobDescription,
  setJobDescription,
  jobUrl,
  setJobUrl,
  onExtractFromLink,
  isExtractingLink,
  onDistillPaste,
  linkStatus,
  jobReady
}: JobMenuProps) {
  const distillReady = jobDescription.trim().length >= 80;
  return (
    <NavMenu
      icon={<BriefcaseBusiness size={13} aria-hidden={true} />}
      ariaLabel="Job target"
      label={
        <>
          <span className="nav-menu__label">Job</span>
          <span className={`nav-menu__sub ${jobReady ? "is-ready" : "is-empty"}`}>
            {jobReady ? "ready" : "empty"}
          </span>
        </>
      }
    >
      <label className="field">
        <span>
          Job link <small>(optional — extract the posting below, or keep it for tracking)</small>
        </span>
        <div className="link-input-row">
          <div className="input-with-icon">
            <Link2 size={14} aria-hidden="true" />
            <input
              type="url"
              value={jobUrl}
              onChange={(event) => setJobUrl(event.target.value)}
              placeholder="https://… (job posting URL)"
            />
          </div>
          <button
            type="button"
            className="secondary-button is-compact link-extract"
            onClick={onExtractFromLink}
            disabled={!jobUrl.trim() || isExtractingLink}
            title="Fetch the posting and extract the description into the box below"
          >
            <DownloadCloud size={13} aria-hidden="true" />
            <span>{isExtractingLink ? "Extracting…" : "Extract"}</span>
          </button>
        </div>
      </label>
      <label className="field">
        <span>
          Job posting <small>(paste the full description, or extract it from the link above)</small>
        </span>
        <textarea
          className="textarea"
          value={jobDescription}
          onChange={(event) => setJobDescription(event.target.value)}
          placeholder="Paste responsibilities, qualifications, and preferred skills."
          rows={8}
        />
      </label>
      <div className="job-distill-row">
        <button
          type="button"
          className="secondary-button is-compact"
          onClick={onDistillPaste}
          disabled={!distillReady}
          title="Run the pasted text through the same structured-brief distiller the link extractor uses"
        >
          <Sparkles size={13} aria-hidden="true" />
          <span>Distill paste</span>
        </button>
        <small className="job-distill-hint">
          For links the server can't fetch — copy the visible page text, paste above, then distill.
        </small>
      </div>
      {linkStatus ? <p className="micro-status">{linkStatus}</p> : null}
    </NavMenu>
  );
}
