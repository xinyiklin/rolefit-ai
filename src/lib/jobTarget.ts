export function inferApplicationTitle(url: string, jobDescription: string) {
  try {
    if (url) {
      const u = new URL(url);
      return u.hostname.replace(/^www\./, "") + (u.pathname && u.pathname !== "/" ? u.pathname.slice(0, 30) : "");
    }
  } catch {
    // fall through
  }
  const firstLine = jobDescription
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 6);
  if (firstLine) return firstLine.slice(0, 80);
  return "Untitled role";
}

export function inferCompanyFromUrl(url: string) {
  try {
    if (!url) return "";
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const cleaned = host
      .replace(/^(jobs|careers|apply|hire|boards|workday|smartrecruiters|lever|greenhouse)\./, "")
      .replace(/\.(com|io|co|net|ai|app|dev|org)$/, "");
    const first = cleaned.split(".")[0];
    return first ? first.charAt(0).toUpperCase() + first.slice(1) : "";
  } catch {
    return "";
  }
}
