/// <reference lib="es2022.intl" />
export function evidenceSegments(value: string): string[] {
  return [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(value)]
    .flatMap(({ segment }) =>
      segment.split(/[\r\n;]+|\s+but\s+|,\s*(?=not\b|never\b)|\s+and\s+(?=not\b|never\b)/i)
    )
    .map((text) => text.trim())
    .filter(Boolean);
}

export function evidencePolarity(segment: string): "affirmative" | "denied" | "aspirational" {
  const text = segment.replace(/\bnot only\b/gi, "");
  if (
    /\b(?:no (?:[\w+-]+\s+){0,4}experience|without experience|(?:never|not) (?:used|use|worked|built|developed|learned|experienced|familiar|proficient|skilled)|(?:have|has)(?:\s+not|n't) (?:used|worked|built|developed)|(?:do|did)(?:\s+not|n't) (?:use|work|build|develop)|lack(?:s|ing)? (?:experience|knowledge|skills?)|unfamiliar with)\b/i.test(
      text
    ) ||
    /^(?:no|not|never)\b/i.test(text.trim())
  )
    return "denied";
  if (
    /\b(?:interested in|want to|hope to|plan to|would like to|(?:am|is|are|currently|started|still) learning|^learning|would (?:use|build|work|learn)|could (?:use|build|work|learn)|learning goals?|aspir(?:e|ing)|intend to)\b/i.test(
      text
    )
  )
    return "aspirational";
  return "affirmative";
}
