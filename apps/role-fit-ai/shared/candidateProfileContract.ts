// The Profile Background is sent whole or not at all: every AI stage that uses
// candidate context declines above this limit instead of cutting the text.
export const PROFILE_BACKGROUND_CHAR_LIMIT = 12_000;
// Upper bound for the declared-facts block prepended to the Background.
export const CANDIDATE_FACTS_CONTEXT_MAX_LENGTH = 1_000;
export const CANDIDATE_CONTEXT_CHAR_LIMIT = PROFILE_BACKGROUND_CHAR_LIMIT + CANDIDATE_FACTS_CONTEXT_MAX_LENGTH;

export const PROFILE_BACKGROUND_LIMIT_MESSAGE =
  "Your Profile Background is over 12,000 characters. Shorten it in Settings > Profile.";

// Fit measures NFKC-normalized text and the other stages send raw text, so the
// limit applies to whichever is longer.
export function profileTextLength(text: string): number {
  return Math.max(text.length, text.normalize("NFKC").length);
}

export function profileBackgroundLimitError(background: string): string | null {
  return profileTextLength(background) > PROFILE_BACKGROUND_CHAR_LIMIT ? PROFILE_BACKGROUND_LIMIT_MESSAGE : null;
}

// Server-side bound on the merged facts + Background string.
export function candidateContextLimitError(context: string): string | null {
  return profileTextLength(context) > CANDIDATE_CONTEXT_CHAR_LIMIT ? PROFILE_BACKGROUND_LIMIT_MESSAGE : null;
}
