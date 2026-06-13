import type { Ref } from "react";
import { SlidersHorizontal } from "lucide-react";
import { NavMenu } from "./NavMenu";

type PolishMenuProps = {
  includeCoverLetter: boolean;
  setIncludeCoverLetter: (v: boolean) => void;
  strictReview: boolean;
  setStrictReview: (v: boolean) => void;
  honestContext: string;
  setHonestContext: (v: string) => void;
  customInstructions: string;
  setCustomInstructions: (v: string) => void;
  // Controlled open state — lets App.tsx open the menu programmatically.
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  // Forwarded ref for the honest-context textarea so App.tsx can focus it.
  honestContextRef?: Ref<HTMLTextAreaElement>;
};

// Navbar dropdown for the optional inputs that steer a polish run. The AiMenu,
// separately, picks the model/provider.
export function PolishMenu({
  includeCoverLetter,
  setIncludeCoverLetter,
  strictReview,
  setStrictReview,
  honestContext,
  setHonestContext,
  customInstructions,
  setCustomInstructions,
  open,
  onOpenChange,
  honestContextRef
}: PolishMenuProps) {
  return (
    <NavMenu
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
      <label className="toggle-row">
        <input
          checked={includeCoverLetter}
          onChange={(event) => setIncludeCoverLetter(event.target.checked)}
          type="checkbox"
        />
        <span>
          <strong>Cover letter</strong>
          <small>Draft a matching cover letter alongside the polish.</small>
        </span>
      </label>

      <label className="toggle-row">
        <input
          checked={strictReview}
          onChange={(event) => setStrictReview(event.target.checked)}
          type="checkbox"
        />
        <span>
          <strong>Strict review</strong>
          <small>Run a skeptical recruiter audit after the edit pass.</small>
        </span>
      </label>

      <label className="field">
        <span>
          Honest context <small>(true facts not on the resume — used only as evidence)</small>
        </span>
        <textarea
          ref={honestContextRef}
          className="textarea"
          value={honestContext}
          onChange={(event) => setHonestContext(event.target.value)}
          placeholder="e.g., shipped a PostgreSQL migration with zero downtime; led a 3-person hackathon team; merged PR to django-rest-framework."
          rows={3}
        />
      </label>

      <label className="field">
        <span>
          Custom instructions <small>(optional — steer the rewrite: tone, length, emphasis)</small>
        </span>
        <textarea
          className="textarea"
          value={customInstructions}
          onChange={(event) => setCustomInstructions(event.target.value)}
          placeholder="e.g., aim for one page; lead each bullet with a metric; use British spelling; don't add a summary section."
          rows={3}
        />
      </label>
    </NavMenu>
  );
}
