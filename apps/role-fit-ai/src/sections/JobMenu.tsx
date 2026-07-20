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
  distillProviderReady: boolean;
  distillProviderMessage: string;
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
  jobReady,
  distillProviderReady,
  distillProviderMessage
}: JobMenuProps) {
  const distillReady = jobDescription.trim().length >= 80;
  return (
    <NavMenu
      className="job-menu"
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
        <span>Job link <small>(optional)</small></span>
        <div className="link-input-row">
          <div className="input-with-icon">
            <Link2 size={14} aria-hidden="true" />
            <input
              type="url"
              value={jobUrl}
              onChange={(event) => setJobUrl(event.target.value)}
              placeholder="https://… (job posting URL)"
              disabled={isExtractingLink}
            />
          </div>
          <button
            type="button"
            className="secondary-button is-compact link-extract"
            onClick={onExtractFromLink}
            disabled={!jobUrl.trim() || isExtractingLink || !distillProviderReady}
            title={distillProviderReady
              ? "Fetch the posting and extract the description into the box below"
              : distillProviderMessage}
          >
            <DownloadCloud size={13} aria-hidden="true" />
            <span>{isExtractingLink ? "Extracting…" : "Extract"}</span>
          </button>
        </div>
      </label>
      <label className="field">
        <span>Job posting</span>
        <textarea
          className="textarea"
          value={jobDescription}
          onChange={(event) => setJobDescription(event.target.value)}
          placeholder="Paste responsibilities, qualifications, and preferred skills."
          rows={16}
          disabled={isExtractingLink}
        />
      </label>
      <div className="job-distill-row">
        <button
          type="button"
          className="secondary-button is-compact"
          onClick={onDistillPaste}
          disabled={!distillReady || isExtractingLink || !distillProviderReady}
          title={distillProviderReady
            ? "Run the pasted text through the same structured-brief distiller the link extractor uses"
            : distillProviderMessage}
        >
          <Sparkles size={13} aria-hidden="true" />
          <span>Distill paste</span>
        </button>
        <small className="job-distill-hint">
          {distillProviderReady
            ? "For links the server can't fetch: paste the page text, then distill."
            : distillProviderMessage}
        </small>
      </div>
      {linkStatus ? <p className="micro-status">{linkStatus}</p> : null}
    </NavMenu>
  );
}
