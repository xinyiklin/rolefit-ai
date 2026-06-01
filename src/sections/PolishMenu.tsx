import { SlidersHorizontal } from "lucide-react";
import { NavMenu } from "./NavMenu";
import type { RoleOption } from "./SourcesPane";

type PolishMenuProps = {
  roleAppliedAs: string;
  setRoleAppliedAs: (v: string) => void;
  roleAppliedOptions: readonly RoleOption[];
  honestContext: string;
  setHonestContext: (v: string) => void;
  customInstructions: string;
  setCustomInstructions: (v: string) => void;
};

// Navbar dropdown for the inputs that steer the rewrite content (as opposed to
// the AiMenu, which picks the model/provider).
export function PolishMenu({
  roleAppliedAs,
  setRoleAppliedAs,
  roleAppliedOptions,
  honestContext,
  setHonestContext,
  customInstructions,
  setCustomInstructions
}: PolishMenuProps) {
  return (
    <NavMenu
      icon={<SlidersHorizontal size={13} aria-hidden={true} />}
      ariaLabel="Polish inputs"
      label={
        <>
          <span className="nav-menu__label">Polish</span>
          <span className="nav-menu__sub">{roleAppliedAs}</span>
        </>
      }
    >
      <label className="field">
        <span>Role applying as</span>
        <select value={roleAppliedAs} onChange={(event) => setRoleAppliedAs(event.target.value)}>
          {roleAppliedOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>
          Honest context <small>(true facts not on the resume — used only as evidence)</small>
        </span>
        <textarea
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
