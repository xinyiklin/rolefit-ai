// Persistence completions can arrive from independent workspace and
// application routes. A delayed completion may acknowledge its captured bytes
// only while no newer route has advanced the shared baseline.
export function createCoverLetterPersistenceBaselineOwnership() {
  let revision = 0;

  return {
    capture(): number {
      return revision;
    },
    commit(): number {
      revision += 1;
      return revision;
    },
    commitIfUnchanged(expectedRevision: number): boolean {
      if (revision !== expectedRevision) return false;
      revision += 1;
      return true;
    }
  };
}
