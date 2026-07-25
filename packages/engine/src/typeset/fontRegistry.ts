import {
  FONT_METRICS,
  type FaceMetrics,
  type FaceName
} from "./metrics.gen.ts";
import { coerceFontFamily, DEFAULT_FONT_FAMILY, type FontFamily } from "../lib/fontFamilies.ts";

// The engine-facing name for the one document font-family union owned by
// lib/fontFamilies.ts (the persisted contract).
export type DocumentFontFamily = FontFamily;

export const DEFAULT_DOCUMENT_FONT_FAMILY: DocumentFontFamily = DEFAULT_FONT_FAMILY;

// Defensive coercion for style values that reach the renderers: persisted
// input is already validated (coerceDocStyle / the .resume codec), so this
// only guards against programmatic misuse.
export function documentFontFamily(value: string | undefined): DocumentFontFamily {
  return coerceFontFamily(value);
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
  // Outline flavour of the family's PDF-embeddable siblings. The browser reads
  // the woff2 assets, but a woff2 byte stream is not a valid PDF font program,
  // so scripts/generate_pdf_fonts.py writes a decompressed sfnt beside each one —
  // `.otf` for CFF outlines, `.ttf` for TrueType. Declared per family, next to
  // the assets it describes, because a wrong guess makes the PDF export fetch a
  // filename that was never written.
  sfntExtension: "otf" | "ttf";
  faces: Readonly<Record<FaceName, DocumentFontFaceDefinition>>;
}>;

// A face as declared here: the shipped asset stem plus the CSS weight/slope the
// DOM painter asks for. `metrics` and `assetPath` are DERIVED, never written per
// face — pointing a face at another face's metrics is a silent bug (text paints
// at widths the engine never measured) that repetition invites and derivation
// makes impossible.
type FaceAsset = Readonly<{
  file: string;
  cssFamily: string;
  weight: 400 | 700;
  italic?: true;
}>;

function familyDefinition(
  id: DocumentFontFamily,
  label: string,
  cssFamily: string,
  sfntExtension: "otf" | "ttf",
  assets: Readonly<Record<FaceName, FaceAsset>>
): DocumentFontFamilyDefinition {
  const faces = {} as Record<FaceName, DocumentFontFaceDefinition>;
  for (const face of Object.keys(assets) as FaceName[]) {
    const asset = assets[face];
    faces[face] = {
      assetPath: `/fonts/${asset.file}.woff2`,
      cssFamily: asset.cssFamily,
      weight: asset.weight,
      italic: asset.italic === true,
      metrics: FONT_METRICS[id][face]
    };
  }
  return { id, label, cssFamily, sfntExtension, faces };
}

// Filename of a face's PDF-embeddable sfnt sibling, relative to the fonts
// directory. The single resolver for the woff2 -> sfnt rename: the PDF emitter
// fetches this name and the parity eval reads it off disk, so neither can drift
// from what generate_pdf_fonts.py actually wrote.
export function sfntAssetFile(family: DocumentFontFamily, face: FaceName): string {
  const definition = DOCUMENT_FONT_FAMILIES[family];
  return definition.faces[face].assetPath
    .replace(/^\/fonts\//, "")
    .replace(/\.woff2$/i, `.${definition.sfntExtension}`);
}

// Latin Modern and the Source families ship a distinct bold optical size for the
// display role (LM Roman 12, Source's `opsz: 24` instance). The metric-compatible
// families are single-design statics with no optical axis, so their display bold
// IS their text bold and both faces point at one asset — mirroring FACE_ALIASES
// in scripts/generate_font_assets.py, which gives them one metrics record too.
const TINOS_BOLD: FaceAsset = { file: "Tinos-Bold", cssFamily: "Typeset Tinos Bold", weight: 700 };
const ARIMO_BOLD: FaceAsset = { file: "Arimo-Bold", cssFamily: "Typeset Arimo Bold", weight: 700 };
const CARLITO_BOLD: FaceAsset = { file: "Carlito-Bold", cssFamily: "Typeset Carlito Bold", weight: 700 };

export const DOCUMENT_FONT_FAMILIES: Readonly<
  Record<DocumentFontFamily, DocumentFontFamilyDefinition>
> = {
  "latin-modern": familyDefinition("latin-modern", "Latin Modern", "Typeset Latin Modern", "otf", {
    regular: { file: "LMRoman10-Regular", cssFamily: "Typeset LM Roman 10 Regular", weight: 400 },
    bold: { file: "LMRoman10-Bold", cssFamily: "Typeset LM Roman 10 Bold", weight: 700 },
    italic: { file: "LMRoman10-Italic", cssFamily: "Typeset LM Roman 10 Italic", weight: 400, italic: true },
    boldItalic: {
      file: "LMRoman10-BoldItalic",
      cssFamily: "Typeset LM Roman 10 Bold Italic",
      weight: 700,
      italic: true
    },
    boldDisplay: { file: "LMRoman12-Bold", cssFamily: "Typeset LM Roman 12 Bold Display", weight: 700 },
    caps: { file: "LMRomanCaps10-Regular", cssFamily: "Typeset LM Roman Caps 10", weight: 400 }
  }),
  "source-serif": familyDefinition("source-serif", "Source Serif 4", "Typeset Source Serif 4", "ttf", {
    regular: { file: "SourceSerif4-Regular", cssFamily: "Typeset Source Serif 4 Regular", weight: 400 },
    bold: { file: "SourceSerif4-Bold", cssFamily: "Typeset Source Serif 4 Bold", weight: 700 },
    italic: {
      file: "SourceSerif4-Italic",
      cssFamily: "Typeset Source Serif 4 Italic",
      weight: 400,
      italic: true
    },
    boldItalic: {
      file: "SourceSerif4-BoldItalic",
      cssFamily: "Typeset Source Serif 4 Bold Italic",
      weight: 700,
      italic: true
    },
    boldDisplay: {
      file: "SourceSerif4-BoldDisplay",
      cssFamily: "Typeset Source Serif 4 Bold Display",
      weight: 700
    },
    caps: { file: "SourceSerif4-Caps", cssFamily: "Typeset Source Serif 4 Caps", weight: 400 }
  }),
  "source-sans": familyDefinition("source-sans", "Source Sans 3", "Typeset Source Sans 3", "ttf", {
    regular: { file: "SourceSans3-Regular", cssFamily: "Typeset Source Sans 3 Regular", weight: 400 },
    bold: { file: "SourceSans3-Bold", cssFamily: "Typeset Source Sans 3 Bold", weight: 700 },
    italic: {
      file: "SourceSans3-Italic",
      cssFamily: "Typeset Source Sans 3 Italic",
      weight: 400,
      italic: true
    },
    boldItalic: {
      file: "SourceSans3-BoldItalic",
      cssFamily: "Typeset Source Sans 3 Bold Italic",
      weight: 700,
      italic: true
    },
    boldDisplay: {
      file: "SourceSans3-BoldDisplay",
      cssFamily: "Typeset Source Sans 3 Bold Display",
      weight: 700
    },
    caps: { file: "SourceSans3-Caps", cssFamily: "Typeset Source Sans 3 Caps", weight: 400 }
  }),
  tinos: familyDefinition("tinos", "Tinos", "Typeset Tinos", "ttf", {
    regular: { file: "Tinos-Regular", cssFamily: "Typeset Tinos Regular", weight: 400 },
    bold: TINOS_BOLD,
    italic: { file: "Tinos-Italic", cssFamily: "Typeset Tinos Italic", weight: 400, italic: true },
    boldItalic: {
      file: "Tinos-BoldItalic",
      cssFamily: "Typeset Tinos Bold Italic",
      weight: 700,
      italic: true
    },
    boldDisplay: TINOS_BOLD,
    caps: { file: "Tinos-Caps", cssFamily: "Typeset Tinos Caps", weight: 400 }
  }),
  arimo: familyDefinition("arimo", "Arimo", "Typeset Arimo", "ttf", {
    regular: { file: "Arimo-Regular", cssFamily: "Typeset Arimo Regular", weight: 400 },
    bold: ARIMO_BOLD,
    italic: { file: "Arimo-Italic", cssFamily: "Typeset Arimo Italic", weight: 400, italic: true },
    boldItalic: {
      file: "Arimo-BoldItalic",
      cssFamily: "Typeset Arimo Bold Italic",
      weight: 700,
      italic: true
    },
    boldDisplay: ARIMO_BOLD,
    caps: { file: "Arimo-Caps", cssFamily: "Typeset Arimo Caps", weight: 400 }
  }),
  carlito: familyDefinition("carlito", "Carlito", "Typeset Carlito", "ttf", {
    regular: { file: "Carlito-Regular", cssFamily: "Typeset Carlito Regular", weight: 400 },
    bold: CARLITO_BOLD,
    italic: { file: "Carlito-Italic", cssFamily: "Typeset Carlito Italic", weight: 400, italic: true },
    boldItalic: {
      file: "Carlito-BoldItalic",
      cssFamily: "Typeset Carlito Bold Italic",
      weight: 700,
      italic: true
    },
    boldDisplay: CARLITO_BOLD,
    caps: { file: "Carlito-Caps", cssFamily: "Typeset Carlito Caps", weight: 400 }
  })
};

export function fontFace(family: DocumentFontFamily, face: FaceName): DocumentFontFaceDefinition {
  return DOCUMENT_FONT_FAMILIES[family].faces[face];
}
