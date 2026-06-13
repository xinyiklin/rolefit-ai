# Job Search Workspace

Local, ignored storage for the RoleFit AI app.

- Keep base resume sources here as LaTeX files named `base-resume.tex` or
  `base-resume-<name>.tex`. The app labels `base-resume.tex` as Default;
  named variants replace dashes with spaces and title-case each word.
- The Pipeline tracker writes `applications.json` here automatically when you
  click Track in the app.
- Sent resume artifacts are stored per application under
  `applications/<application-id>/resume.tex` and `resume.pdf`.
- Keep other local artifacts here too — notes, job-specific drafts, and eval
  outputs.
- Do not store personal resumes or job-search artifacts in the repo root unless
  you intentionally want them tracked.
- Files in this folder are intentionally ignored by git except this README.
