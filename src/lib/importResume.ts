import { arrayBufferToBase64 } from "./downloads";

// File → plain text. Text/Markdown/LaTeX are read in the browser (LaTeX is
// detected and unwrapped downstream by parseResumeData); DOCX must be unzipped +
// parsed server-side, so it round-trips through /api/import-resume-docx.
export async function fileToText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".docx")) {
    const docxBase64 = arrayBufferToBase64(await file.arrayBuffer());
    let response: Response;
    try {
      response = await fetch("/api/import-resume-docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docxBase64 })
      });
    } catch {
      throw new Error("DOCX import requires the local server. Use a .txt, .md, or .tex file instead, or paste the text.");
    }
    let data: any;
    try {
      data = JSON.parse(await response.text());
    } catch {
      throw new Error(response.ok ? "Server returned non-JSON response." : `DOCX import failed (${response.status}).`);
    }
    if (!response.ok) throw new Error(data.error ?? "DOCX import failed.");
    return String(data.text ?? "");
  }
  if (name.endsWith(".doc")) {
    throw new Error("Legacy .doc isn’t supported — save it as .docx, or paste the text instead.");
  }
  // .txt / .md / .tex / anything else readable as text.
  return await file.text();
}
