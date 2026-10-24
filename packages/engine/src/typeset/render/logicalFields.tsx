import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PAGE_HEIGHT_BP, PAGE_WIDTH_BP } from "../blocks.ts";
import { cssFontFamily, fontFace, type DocumentFontFamily } from "../fontRegistry.ts";
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
// Bubbles from the text layer after a font that finished loading moved its
// fragments, so an overlay drawn over the text (the editor's caret) redraws.
export const TEXT_REPOSITIONED_EVENT = "tsd-text-repositioned";

const baselineMarker = () => {
  const marker = document.createElement("span");
  Object.assign(marker.style, { display: "inline-block", width: "0", height: "0", verticalAlign: "baseline" });
  return marker;
};
const blockAscents = new Map<string, number>();
const blockAscentKey = ({ style }: HTMLElement) =>
  [style.fontFamily, style.fontSize, style.fontWeight, style.fontStyle, style.lineHeight].join("|");
// Probes every unmeasured style before reading any, so the browser lays out once.
function measureBlockAscents(elements: HTMLElement[]): void {
  const probes = new Map<string, { probe: HTMLElement; marker: HTMLElement }>();
  for (const element of elements) {
    const key = blockAscentKey(element);
    if (blockAscents.has(key) || probes.has(key)) continue;
    const { fontFamily, fontSize, fontWeight, fontStyle, lineHeight } = element.style;
    const probe = document.createElement("span"), marker = baselineMarker();
    probe.setAttribute("aria-hidden", "true");
    Object.assign(probe.style, { position: "absolute", left: "-100000px", top: "0", whiteSpace: "pre", fontFamily, fontSize, fontWeight, fontStyle, lineHeight });
    probe.append(document.createTextNode("Mg"), marker);
    document.body.append(probe);
    probes.set(key, { probe, marker });
  }
  for (const [key, { probe, marker }] of probes) blockAscents.set(key, marker.getBoundingClientRect().top - probe.getBoundingClientRect().top);
  for (const { probe } of probes.values()) probe.remove();
}
const blockAscent = (element: HTMLElement) => blockAscents.get(blockAscentKey(element))!;

// Logical inline flow keeps native search/selection intact; relative offsets
// place its fragments on the engine's physical pages without reflowing text.
export function LogicalFields({ doc, variant, zoom, unit, faceBox, highlightFieldKey }: Props) {
  const layerRef = useRef<HTMLDivElement>(null);
  // Fragment offsets come from the browser's natural widths, so a face that
  // arrives after positioning (a fallback family) repositions the fragments.
  // Mid-composition the engine has not placed the uncommitted text yet, so the
  // pass waits for compositionend, which also ends a cancelled composition.
  const [fontLoads, setFontLoads] = useState(0);
  const repositionedFor = useRef(0);
  useEffect(() => {
    let composing = false;
    let deferred = false;
    const reposition = () => {
      if (composing) deferred = true;
      else setFontLoads((count) => count + 1);
    };
    const compositionStarted = () => { composing = true; };
    const compositionEnded = () => {
      composing = false;
      if (deferred) {
        deferred = false;
        setFontLoads((count) => count + 1);
      }
    };
    document.fonts.addEventListener("loadingdone", reposition);
    document.addEventListener("compositionstart", compositionStarted, true);
    document.addEventListener("compositionend", compositionEnded, true);
    return () => {
      document.fonts.removeEventListener("loadingdone", reposition);
      document.removeEventListener("compositionstart", compositionStarted, true);
      document.removeEventListener("compositionend", compositionEnded, true);
    };
  }, []);
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
    // DOM reads and writes stay in separate passes: interleaving them forced a
    // synchronous layout per fragment, which held back the first painted page.
    const origin = host.getBoundingClientRect();
    const pageOrigins = Array.from(host.querySelectorAll<HTMLElement>(".tsd-page"), (page) => {
      const rect = page.getBoundingClientRect();
      return { x: rect.left - origin.left + page.clientLeft, y: rect.top - origin.top + page.clientTop };
    });
    const rows = new Map<string, { top: number; ascent: number }>();
    doc.pages.forEach((page, pi) => page.lines.forEach((line, li) => {
      rows.set(`${pi}-${li}`, { top: Math.min(...line.runs.map(run => line.baseline - faceBox(run.style.family, run.style.face).ascent * run.style.size)) * scale, ascent: 0 });
    }));
    const probes = fields.map((field, index) => {
      const group = layer.children[index] as HTMLElement;
      const measuring = document.createElement("div");
      measuring.setAttribute("aria-hidden", "true");
      Object.assign(measuring.style, { position: "absolute", left: "-100000px", top: "0", width: unit(PAGE_WIDTH_BP) });
      const clone = group.cloneNode(true) as HTMLElement;
      const fragments = Array.from(clone.querySelectorAll<HTMLElement>("[data-tsdf]"));
      for (const fragment of fragments) { fragment.style.left = "0px"; fragment.style.top = "0px"; }
      measuring.append(clone);
      return { field, group, measuring, fragments };
    });
    document.body.append(...probes.map(({ measuring }) => measuring));
    const probeOrigins = probes.map(({ measuring }) => measuring.getBoundingClientRect());
    const xs = probes.map(({ fragments }, fieldIndex) => fragments.map(element => element.getBoundingClientRect().left - probeOrigins[fieldIndex].left));
    // A zero-size baseline marker adds no advance or line height, so every
    // fragment's marker can sit in the flow at once.
    const markers = probes.map(({ fragments }) => fragments.map(element => element.appendChild(baselineMarker())));
    const baselines = markers.map((group, fieldIndex) => group.map(marker => marker.getBoundingClientRect().top - probeOrigins[fieldIndex].top));
    for (const { measuring } of probes) measuring.remove();
    const decorations = Array.from(host.querySelectorAll<HTMLElement>("[data-tsd-decoration]"));
    measureBlockAscents([...probes.flatMap(({ fragments }) => fragments), ...decorations]);
    const measured = probes.map(({ field, group, fragments }, fieldIndex) => {
      const offsets = fragments.map((element, fi) => ({ x: xs[fieldIndex][fi], baseline: baselines[fieldIndex][fi], blockAscent: blockAscent(element) }));
      field.runs.forEach((run, ri) => {
        const row = rows.get(run.line)!;
        row.ascent = Math.max(row.ascent, offsets[ri].blockAscent);
      });
      return { field, painted: group.querySelectorAll<HTMLElement>("[data-tsdf]"), offsets };
    });
    for (const element of decorations) {
      const row = rows.get(element.parentElement!.getAttribute("data-tsd-line-box")!)!;
      row.ascent = Math.max(row.ascent, blockAscent(element));
    }
    // Preserve the former inline row's common CSS baseline across mixed fonts
    // and marker sizes, while the text itself follows logical field order.
    measured.forEach(({ field, painted, offsets }) => {
      field.runs.forEach((run, ri) => {
        const element = painted[ri], offset = offsets[ri];
        const pageX = variant === "print" ? 0 : pageOrigins[run.page].x;
        const pageY = variant === "print" ? run.page * PAGE_HEIGHT_BP * scale : pageOrigins[run.page].y;
        element.style.left = `${pageX + run.x * scale - offset.x}px`;
        const row = rows.get(run.line)!;
        element.style.top = `${pageY + row.top + row.ascent - offset.baseline}px`;
      });
    });
    for (const element of decorations) {
      const row = rows.get(element.parentElement!.getAttribute("data-tsd-line-box")!)!;
      element.style.top = `${row.ascent - blockAscent(element)}px`;
    }
    if (fontLoads !== repositionedFor.current) {
      repositionedFor.current = fontLoads;
      layer.dispatchEvent(new Event(TEXT_REPOSITIONED_EVENT, { bubbles: true }));
    }
  }, [doc, fields, variant, zoom, unit, faceBox, fontLoads]);

  return <div ref={layerRef} className="tsd-text-layer" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
    {fields.map(field => <div key={field.key} data-tsd-field={field.key} style={{ position: "relative", height: 0, whiteSpace: "pre", fontSize: 0, lineHeight: 0 }}>
      {field.runs.map((run, index) => {
        const box = faceBox(run.family, run.face), font = fontFace(run.family, run.face);
        const Tag = run.href ? "a" : "span";
        const fraction = Math.min(1, Math.max(0, (run.x - doc.geometry.marginLeft) / doc.geometry.textWidth));
        const style = {
          position: "relative", display: "inline", unicodeBidi: "isolate", verticalAlign: "baseline", pointerEvents: "auto",
          fontFamily: cssFontFamily(run.family, run.face), fontWeight: font.weight, fontStyle: font.italic ? "italic" : "normal",
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
