# RoleFit Workspace

Local, ignored storage for the RoleFit AI app.

- `resumes/<variant>.resume` stores strict, editable resume variants. For
  example, `fullstack.resume` appears as “Fullstack” in the app.
- `cover-letters/<variant>.cover` stores strict, editable cover-letter variants.
  For example, `applied-ai.cover` appears as “Applied AI”.
- Each document folder owns its own `.trash/` history. The app archives the
  current bytes before replacing a variant.
- The application workflow writes `applications.json` here when a tracked or
  applied entry is saved.
- Sent documents are stored per application under
  `applications/<application-id>/`. Each Resume/Cover letter slot contains
  either editable `resume.resume` / `cover.cover` source saved from RoleFit or
  an explicitly uploaded `resume.pdf` / `cover.pdf`. Additional PDF uploads
  live in that record's `attachments/` folder. Deleting an application moves
  its whole folder to `applications/.trash/`.
- Keep other local artifacts here too, including notes, job-specific drafts,
  and eval outputs.
- Do not store personal resumes or job-search artifacts in the repo root unless
  you intentionally want them tracked.
- Files in this folder are intentionally ignored by git except this README.

Before finalizing a pre-release document-shape change, audit the ignored
workspace and convert every active, history, application, and
application-trash source with a throwaway developer tool. Keep that tool and
its timestamped backups outside the commit, then re-parse the complete
workspace before continuing.
