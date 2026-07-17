import type { LayoutDocument } from "@typeset/engine/typeset/layout.ts";
import { parseFieldKey, type FieldSrc } from "@typeset/engine/typeset/types.ts";

// Engine-derived positions for controls that sit in page margins without
// entering the editable DOM or influencing layout.
export type BlockAnchor = {
  page: number;
  top: number;
  bottom: number;
  sectionId: string;
  entryId?: string;
  bulletId?: string;
  contactIndex?: number;
  x0?: number;
  x1?: number;
  kind: "heading" | "entry" | "skillsRow" | "bullet" | "contact";
};

export type TypesetAnchors = {
  blocks: BlockAnchor[];
  headings: Map<string, BlockAnchor>;
};

export type DragState = {
  kind: "bullet" | "entry" | "section";
  sectionId: string;
  entryId?: string;
  fromIndex: number;
  slots: Array<{ page: number; yBp: number }>;
  active: number | null;
  // The dragged block's own extent, painted as a lifted highlight so the user
  // sees exactly what is moving while the drop line shows where it will land.
  source: { page: number; top: number; bottom: number };
};

function belongsToBlock(src: FieldSrc, block: Pick<BlockAnchor, "kind" | "sectionId" | "entryId" | "bulletId">) {
  if (src.kind !== block.kind) return false;
  if (src.kind === "heading") return src.sectionId === block.sectionId;
  if (src.kind === "entry" || src.kind === "skillsRow") {
    return src.sectionId === block.sectionId && src.entryId === block.entryId;
  }
  if (src.kind === "bullet") {
    return src.sectionId === block.sectionId && src.entryId === block.entryId && src.bulletId === block.bulletId;
  }
  return false;
}

export function anchorsFromDoc(doc: LayoutDocument): TypesetAnchors {
  const byKey = new Map<string, BlockAnchor>();
  doc.pages.forEach((page, pageIndex) => {
    for (const line of page.lines) {
      for (const run of line.runs) {
        if (!run.src || run.marker || run.src.kind !== "contact") continue;
        const key = `contact|${run.src.index}|${pageIndex}`;
        const top = line.baseline - run.style.size;
        const bottom = line.baseline + run.style.size * 0.35;
        const existing = byKey.get(key);
        if (existing) {
          existing.top = Math.min(existing.top, top);
          existing.bottom = Math.max(existing.bottom, bottom);
          existing.x0 = Math.min(existing.x0 ?? run.x, run.x);
          existing.x1 = Math.max(existing.x1 ?? run.x + run.width, run.x + run.width);
        } else {
          byKey.set(key, {
            page: pageIndex,
            top,
            bottom,
            sectionId: "",
            contactIndex: run.src.index,
            x0: run.x,
            x1: run.x + run.width,
            kind: "contact"
          });
        }
      }

      const run = line.runs.find(
        (candidate) => candidate.src && !candidate.marker && candidate.src.kind !== "contact" && candidate.src.kind !== "name"
      );
      const src = run?.src;
      if (!src) continue;

      let anchor: Pick<BlockAnchor, "kind" | "sectionId" | "entryId" | "bulletId">;
      if (src.kind === "heading") {
        anchor = { kind: "heading", sectionId: src.sectionId };
      } else if (src.kind === "entry") {
        anchor = { kind: "entry", sectionId: src.sectionId, entryId: src.entryId };
      } else if (src.kind === "skillsRow") {
        anchor = { kind: "skillsRow", sectionId: src.sectionId, entryId: src.entryId };
      } else if (src.kind === "bullet") {
        anchor = { kind: "bullet", sectionId: src.sectionId, entryId: src.entryId, bulletId: src.bulletId };
      } else {
        continue;
      }

      const size = Math.max(...line.runs.map((candidate) => candidate.style.size), 8);
      const top = line.baseline - size;
      const bottom = line.baseline + size * 0.35;
      // Track the block's actual ink edge, including the bullet marker. Chrome
      // can then use the otherwise-empty indentation before that edge as part of
      // the drag target without covering editable glyphs.
      const blockRuns = line.runs.filter((candidate) => candidate.src && belongsToBlock(candidate.src, anchor));
      const x0 = Math.min(...blockRuns.map((candidate) => candidate.x));
      const x1 = Math.max(...blockRuns.map((candidate) => candidate.x + candidate.width));
      const key = `${anchor.kind}|${anchor.sectionId}|${anchor.entryId ?? ""}|${anchor.bulletId ?? ""}|${pageIndex}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.top = Math.min(existing.top, top);
        existing.bottom = Math.max(existing.bottom, bottom);
        existing.x0 = Math.min(existing.x0 ?? x0, x0);
        existing.x1 = Math.max(existing.x1 ?? x1, x1);
      } else {
        byKey.set(key, { page: pageIndex, top, bottom, x0, x1, ...anchor });
      }
    }
  });

  const blocks = Array.from(byKey.values());
  const headings = new Map<string, BlockAnchor>();
  for (const block of blocks) {
    if (block.kind === "heading" && !headings.has(block.sectionId)) headings.set(block.sectionId, block);
  }
  return { blocks, headings };
}

export type Extent = { firstPage: number; top: number; lastPage: number; bottom: number };

export function extentOf(blocks: BlockAnchor[], predicate: (block: BlockAnchor) => boolean): Extent | null {
  let extent: Extent | null = null;
  for (const block of blocks) {
    if (!predicate(block)) continue;
    if (!extent) {
      extent = { firstPage: block.page, top: block.top, lastPage: block.page, bottom: block.bottom };
      continue;
    }
    if (block.page < extent.firstPage) {
      extent.firstPage = block.page;
      extent.top = block.top;
    } else if (block.page === extent.firstPage) {
      extent.top = Math.min(extent.top, block.top);
    }
    if (block.page > extent.lastPage) {
      extent.lastPage = block.page;
      extent.bottom = block.bottom;
    } else if (block.page === extent.lastPage) {
      extent.bottom = Math.max(extent.bottom, block.bottom);
    }
  }
  return extent;
}

export function slotsFor(extents: Extent[]): Array<{ page: number; yBp: number }> {
  const slots: Array<{ page: number; yBp: number }> = [];
  for (let index = 0; index <= extents.length; index += 1) {
    if (index === 0) {
      slots.push({ page: extents[0].firstPage, yBp: extents[0].top - 1.5 });
    } else if (index === extents.length) {
      slots.push({ page: extents[index - 1].lastPage, yBp: extents[index - 1].bottom + 1.5 });
    } else {
      const previous = extents[index - 1];
      const current = extents[index];
      slots.push(
        previous.lastPage === current.firstPage
          ? { page: current.firstPage, yBp: (previous.bottom + current.top) / 2 }
          : { page: current.firstPage, yBp: current.top - 1.5 }
      );
    }
  }
  return slots;
}

export function anchorForField(anchors: TypesetAnchors | null, key: string | null): BlockAnchor | null {
  if (!anchors || !key) return null;
  const src = parseFieldKey(key);
  if (!src || src.kind === "name") return null;
  if (src.kind === "heading") return anchors.headings.get(src.sectionId) ?? null;
  if (src.kind === "contact") {
    return anchors.blocks.find((block) => block.kind === "contact" && block.contactIndex === src.index) ?? null;
  }
  if (src.kind === "bullet") {
    return anchors.blocks.find((block) => block.kind === "bullet" && block.bulletId === src.bulletId) ?? null;
  }
  return anchors.blocks.find((block) => block.entryId === src.entryId) ?? null;
}
