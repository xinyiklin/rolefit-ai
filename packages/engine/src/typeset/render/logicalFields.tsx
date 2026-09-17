import { Fragment, useLayoutEffect, useMemo, useRef } from "react";
import { PAGE_HEIGHT_BP, PAGE_WIDTH_BP } from "../blocks.ts";
import { fontFace, type DocumentFontFamily } from "../fontRegistry.ts";
import type { FaceName } from "../metrics.gen.ts";
import type { LayoutDocument } from "../layout.ts";
import { fieldKey } from "../types.ts";
import { groupRuns, type Segment } from "./segments.ts";

type FragmentRun = Segment & { page: number; line: string };
type Props = {
  doc: LayoutDocument;
  variant: "screen" | "print";
  zoom: number;
  unit: (value: number) => string;
  faceBox: (family: DocumentFontFamily, face: FaceName) => { ascent: number; descent: number };
  highlightFieldKey?: string | null;
};
const baselineMarker = () => {
  const marker = document.createElement("span");
  Object.assign(marker.style, { display: "inline-block", width: "0", height: "0", verticalAlign: "baseline" });
  return marker;
};
const blockAscents = new Map<string, number>();
function blockAscent(element: HTMLElement): number {
  const { fontFamily, fontSize, fontWeight, fontStyle, lineHeight } = element.style;
  const key = [fontFamily, fontSize, fontWeight, fontStyle, lineHeight].join("|");
  const cached = blockAscents.get(key);
  if (cached !== undefined) return cached;
  const probe = document.createElement("span"), marker = baselineMarker();
  probe.setAttribute("aria-hidden", "true");
  Object.assign(probe.style, { position: "absolute", left: "-100000px", top: "0", whiteSpace: "pre", fontFamily, fontSize, fontWeight, fontStyle, lineHeight });
  probe.append(document.createTextNode("Mg"), marker);
  document.body.append(probe);
  const ascent = marker.getBoundingClientRect().top - probe.getBoundingClientRect().top;
  probe.remove();
  blockAscents.set(key, ascent);
  return ascent;
}

// Logical inline flow keeps native search/selection intact; relative offsets
// place its fragments on the engine's physical pages without reflowing text.
export function LogicalFields({ doc, variant, zoom, unit, faceBox, highlightFieldKey }: Props) {
  const layerRef = useRef<HTMLDivElement>(null);
  const fields = useMemo(() => {
    const groups = new Map<string, FragmentRun[]>();
    doc.pages.forEach((page, pi) => page.lines.forEach((line, li) => {
      for (const seg of groupRuns(line.runs)) {
        if (!seg.src || seg.marker) continue;
        const key = fieldKey(seg.src);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push({ ...seg, page: pi, line: `${pi}-${li}` });
      }
    }));
    return Array.from(groups, ([key, runs]) => ({ key, runs }));
  }, [doc]);

  useLayoutEffect(() => {
    const layer = layerRef.current;
    const host = layer?.parentElement;
    if (!layer || !host) return;
    const scale = variant === "print" ? 4 / 3 : zoom;
    const origin = host.getBoundingClientRect();
    const pages = Array.from(host.querySelectorAll<HTMLElement>(".tsd-page"));
    const rows = new Map<string, { top: number; ascent: number }>();
    doc.pages.forEach((page, pi) => page.lines.forEach((line, li) => {
      rows.set(`${pi}-${li}`, { top: Math.min(...line.runs.map(run => line.baseline - faceBox(run.style.family, run.style.face).ascent * run.style.size)) * scale, ascent: 0 });
    }));
    const measured = fields.map((field, index) => {
      const group = layer.children[index] as HTMLElement;
      const measuring = document.createElement("div");
      measuring.setAttribute("aria-hidden", "true");
      Object.assign(measuring.style, { position: "absolute", left: "-100000px", top: "0", width: unit(PAGE_WIDTH_BP) });
      const clone = group.cloneNode(true) as HTMLElement;
      const fragments = Array.from(clone.querySelectorAll<HTMLElement>("[data-tsdf]"));
      for (const fragment of fragments) { fragment.style.left = "0px"; fragment.style.top = "0px"; }
      measuring.append(clone);
      document.body.append(measuring);
      const probeOrigin = measuring.getBoundingClientRect();
      const offsets = fragments.map(element => {
        const x = element.getBoundingClientRect().left - probeOrigin.left;
        const marker = baselineMarker();
        element.append(marker);
        const baseline = marker.getBoundingClientRect().top - probeOrigin.top;
        marker.remove();
        return { x, baseline, blockAscent: blockAscent(element) };
      });
      measuring.remove();
      const painted = group.querySelectorAll<HTMLElement>("[data-tsdf]");
      field.runs.forEach((run, ri) => {
        const row = rows.get(run.line)!;
        row.ascent = Math.max(row.ascent, offsets[ri].blockAscent);
      });
      return { field, painted, offsets };
    });
    const decorations = Array.from(host.querySelectorAll<HTMLElement>("[data-tsd-decoration]"));
    for (const element of decorations) {
      const row = rows.get(element.parentElement!.getAttribute("data-tsd-line-box")!)!;
      row.ascent = Math.max(row.ascent, blockAscent(element));
    }
    // Preserve the former inline row's common CSS baseline across mixed fonts
    // and marker sizes, while the text itself follows logical field order.
    measured.forEach(({ field, painted, offsets }) => {
      field.runs.forEach((run, ri) => {
        const element = painted[ri], offset = offsets[ri];
        const page = pages[run.page];
        const rect = page.getBoundingClientRect();
        const pageX = variant === "print" ? 0 : rect.left - origin.left + page.clientLeft;
        const pageY = variant === "print" ? run.page * PAGE_HEIGHT_BP * scale : rect.top - origin.top + page.clientTop;
        element.style.left = `${pageX + run.x * scale - offset.x}px`;
        const row = rows.get(run.line)!;
        element.style.top = `${pageY + row.top + row.ascent - offset.baseline}px`;
      });
    });
    for (const element of decorations) {
      const row = rows.get(element.parentElement!.getAttribute("data-tsd-line-box")!)!;
      element.style.top = `${row.ascent - blockAscent(element)}px`;
    }
  }, [doc, fields, variant, zoom, unit, faceBox]);

  return <div ref={layerRef} className="tsd-text-layer" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
    {fields.map(field => <div key={field.key} data-tsd-field={field.key} style={{ position: "relative", height: 0, whiteSpace: "pre", fontSize: 0, lineHeight: 0 }}>
      {field.runs.map((run, index) => {
        const box = faceBox(run.family, run.face), font = fontFace(run.family, run.face);
        const Tag = run.href ? "a" : "span";
        const fraction = Math.min(1, Math.max(0, (run.x - doc.geometry.marginLeft) / doc.geometry.textWidth));
        const style = {
          position: "relative", display: "inline", unicodeBidi: "isolate", verticalAlign: "baseline", pointerEvents: "auto",
          fontFamily: `"${font.cssFamily}"`, fontWeight: font.weight, fontStyle: font.italic ? "italic" : "normal",
          fontSize: unit(run.size), lineHeight: unit((box.ascent + box.descent) * run.size),
          whiteSpace: "pre", letterSpacing: unit(run.tracking), wordSpacing: unit(run.wordSpacing), color: "#000", textDecoration: "none",
          ...(!run.text ? { "--tsd-empty-hint-shift": `-${Math.round(fraction * 10000) / 100}%` } : {})
        } as React.CSSProperties;
        return <Fragment key={index}>
          <Tag data-tsdf={field.key} data-tsd-page={run.page} data-tsd-line={run.line} data-tsde={run.text ? undefined : "1"}
            className={field.key === highlightFieldKey ? "tsd-run--highlighted" : undefined}
            {...(run.href ? { href: run.href, target: "_blank", rel: "noreferrer" } : {})} style={style}>
            {run.text || "\uFEFF"}
          </Tag>
          {run.breakAfter ? <span data-tsds="1" data-tsd-owner={field.key} data-tsd-line={run.line} contentEditable={false}>{run.breakAfter}</span> : null}
        </Fragment>;
      })}
    </div>)}
  </div>;
}
