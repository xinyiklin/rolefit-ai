export type WorkspaceLoadClaim = {
  generation: number;
  applyBaseResume: boolean;
};

// Metadata refreshes may replace option/history snapshots, but they cannot own
// a generation until the one startup load has committed the initial document.
// Otherwise a sibling restore event can strand every Prepare waiter forever.
export function createWorkspaceLoadOwnership() {
  let generation = 0;
  let bootstrapSettled = false;
  let settleBootstrap!: () => void;
  const bootstrapPromise = new Promise<void>((resolve) => {
    settleBootstrap = resolve;
  });

  return {
    async claim(applyBaseResume: boolean): Promise<WorkspaceLoadClaim> {
      if (!applyBaseResume && !bootstrapSettled) await bootstrapPromise;
      generation += 1;
      return { generation, applyBaseResume };
    },
    isCurrent(claim: WorkspaceLoadClaim): boolean {
      return claim.generation === generation;
    },
    startupMaySettle(claim: WorkspaceLoadClaim): boolean {
      return claim.applyBaseResume && claim.generation === generation;
    },
    whenBootstrapped(): Promise<void> {
      return bootstrapPromise;
    },
    settleBootstrapAfterCommit(): boolean {
      if (bootstrapSettled) return false;
      bootstrapSettled = true;
      settleBootstrap();
      return true;
    }
  };
}
