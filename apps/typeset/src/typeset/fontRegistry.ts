import {
  FONT_METRICS,
  type FaceMetrics,
  type FaceName
} from "./metrics.gen.ts";
import type { FontFamily } from "../lib/documentStyle.ts";

// The engine-facing name for the one document font-family union owned by
// lib/documentStyle.ts (the persisted contract).
export type DocumentFontFamily = FontFamily;

export const DEFAULT_DOCUMENT_FONT_FAMILY: DocumentFontFamily = "latin-modern";

// Defensive coercion for style values that reach the renderers: persisted
// input is already validated (coerceDocStyle / the .resume codec), so this
// only guards against programmatic misuse.
export function documentFontFamily(value: string | undefined): DocumentFontFamily {
  return value === "source-serif" || value === "source-sans" ? value : DEFAULT_DOCUMENT_FONT_FAMILY;
}

export type DocumentFontFaceDefinition = Readonly<{
  assetPath: `/fonts/${string}.woff2`;
  cssFamily: string;
  weight: 400 | 700;
  italic: boolean;
  metrics: FaceMetrics;
}>;

export type DocumentFontFamilyDefinition = Readonly<{
  id: DocumentFontFamily;
  label: string;
  cssFamily: string;
  faces: Readonly<Record<FaceName, DocumentFontFaceDefinition>>;
}>;

export const DOCUMENT_FONT_FAMILIES = {
  "latin-modern": {
    id: "latin-modern",
    label: "Latin Modern",
    cssFamily: "Typeset Latin Modern",
    faces: {
      regular: {
        assetPath: "/fonts/LMRoman10-Regular.woff2",
        cssFamily: "Typeset LM Roman 10 Regular",
        weight: 400,
        italic: false,
        metrics: FONT_METRICS["latin-modern"].regular
      },
      bold: {
        assetPath: "/fonts/LMRoman10-Bold.woff2",
        cssFamily: "Typeset LM Roman 10 Bold",
        weight: 700,
        italic: false,
        metrics: FONT_METRICS["latin-modern"].bold
      },
      italic: {
        assetPath: "/fonts/LMRoman10-Italic.woff2",
        cssFamily: "Typeset LM Roman 10 Italic",
        weight: 400,
        italic: true,
        metrics: FONT_METRICS["latin-modern"].italic
      },
      boldItalic: {
        assetPath: "/fonts/LMRoman10-BoldItalic.woff2",
        cssFamily: "Typeset LM Roman 10 Bold Italic",
        weight: 700,
        italic: true,
        metrics: FONT_METRICS["latin-modern"].boldItalic
      },
      boldDisplay: {
        assetPath: "/fonts/LMRoman12-Bold.woff2",
        cssFamily: "Typeset LM Roman 12 Bold Display",
        weight: 700,
        italic: false,
        metrics: FONT_METRICS["latin-modern"].boldDisplay
      },
      caps: {
        assetPath: "/fonts/LMRomanCaps10-Regular.woff2",
        cssFamily: "Typeset LM Roman Caps 10",
        weight: 400,
        italic: false,
        metrics: FONT_METRICS["latin-modern"].caps
      }
    }
  },
  "source-serif": {
    id: "source-serif",
    label: "Source Serif 4",
    cssFamily: "Typeset Source Serif 4",
    faces: {
      regular: {
        assetPath: "/fonts/SourceSerif4-Regular.woff2",
        cssFamily: "Typeset Source Serif 4 Regular",
        weight: 400,
        italic: false,
        metrics: FONT_METRICS["source-serif"].regular
      },
      bold: {
        assetPath: "/fonts/SourceSerif4-Bold.woff2",
        cssFamily: "Typeset Source Serif 4 Bold",
        weight: 700,
        italic: false,
        metrics: FONT_METRICS["source-serif"].bold
      },
      italic: {
        assetPath: "/fonts/SourceSerif4-Italic.woff2",
        cssFamily: "Typeset Source Serif 4 Italic",
        weight: 400,
        italic: true,
        metrics: FONT_METRICS["source-serif"].italic
      },
      boldItalic: {
        assetPath: "/fonts/SourceSerif4-BoldItalic.woff2",
        cssFamily: "Typeset Source Serif 4 Bold Italic",
        weight: 700,
        italic: true,
        metrics: FONT_METRICS["source-serif"].boldItalic
      },
      boldDisplay: {
        assetPath: "/fonts/SourceSerif4-BoldDisplay.woff2",
        cssFamily: "Typeset Source Serif 4 Bold Display",
        weight: 700,
        italic: false,
        metrics: FONT_METRICS["source-serif"].boldDisplay
      },
      caps: {
        assetPath: "/fonts/SourceSerif4-Caps.woff2",
        cssFamily: "Typeset Source Serif 4 Caps",
        weight: 400,
        italic: false,
        metrics: FONT_METRICS["source-serif"].caps
      }
    }
  },
  "source-sans": {
    id: "source-sans",
    label: "Source Sans 3",
    cssFamily: "Typeset Source Sans 3",
    faces: {
      regular: {
        assetPath: "/fonts/SourceSans3-Regular.woff2",
        cssFamily: "Typeset Source Sans 3 Regular",
        weight: 400,
        italic: false,
        metrics: FONT_METRICS["source-sans"].regular
      },
      bold: {
        assetPath: "/fonts/SourceSans3-Bold.woff2",
        cssFamily: "Typeset Source Sans 3 Bold",
        weight: 700,
        italic: false,
        metrics: FONT_METRICS["source-sans"].bold
      },
      italic: {
        assetPath: "/fonts/SourceSans3-Italic.woff2",
        cssFamily: "Typeset Source Sans 3 Italic",
        weight: 400,
        italic: true,
        metrics: FONT_METRICS["source-sans"].italic
      },
      boldItalic: {
        assetPath: "/fonts/SourceSans3-BoldItalic.woff2",
        cssFamily: "Typeset Source Sans 3 Bold Italic",
        weight: 700,
        italic: true,
        metrics: FONT_METRICS["source-sans"].boldItalic
      },
      boldDisplay: {
        assetPath: "/fonts/SourceSans3-BoldDisplay.woff2",
        cssFamily: "Typeset Source Sans 3 Bold Display",
        weight: 700,
        italic: false,
        metrics: FONT_METRICS["source-sans"].boldDisplay
      },
      caps: {
        assetPath: "/fonts/SourceSans3-Caps.woff2",
        cssFamily: "Typeset Source Sans 3 Caps",
        weight: 400,
        italic: false,
        metrics: FONT_METRICS["source-sans"].caps
      }
    }
  }
} as const satisfies Readonly<Record<DocumentFontFamily, DocumentFontFamilyDefinition>>;

export function fontFace(family: DocumentFontFamily, face: FaceName): DocumentFontFaceDefinition {
  return DOCUMENT_FONT_FAMILIES[family].faces[face];
}
