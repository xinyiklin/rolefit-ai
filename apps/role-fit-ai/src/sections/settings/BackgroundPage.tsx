import { useState } from "react";

import {
  PROFILE_BACKGROUND_CHAR_LIMIT,
  profileBackgroundLimitError,
  profileTextLength
} from "../../../shared/candidateProfileContract.ts";
import { PROFILE_BACKGROUND_STORAGE_LIMIT } from "../../lib/settings.ts";
import { ProfileNotes } from "./ProfileNotes.tsx";
import type { SettingsDialogProps } from "../SettingsDialog";

type BackgroundPageProps = Pick<SettingsDialogProps,
  | "profileBackground" | "onProfileBackgroundChange" | "profileBackgroundRef"
  | "profileResume" | "profileNoteFocus"
>;

export function BackgroundPage({
  profileBackground,
  onProfileBackgroundChange,
  profileBackgroundRef,
  profileResume,
  profileNoteFocus
}: BackgroundPageProps) {
  // An edit past the storage bound is refused whole rather than cut on save.
  const [refused, setRefused] = useState(false);
  const overLimit = profileBackgroundLimitError(profileBackground) !== null;
  const notice = refused
    ? `Background can't exceed ${PROFILE_BACKGROUND_STORAGE_LIMIT.toLocaleString("en-US")} characters.`
    : overLimit
      ? `Over ${PROFILE_BACKGROUND_CHAR_LIMIT.toLocaleString("en-US")} characters. AI steps won't run until it's shorter.`
      : "";

  return (
    <>
      <div className="settings-background__head">
        <p className="settings-panel__intro" id="profile-background-hint">
          Notes beyond your resume. Notes linked to an entry are the only Profile text Resume Polish uses for it.
        </p>
        <span className="sr-only" id="profile-background-title">Background</span>
        <span className={`settings-background__count${overLimit ? " is-over" : ""}`}>
          {profileTextLength(profileBackground).toLocaleString("en-US")} / {PROFILE_BACKGROUND_CHAR_LIMIT.toLocaleString("en-US")}
        </span>
      </div>

      <ProfileNotes
        resume={profileResume}
        background={profileBackground}
        onBackgroundChange={(next) => {
          const isRefused = next.length > PROFILE_BACKGROUND_STORAGE_LIMIT;
          setRefused(isRefused);
          if (!isRefused) onProfileBackgroundChange(next);
          return !isRefused;
        }}
        focusRequest={profileNoteFocus}
        textareaRef={profileBackgroundRef}
        textareaProps={{
          "aria-labelledby": "profile-background-title",
          "aria-describedby": notice ? "profile-background-hint profile-background-notice" : "profile-background-hint",
          "aria-invalid": overLimit || undefined
        }}
      />
      <p className="settings-background__notice" id="profile-background-notice" role="status">
        {notice}
      </p>
    </>
  );
}
