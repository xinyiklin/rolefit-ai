# Portable Workspace Backup And Restore

RoleFit stays local-first and account-free. Portable workspace backup moves a
validated saved workspace between installations or browser origins; it is not a
cloud-sync protocol, provider-vault export, or live-session snapshot.

The desktop companion is the home of the Backup and Restore actions. The
browser Drafting Desk contributes two supporting flows: it mirrors allowlisted
preferences to the local server so companion backups can include them, and it
adopts restored preferences on its next load.

## Wire contract

The file extension is `.rolefit-backup`. Its JSON envelope is strict:

```json
{
  "format": "rolefit-workspace-backup",
  "schemaVersion": 1,
  "createdAt": "2026-07-20T12:00:00.000Z",
  "files": [],
  "browser": {
    "settings": {},
    "lastBaseResume": "default.resume"
  }
}
```

Each file record carries an allowlisted slash-separated path, `utf8` or
`base64` encoding, decoded byte length, SHA-256 digest, and encoded data. The
contract rejects unknown envelope/file keys, unsupported versions, duplicate or
traversing paths, encoding mismatches, invalid sizes/checksums, more than 1,100
files, any one file over 10 MB, and more than 64 MB of decoded workspace data.
The companion refuses backup files over 96 MB before reading or transferring
them, leaving room for base64 and JSON overhead.

The bundle is intentionally plain, inspectable JSON and is **not encrypted**.
Treat it like the resumes and application records it contains.

## Canonical workspace preferences

The normalized `rolefit:settings` allowlist and last selected base resume name
are canonical in the active OS-user workspace. Origin-scoped browser storage is
only a fail-open cache. Every Drafting Desk client attached to the workspace
uses the same server contract:

- `POST /api/workspace/preferences` — debounced push after any preference save.
  The server validates the allowlisted shape and atomically writes
  `workspace-preferences.json` (owner-only permissions) in the workspace root
  with `source: "workspace"` and a fresh `updatedAt`.
- `GET /api/workspace/preferences` — returns the stored file (`exists`,
  `source`, `updatedAt`, `settings`, `lastBaseResume`) or `exists: false`.
  Clients adopt it before first render and refresh it on window focus, so
  browser, port, and incognito boundaries do not fork the profile.

Backup embeds valid preferences as the envelope's `preferences` field. A
corrupt preferences file never blocks backing up resumes; the envelope simply
omits `preferences`. The file itself is not a managed backup path and never
appears in `files`. A client also never overwrites a corrupt canonical record
from one browser cache; Settings reports the persistence error until the record
is repaired or replaced by a validated restore.

The workspace backup, workspace preferences, and restore-marker documents each
have one live schema: version 1. Other schema versions and retired field names
are rejected rather than migrated.

Every completed restore also installs an internal `workspace-restore.json`
generation marker. It is not portable backup content. The marker lets every
browser origin detect that its own pre-restore autosave draft is obsolete even
when the imported backup has no optional `preferences` payload. The adopting tab
also clears invalid, expired, and confirmed-dead-tab orphans, but preserves
drafts owned by live sibling tabs and publishes a workspace-adoption event so
those tabs can surface the change without losing their in-flight work. Each
event has a unique id because storage and `BroadcastChannel` may both deliver
it. Siblings de-duplicate that id and refresh workspace choices without
automatically replacing an open document; reordered refreshes commit only
the latest response. The workspace preference record remains canonical even
when the imported backup omitted preferences.

On load and window focus, the browser adopts server-stored preferences. A new
restore generation also performs the tab-safe draft cleanup above. If the
server has no preference file yet, a pre-existing browser cache seeds it once;
afterward the workspace owns the record. Adoption fails open so a temporarily
unavailable companion does not prevent the app from starting.

## Included data

Only files owned and validated by RoleFit enter the bundle:

- resume variants under `resumes/`;
- recognized resume history under `resumes/.trash/`;
- validated `applications.json` tracker data;
- current-schema application document sources or PDFs and PDF attachments under
  tracked `applications/<id>/` directories;
- the canonical allowlisted workspace preferences described above.

Generated cover letters, application answers, job targets, and tailored resume
snapshots already stored on tracker records travel inside `applications.json`.
Candidate-authored `cover-letters/*.cover` files and their local `.trash`
history remain standalone editable documents outside the portable workspace
contract. Download those `.cover` variants separately when moving devices.

The single live schema above carries the tracked application's one active
Resume/Cover letter representation (`resume.resume` or `resume.pdf`,
`cover.cover` or `cover.pdf`) plus validated PDF files under `attachments/`.
Application paths whose ids are absent from `applications.json` are excluded.
Creation and restore also require an exact match between tracker
artifact/attachment metadata and bundled bytes, so a portable restore cannot
claim a document exists when its file is missing or install an untracked file.

## Excluded data

The portable contract never includes:

- Electron provider registry or encrypted API-key vault bytes;
- provider CLI accounts/sessions or authentication state;
- `.env`, companion settings, local-site port, or Electron IPC state;
- per-tab presence/session identifiers or autosave recovery drafts;
- document/view preferences owned by shared Typeset storage;
- saved standalone cover-letter variants and their local history;
- arbitrary files, symlinks, temporary files, or previous restore safety copies.

On another device, the user adds providers again.

## Snapshot and restore behavior

Backup obtains the base-workspace and application locks together. Tracker reads
and mutations, PDF reads/writes, extension duplicate checks, base-resume
mutations, backup, and restore therefore cannot observe overlapping saved-state
transitions.

Restore is replace-not-merge:

1. Refuse to start while live Drafting Desk tabs are detected (see presence
   below); the route answers 409.
2. Parse the strict envelope and verify aggregate limits.
3. Decode each file, verify its byte count and SHA-256 digest, and write it to a
   private sibling staging workspace with owner-only permissions. When the
   envelope carries `preferences`, stage them as a
   `source: "restore"` `workspace-preferences.json` alongside the files. Always
   stage the independent restore-generation marker.
4. Re-run the strict `.resume`, tracker, and PDF domain validators against the
   complete staged tree.
5. Recheck live browser presence after staging and abort without replacement if
   a tab appeared while the restore was waiting or validating.
6. Rename the active workspace to a timestamped sibling
   `<workspace>.restore-backup-<stamp>-<id>` safety directory.
7. Atomically rename the staging workspace into the configured active path. If
   this final rename fails, restore the previous workspace path.
8. On its next load, the browser clears its own superseded draft and dead
   orphans, preserves live sibling drafts, publishes the adoption event, adopts
   staged preferences when the backup supplied them, and records the restore
   stamp so adoption runs once per restore.

Unknown files from the previous workspace are not imported, but remain in the
sibling safety copy. Safety copies are not silently pruned.

## Tab presence

The server cannot otherwise see open browser tabs, so each Drafting Desk tab
beacons `POST /api/presence` (`tabId` only, in-memory, never persisted or
echoed back) on its existing heartbeat cadence, plus a `gone` beacon on
`pagehide`. `GET /api/workspace/activity` exposes only a live-tab count within
a 90-second window; the companion uses it to disable Restore with guidance
while tabs are open, and the restore route enforces the same gate regardless of
caller. This server-side beacon is deliberately separate from the
localStorage-based cross-tab presence registry, which must not clear on
`pagehide`.

## UI and concurrency

Back up and Restore live in the companion's Workspace section, next to the local
workspace location and an Open-folder action. Backup writes the envelope
through a native save dialog using an owner-only sibling temporary file and
final rename; Restore reads through a native open dialog,
requires a native confirmation, and reports the server's classified errors
verbatim. Unsaved editor changes stay in the browser and are never part of a
backup; the Workspace section states this. Backup and restore are management
operations and are not exposed as loopback HTTP routes. An owned server accepts
them only over Electron's private parent/child process channel; if the companion
reuses an already-running standalone server, the Workspace section asks for a
companion restart before enabling transfer.

## Verification

The auto-discovered
`server/__evals__/workspace-backup-probes.mjs` covers managed-file discovery,
symlink/arbitrary-file exclusion, preference-mirror inclusion and corrupt-file
tolerance, pre-allocation capacity bounds, checksum-preserved round trips,
retained previous workspaces, marker-only restores, both live-tab restore
gates, restore-generation rejection of stale queued writes, and
fail-without-mutation behavior for bad checksums,
tracker JSON, strict resumes, PDFs, duplicate paths, and path traversal.
`src/hooks/__evals__/workspace-backup-lifecycle.mjs` covers the pure browser
adoption rules.

Run:

```bash
node apps/role-fit-ai/server/__evals__/workspace-backup-probes.mjs
node apps/role-fit-ai/src/hooks/__evals__/workspace-backup-lifecycle.mjs
npm test --workspace apps/role-fit-ai
npx tsc -p apps/role-fit-ai/tsconfig.server.json --noEmit
npm run build:rolefit
```
