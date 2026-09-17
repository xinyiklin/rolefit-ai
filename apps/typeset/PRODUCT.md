# Product

## Register

product

## Users

Typeset is for job seekers who want direct control over a polished,
ATS-friendly resume without learning a markup language or sending personal data
to a third party. They work primarily on desktop or tablet and expect familiar
document-editor behavior: open a file, edit the page, adjust formatting, save
their source, and export a PDF.

## Product Purpose

Typeset is a local-first, direct typeset resume editor. The rendered page
is the editor, the structured document model is the source of truth, and the
browser typesetting engine owns pagination and PDF output. Success means a user
can reopen a `.resume` file, make precise edits with confidence, and export the
same document they see on screen.

## Product Boundary

Typeset is the standalone, browser-only host for the shared Typeset engine and
editor packages. It owns file lifecycle, browser autosave, product identity,
and static deployment. The packages own the resume model, `.resume` contract,
layout, PDF output, editing behavior, and formatting controls shared with
RoleFit AI.

RoleFit concepts do not belong in this product: no job intake, AI providers,
tailoring stages, review verdicts, application tracker, local server, or remote
resume-data requests. Sharing the editor must not weaken Typeset's local-only
privacy promise or turn the standalone shell into a configurable host framework.

## Brand Personality

Calm, exact, capable. The product should feel like a focused document tool built
with the care of Pages, Word, or Google Docs, but reduced to the resume workflow.
Its voice is plain, reassuring, and literal.

## Anti-references

Do not resemble the previous sidebar-heavy control panel, a generic SaaS
dashboard, an AI writing assistant, or a decorative design canvas. Avoid
oversized import surfaces, nested cards, ornamental branding, novelty controls,
and implementation or conversion language in the user experience.

## Design Principles

1. **The document leads.** The resume remains centered, spacious, and visually
   dominant while application chrome stays quiet.
2. **Use familiar editor grammar.** File actions, history, formatting, zoom, and
   print behave like established document editors.
3. **Reveal precision progressively.** Common commands stay visible; detailed
   typography and spacing controls live in contextual popovers.
4. **Make ownership explicit.** Autosave status, `.resume` files, and PDF export
   communicate exactly where the user's work lives. A completed explicit
   `.resume` save clears both content and print-style dirty state.
5. **Keep the source truthful.** One versioned structured format drives reopen,
   autosave, layout, and export without lossy conversion paths.

## Accessibility & Inclusion

Target WCAG 2.2 AA for application chrome. Provide complete keyboard access,
visible focus states, semantic toolbar and popover behavior, non-color status
cues, reduced-motion support, and minimum practical touch targets on tablets.
Keep the editor available at compact widths: auto-fit the page, progressively
disclose toolbar controls, and retain Open/Save actions at compact widths rather
than blocking access with a screen-size gate.

## Resume entry rows

Standard resume entries support Add/Remove title and subtitle rows from the
right-click menu, including when targeting an entry's bullet. Each row includes
its left and right fields; Remove clears both and supports Undo. Enter at the
end of Title right adds or focuses Subtitle left. Backspace at the start of
Subtitle left removes the row only when both subtitle fields are empty, then
returns to Title right when available. Forward Delete is unchanged.

A fully empty entry remains recoverable from the containing section's
`Empty entry N` context submenu. Row absence persists in `.resume` and removes
its space from editor, print, and PDF output. Existing resumes retain their
appearance; older builds reject newly saved files with removed rows. These
controls do not apply to section headings, Skills, Summary, or cover letters.

Long title/subtitle values wrap within the paired row, keeping a short date or
location intact when space permits. Names and individual contacts also wrap
inside the document margins. Continuations preserve authored text, formatting,
links, and the existing Enter/Tab behavior; unusually tall headings continue on
the next page. Fitting paired rows keep their existing layout. Header baselines
stay fixed when typing different letter shapes at the same font, size and wrap
count, including typing the first character into an empty name.

Section titles also wrap inside the text margins. Their alignment and heading
case are preserved; one section rule follows the final continuation, and tall
headings can continue onto another page without changing saved text.
