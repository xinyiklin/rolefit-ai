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
- Add a focused deterministic eval for durable parsing, identity, workflow,
  naming, or evidence behavior. Cover adversarial and empty inputs, not only the
  happy path.

`inlineMarks.tsx` is an intentional React-bearing presentation adapter. Do not
use that exception as precedent for unrelated helpers.
