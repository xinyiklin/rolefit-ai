// Process-local generation gate around whole-workspace replacement. A normal
// request captures the generation when it enters a storage queue; if a restore
// begins before that request executes, the stale request is rejected instead of
// writing its pre-restore browser state over newly installed files.

export type WorkspaceAccessCapture = Readonly<{
  generation: number;
  blockedAtCapture: boolean;
}>;

let generation = 0;
let restoreActive = false;
let presenceAttempted = false;

export class WorkspaceRestoreConflictError extends Error {
  readonly status = 409;
  constructor() {
    super("The workspace is being restored. Wait for the companion to finish, then reload this tab.");
    this.name = "WorkspaceRestoreConflictError";
  }
}

export function beginWorkspaceRestore(): number {
  if (restoreActive) throw new WorkspaceRestoreConflictError();
  generation += 1;
  restoreActive = true;
  presenceAttempted = false;
  return generation;
}

export function endWorkspaceRestore(token: number): void {
  if (restoreActive && token === generation) restoreActive = false;
}

export function workspaceRestoreIsActive(): boolean {
  return restoreActive;
}

export function captureWorkspaceAccess(): WorkspaceAccessCapture {
  return Object.freeze({ generation, blockedAtCapture: restoreActive });
}

export function assertWorkspaceAccessAllowed(capture: WorkspaceAccessCapture): void {
  if (capture.blockedAtCapture || restoreActive || capture.generation !== generation) {
    throw new WorkspaceRestoreConflictError();
  }
}

export function noteWorkspacePresenceAttempt(): void {
  if (restoreActive) presenceAttempted = true;
}

export function workspaceRestoreHadPresenceAttempt(): boolean {
  return presenceAttempted;
}
