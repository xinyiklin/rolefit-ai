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
    "lastBaseResume": "base-resume.resume"
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

## Browser-preferences mirror

Browser preferences (the normalized `rolefit:settings` allowlist and the last
selected base resume name) live in origin-scoped browser storage, which the
companion cannot read. The Drafting Desk therefore mirrors them to the server:

- `POST /api/workspace/browser-preferences` — debounced push after any
  preference save. The server validates the allowlisted shape and atomically
  writes `browser-preferences.json` (owner-only permissions) in the workspace
  root with `source: "mirror"` and a fresh `updatedAt`.
- `GET /api/workspace/browser-preferences` — returns the stored file
  (`exists`, `source`, `updatedAt`, `settings`, `lastBaseResume`) or
  `exists: false`.

Backup reads that file server-side and, when present and valid, embeds it as
the envelope's `browser` field. A corrupt mirror file never blocks backing up
resumes; the envelope simply omits `browser`. The mirror file itself is not a
managed backup path and never appears in `files`.

Every completed restore also installs an internal `workspace-restore.json`
generation marker. It is not portable backup content. The marker lets every
browser origin detect that its pre-restore autosave drafts are obsolete even
when the imported backup has no optional `browser` payload. In that case the
browser clears drafts but preserves its existing origin-local preferences.

On load, the browser adopts server-stored preferences in exactly two cases:
after a restore (`source: "restore"` with an unseen `updatedAt` stamp — this
also clears superseded autosave recovery drafts), or when the origin has no
saved RoleFit preferences at all (continuity across a companion port change or
cleared site data). Everything else is a no-op, and adoption fails open so the
app always starts.

## Included data

Only files owned and validated by RoleFit enter the bundle:

- root `base-resume.resume` variants and legacy default TXT/MD/CSV bases;
- recognized base-resume history under `.trash/`;
- validated `applications.json` tracker data;
- valid saved `applications/<id>/resume.pdf` artifacts;
- the mirrored allowlisted RoleFit preferences described above.

Generated cover letters, application answers, job targets, and tailored resume
snapshots already stored on tracker records travel inside `applications.json`.

## Excluded data

The portable contract never includes:

- Electron provider registry or encrypted API-key vault bytes;
- provider CLI accounts/sessions or authentication state;
- `.env`, companion settings, local-site port, or Electron IPC state;
- per-tab presence/session identifiers or autosave recovery drafts;
- document/view preferences owned by shared Typeset storage;
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
   envelope carries `browser` preferences, stage them as a
   `source: "restore"` `browser-preferences.json` alongside the files. Always
   stage the independent restore-generation marker.
4. Re-run the strict `.resume`, tracker, and PDF domain validators against the
   complete staged tree.
5. Recheck live browser presence after staging and abort without replacement if
   a tab appeared while the restore was waiting or validating.
6. Rename the active workspace to a timestamped sibling
   `<workspace>.restore-backup-<stamp>-<id>` safety directory.
7. Atomically rename the staging workspace into the configured active path. If
   this final rename fails, restore the previous workspace path.
8. On its next load, the browser clears superseded autosave recovery drafts,
   adopts staged preferences when the backup supplied them, and records the
   restore stamp so adoption runs once per restore.

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
