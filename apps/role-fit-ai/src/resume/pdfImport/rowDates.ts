// Dates: the values a resume sets beside an entry's title or subtitle, at the
// right margin or a tab stop, alone or with a place or duration.

const DATE_WORD_RE =
  /^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|present|current|now|today|expected|summer|fall|autumn|spring|winter|to|since)\.?$/i;

export function isDateLike(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 40) return false;
  if (!/\b(?:19|20)\d{2}\b|\bpresent\b|\bcurrent\b/i.test(trimmed)) return false;
  return trimmed
    .split(/[\s,–—\-/()]+/)
    .filter(Boolean)
    .every((word) => /^\d{1,4}\.?$/.test(word) || /^'\d{2}$/.test(word) || DATE_WORD_RE.test(word));
}

// "Jan 2019 – Present · Boston, MA", "06/2019 – Present (4 yrs)".
export function hasDate(text: string): boolean {
  return text.split(/\s*[·|•,()]\s*/u).some(isDateLike);
}
