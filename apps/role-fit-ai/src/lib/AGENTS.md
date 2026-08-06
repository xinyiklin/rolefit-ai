# RoleFit Deterministic Helpers Guide

Applies to `apps/role-fit-ai/src/lib/`.

- Keep helpers deterministic and independent of React, storage, and the DOM
  unless the filename and API make an intentional boundary explicit.
- One concept gets one owner: job extraction, job identity, workflow state,
  request adaptation, review targeting, download naming, and verdict display
  must not acquire parallel representations in components or hooks.
- Prefer typed inputs and explicit result unions over sentinel strings,
  partially populated objects, or exceptions for expected control flow.
- Normalize once at the boundary, preserve raw values only when the caller
  genuinely needs them, and never mutate caller-owned data.
- Keep display copy separate from domain state. A label formatter may describe
  a verdict; it must not infer or recalculate the verdict.
- Browser/server-shared helpers must remain safe to import in both runtimes and
  must not pull React-bearing package paths into Node.
- `coverLetterPreflight.ts` owns template-token detection, deterministic
  correspondence resolution (date, name, role, company, recipient, greeting,
  sign-off), and the short list of facts that genuinely block tailoring.
  Components and routes consume this contract instead of maintaining separate
  regexes. Authored word count is a voice signal for the prompt, never a gate:
  keep `canTailor` limited to facts nothing can resolve.
- `coverLetterEvidence.ts` owns atomic resume/context/answer extraction, stable
  content-derived ids, and the tailoring result shape. It offers the whole
  corpus and ranks nothing — selection is the model's job. Unresolved Guidance
  prompts are filtered rather than promoted as facts. It stays deterministic
  and browser/server safe. `coverLetterFailure.ts` owns the display-safe typed
  `422 blocked` parser and validates each fixed code/category/recovery shape at
  the loopback boundary before any issue reaches browser chrome.
- `applicationMutation.ts` owns sparse tracker request selection and
  reference-preserving own-write response reconciliation. It does not own
  persistence, queueing, conflicts, or React state.
- `coverLetterWorkspaceRepository.ts` is the typed HTTP boundary for named
  letter variants and history. `coverLetterExport.ts` owns pure source/PDF
  artifact construction; neither helper owns React state or document history.
- `jobIdentity.ts` owns both duplicate matching and the dependency-free
  candidate cache version. The key must use the matcher's effective text/role
  selectors and conservatively invalidate every observable verdict input; safe
  over-invalidation is preferable to a false cache hit.
- Add a focused deterministic eval for durable parsing, identity, workflow,
  naming, or evidence behavior. Cover adversarial and empty inputs, not only the
  happy path.

`inlineMarks.tsx` is an intentional React-bearing presentation adapter. Do not
use that exception as precedent for unrelated helpers.
