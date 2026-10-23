// Shown while a workspace file was saved by a newer RoleFit (D095). The server
// refuses every change to that file, so this states why and what to do.

type WorkspaceNewerNoticeProps = {
  tracker: boolean;
  settings: boolean;
};

export function WorkspaceNewerNotice({ tracker, settings }: WorkspaceNewerNoticeProps) {
  const subject = tracker && settings ? "applications and settings" : tracker ? "applications" : "settings";
  return (
    <p className="workspace-newer-notice" role="status">
      Your {subject} were saved by a newer version of RoleFit. Update RoleFit to change them; this
      version leaves them unchanged.
    </p>
  );
}
