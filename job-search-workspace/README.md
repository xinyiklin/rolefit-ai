# Job Search Workspace

Local, ignored storage for the RoleFit AI app.

- Keep base resume sources here as `.resume` files named `base-resume.resume` or
  `base-resume-<name>.resume` (a `.resume` file is the app's lossless JSON save of
  the structured resume data). The app labels `base-resume.resume` as Default;
  named variants replace dashes with spaces and title-case each word. Legacy
  `.txt` / `.md` / `.csv` base resumes are still read as plain text.
- The Pipeline tracker writes `applications.json` here automatically when you
  click Track in the app.
- Sent resume artifacts are stored per application under
  `applications/<application-id>/resume.pdf`.
- Keep other local artifacts here too — notes, job-specific drafts, and eval
  outputs.
- Do not store personal resumes or job-search artifacts in the repo root unless
  you intentionally want them tracked.
- Files in this folder are intentionally ignored by git except this README.
