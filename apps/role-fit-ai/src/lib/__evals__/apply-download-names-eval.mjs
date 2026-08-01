// Probes for the document-title kind swap (src/lib/downloads.ts) that names the
// Apply download pair. The dialog seeds the cover letter's field from the
// resume's name, so a derivation bug is invisible until a file lands in the
// user's Downloads folder with the wrong name on it — and both names stay
// editable afterwards, so the swap must produce a sane STARTING point rather
// than a merely unique one. Offline + deterministic; run by `npm test`.

import { buildResumeDocumentTitle, swapDocumentTitleKind } from "../downloads.ts";

const coverFrom = (base) => swapDocumentTitleKind(base, "coverLetter");

let failures = 0;
function check(name, actual, expected) {
  const got = String(actual);
  const want = String(expected);
  const ok = got === want;
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n       got: ${got}\n      want: ${want}`}`);
}

// --- kind swap: separator style is inherited from the name it rewrites -------
check("underscore title swaps kind", swapDocumentTitleKind("Xinyi_Lin_Stripe_Resume", "coverLetter"), "Xinyi_Lin_Stripe_Cover_Letter");
check("spaced name gains spaced kind", swapDocumentTitleKind("Stripe SWE", "coverLetter"), "Stripe SWE Cover Letter");
check("hyphen-separated kind is replaced", swapDocumentTitleKind("Xinyi Lin - Resume", "coverLetter"), "Xinyi Lin - Cover Letter");
check("dot-separated kind is replaced", swapDocumentTitleKind("Jane.Doe.Resume", "coverLetter"), "Jane.Doe.Cover.Letter");
check("bare kind becomes the bare other kind", swapDocumentTitleKind("Resume", "coverLetter"), "Cover Letter");
check("lowercase kind still matches", swapDocumentTitleKind("stripe_resume", "coverLetter"), "stripe_Cover_Letter");
check("empty stays empty", swapDocumentTitleKind("", "coverLetter"), "");
check("whitespace-only stays empty", swapDocumentTitleKind("   ", "coverLetter"), "");

// Idempotent, and reversible — a second swap must not stack another suffix.
check("swap is idempotent", swapDocumentTitleKind("Xinyi_Lin_Stripe_Cover_Letter", "coverLetter"), "Xinyi_Lin_Stripe_Cover_Letter");
check("dot swap is idempotent", swapDocumentTitleKind("Jane.Doe.Cover.Letter", "coverLetter"), "Jane.Doe.Cover.Letter");
check(
  "swap round-trips back to resume",
  swapDocumentTitleKind(swapDocumentTitleKind("Xinyi_Lin_Stripe_Resume", "coverLetter"), "resume"),
  "Xinyi_Lin_Stripe_Resume"
);
check(
  "dot swap round-trips back to resume",
  swapDocumentTitleKind(swapDocumentTitleKind("Jane.Doe.Resume", "coverLetter"), "resume"),
  "Jane.Doe.Resume"
);

// --- the regression this pair exists to prevent -----------------------------
// The dialog pre-fills with the resume's auto-title, which ALREADY ends in the
// resume kind. Appending a cover-letter suffix to it shipped a letter named
// "..._Resume — Cover Letter.pdf".
const defaultBase = buildResumeDocumentTitle("Xinyi Lin", "Stripe");
check("realistic default base", defaultBase, "Xinyi_Lin_Stripe_Resume");
check("cover letter retargets the kind", coverFrom(defaultBase), "Xinyi_Lin_Stripe_Cover_Letter");
check("cover-letter name never claims to be a resume", /resume/i.test(coverFrom(defaultBase)), false);
check("the two names never collide", coverFrom(defaultBase) === defaultBase, false);

// --- user-typed names -------------------------------------------------------
check("typed name gains the kind", coverFrom("Stripe SWE"), "Stripe SWE Cover Letter");

// An empty base is the dialog's signal to fall back to the resume's own name,
// so the swap must stay empty rather than returning a bare "Cover Letter" that
// would silently name an unrelated-looking file.
check("empty base yields no derived cover name", coverFrom(""), "");

if (failures > 0) {
  console.log(`\n${failures} case(s) failed`);
  process.exit(1);
}
console.log("\nAll apply-download-name probes passed");
