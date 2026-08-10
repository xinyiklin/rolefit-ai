// Where the document currently in the editor came from. Only `starter` is
// sample content that must never be mistaken for the applicant's own resume.
export const RESUME_ORIGINS = [
  "saved",
  "uploaded",
  "application",
  "starter",
  "blank",
  "authored"
] as const;

export type ResumeOrigin = (typeof RESUME_ORIGINS)[number];

export function isResumeOrigin(value: unknown): value is ResumeOrigin {
  return typeof value === "string"
    && RESUME_ORIGINS.includes(value as ResumeOrigin);
}
