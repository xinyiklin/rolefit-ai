import { useCallback, useEffect, useState } from "react";

import type { DocStyle } from "./useDocStyle";
import type { ResumeTemplateSchema } from "../lib/resumeData";

async function safeJson(response: Response): Promise<any> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(response.ok ? "Server returned non-JSON response." : `Request failed (${response.status}).`);
  }
}

export type Template = {
  id: string;
  name: string;
  description: string;
  source: string;
};

export type TectonicStatus = {
  available: boolean;
  version: string | null;
};

export type RenderPdfResult = { pdf: Blob } | { error: string; missingTectonic?: boolean };

export function useTemplates() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("jakes");
  const [tectonic, setTectonic] = useState<TectonicStatus>({ available: false, version: null });
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true);
  const [templatesError, setTemplatesError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch("/api/templates");
        const data = await safeJson(response);
        if (cancelled) return;
        if (!response.ok) throw new Error(data.error ?? "Failed to load LaTeX templates.");
        const list = Array.isArray(data.templates) ? (data.templates as Template[]) : [];
        setTemplates(list);
        if (typeof data.defaultTemplateId === "string" && list.some((t) => t.id === data.defaultTemplateId)) {
          setSelectedTemplateId(data.defaultTemplateId);
        } else if (list[0]) {
          setSelectedTemplateId(list[0].id);
        }
        if (data.tectonic && typeof data.tectonic === "object") {
          setTectonic({
            available: Boolean(data.tectonic.available),
            version: typeof data.tectonic.version === "string" ? data.tectonic.version : null
          });
        }
      } catch (error) {
        if (!cancelled) {
          // Static deploy (GitHub Pages) or no server — the fetch either fails
          // outright (TypeError) or succeeds with a non-JSON HTML page. Either
          // way, degrade silently: leave templates empty and tectonic unavailable;
          // the editor still works, LaTeX export buttons just stay disabled.
          const isNoServer = error instanceof TypeError
            || (error instanceof Error && /non-JSON|Request failed/.test(error.message));
          if (!isNoServer) {
            setTemplatesError(error instanceof Error ? error.message : "Failed to load LaTeX templates.");
          }
        }
      } finally {
        if (!cancelled) setIsLoadingTemplates(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const renderTex = useCallback(
    async (resumeText: string, templateId?: string, options?: { rawTex?: boolean; docStyle?: DocStyle }): Promise<string> => {
      const response = await fetch("/api/render-resume-latex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resumeText,
          templateId: templateId ?? selectedTemplateId,
          wantsPdf: false,
          rawTex: options?.rawTex ?? false,
          docStyle: options?.docStyle
        })
      });
      const data = await safeJson(response);
      if (!response.ok) throw new Error(data.error ?? "LaTeX render failed.");
      return String(data.tex ?? "");
    },
    [selectedTemplateId]
  );

  const renderPdf = useCallback(
    async (resumeText: string, templateId?: string, options?: { rawTex?: boolean; docStyle?: DocStyle }): Promise<RenderPdfResult> => {
      const response = await fetch("/api/render-resume-latex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resumeText,
          templateId: templateId ?? selectedTemplateId,
          wantsPdf: true,
          rawTex: options?.rawTex ?? false,
          docStyle: options?.docStyle
        })
      });
      const data = await safeJson(response);
      if (!response.ok) {
        return { error: data.error ?? "LaTeX PDF render failed." };
      }
      if (data.pdfError) {
        return {
          error: data.pdfError.message ?? "PDF compile failed.",
          missingTectonic: data.pdfError.code === "TECTONIC_MISSING"
        };
      }
      if (!data.pdfBase64) {
        return { error: "No PDF returned." };
      }
      const bytes = Uint8Array.from(atob(String(data.pdfBase64)), (c) => c.charCodeAt(0));
      return { pdf: new Blob([bytes], { type: "application/pdf" }) };
    },
    [selectedTemplateId]
  );

  // Compile Preview: render straight from the structured editor schema, so the
  // PDF reflects exactly what the editor holds (no plain-text round trip).
  const renderPdfFromSchema = useCallback(
    async (schema: ResumeTemplateSchema, templateId?: string, options?: { docStyle?: DocStyle }): Promise<RenderPdfResult> => {
      const response = await fetch("/api/render-resume-latex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resume: schema,
          templateId: templateId ?? selectedTemplateId,
          wantsPdf: true,
          docStyle: options?.docStyle
        })
      });
      const data = await safeJson(response);
      if (!response.ok) {
        return { error: data.error ?? "LaTeX PDF render failed." };
      }
      if (data.pdfError) {
        return {
          error: data.pdfError.message ?? "PDF compile failed.",
          missingTectonic: data.pdfError.code === "TECTONIC_MISSING"
        };
      }
      if (!data.pdfBase64) {
        return { error: "No PDF returned." };
      }
      const bytes = Uint8Array.from(atob(String(data.pdfBase64)), (c) => c.charCodeAt(0));
      return { pdf: new Blob([bytes], { type: "application/pdf" }) };
    },
    [selectedTemplateId]
  );

  const renderTexFromSchema = useCallback(
    async (schema: ResumeTemplateSchema, templateId?: string, options?: { docStyle?: DocStyle }): Promise<string> => {
      const response = await fetch("/api/render-resume-latex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resume: schema,
          templateId: templateId ?? selectedTemplateId,
          wantsPdf: false,
          docStyle: options?.docStyle
        })
      });
      const data = await safeJson(response);
      if (!response.ok) throw new Error(data.error ?? "LaTeX render failed.");
      return String(data.tex ?? "");
    },
    [selectedTemplateId]
  );

  const importTex = useCallback(async (texSource: string): Promise<string> => {
    const response = await fetch("/api/import-resume-tex", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tex: texSource })
    });
    const data = await safeJson(response);
    if (!response.ok) throw new Error(data.error ?? "LaTeX import failed.");
    return String(data.text ?? "");
  }, []);

  return {
    templates,
    selectedTemplateId,
    setSelectedTemplateId,
    tectonic,
    isLoadingTemplates,
    templatesError,
    renderTex,
    renderPdf,
    renderPdfFromSchema,
    renderTexFromSchema,
    importTex
  };
}
