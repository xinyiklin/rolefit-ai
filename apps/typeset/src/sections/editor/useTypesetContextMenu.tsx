import { useCallback, useMemo, useState, type MouseEvent, type RefObject } from "react";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Bold,
  ClipboardPaste,
  Copy,
  ExternalLink,
  Italic,
  Link2,
  ListPlus,
  Redo2,
  RemoveFormatting,
  Scissors,
  Trash2,
  Underline,
  Undo2,
  Unlink
} from "lucide-react";

import { SECTION_TYPE_OPTIONS, type ResumeData, type ResumeSectionType } from "@typeset/engine/lib/resumeData";
import { parseFieldKey, type FieldSrc } from "@typeset/engine/typeset/types";
import {
  autoLinkWordAt,
  expandToLinkRun,
  explicitLinkRunAt,
  hasClearableFormatting,
  type DisplayMap,
  type TypesetSelection
} from "./inlineTextEditing.ts";
import { valueForField } from "./resumeFieldAdapter.ts";
import type { ContextMenuItem } from "./TypesetContextMenu.tsx";

const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
const MOD = IS_MAC ? "⌘" : "Ctrl+";
const REDO_SHORTCUT = IS_MAC ? "⇧⌘Z" : "Ctrl+Y";

type Position = "above" | "below";
type ContextMenuState = {
  x: number;
  y: number;
  selection: TypesetSelection | null;
  selectedText: string;
};

type ContextMenuControllerArgs = {
  data: ResumeData;
  hostRef: RefObject<HTMLDivElement | null>;
  mapFor: (source: FieldSrc, value: string) => DisplayMap;
  readSelection: () => TypesetSelection | null;
  addSectionRelative: (sectionId: string, position: Position, type: ResumeSectionType) => void;
  removeSectionAt: (sectionId: string) => void;
  addEntryRelative: (sectionId: string, entryId: string, position: Position) => void;
  removeEntryAt: (sectionId: string, entryId: string) => void;
  addBulletToEntry: (sectionId: string, entryId: string) => void;
  addBulletRelative: (sectionId: string, entryId: string, bulletId: string, position: Position) => void;
  removeBulletAt: (sectionId: string, entryId: string, bulletId: string) => void;
  commitReplace: (selection: TypesetSelection, start: number, end: number, text: string) => void;
  commitToggleMark: (selection: TypesetSelection, mark: "bold" | "italic" | "underline") => void;
  commitClearFormatting: (selection: TypesetSelection) => void;
  commitLink: (selection: TypesetSelection, start: number, end: number, href: string | null) => void;
  commitHistory: (direction: "undo" | "redo") => void;
  canUndo: boolean;
  canRedo: boolean;
  onRequestLinkEditor?: () => void;
};

export function useTypesetContextMenu({
  data,
  hostRef,
  mapFor,
  readSelection,
  addSectionRelative,
  removeSectionAt,
  addEntryRelative,
  removeEntryAt,
  addBulletToEntry,
  addBulletRelative,
  removeBulletAt,
  commitReplace,
  commitToggleMark,
  commitClearFormatting,
  commitLink,
  commitHistory,
  canUndo,
  canRedo,
  onRequestLinkEditor
}: ContextMenuControllerArgs) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const openContextMenu = useCallback(
    (event: MouseEvent) => {
      // Only replace the native menu inside the editable page. Drag grips in
      // the sibling structure overlay keep the browser menu.
      if (!hostRef.current?.contains(event.target as Node)) return;
      event.preventDefault();

      const target = event.target as HTMLElement;
      const onField = target.closest<HTMLElement>("[data-tsdf]:not([data-tsdm])");
      let selection = readSelection();

      // A right-click in a line's blank area targets the line without moving
      // the actual caret. This makes structural commands available across the
      // full row while preserving the user's current selection.
      if (!onField) {
        const line = target.closest<HTMLElement>(".tsd-line");
        const field = line?.querySelector<HTMLElement>("[data-tsdf]:not([data-tsdm])");
        const key = field?.getAttribute("data-tsdf");
        const source = key ? parseFieldKey(key) : null;
        if (source && key) {
          const value = valueForField(data, source);
          selection = { src: source, key, map: mapFor(source, value), value, dStart: 0, dEnd: 0 };
        }
      }

      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        selection,
        selectedText: window.getSelection()?.toString() ?? ""
      });
    },
    [data, hostRef, mapFor, readSelection]
  );

  // Resolves true only when the text actually reached the clipboard, so Cut
  // can refuse to delete a selection whose copy failed (permission denied,
  // insecure context) instead of silently losing it.
  const writeClipboard = useCallback((text: string): Promise<boolean> => {
    if (!text || !navigator.clipboard?.writeText) return Promise.resolve(false);
    return navigator.clipboard.writeText(text).then(
      () => true,
      () => false
    );
  }, []);

  const menuLink = useMemo(() => {
    const selection = contextMenu?.selection;
    if (!selection) return null;
    const run = selection.dEnd > selection.dStart
      ? expandToLinkRun(selection.map, selection.dStart, selection.dEnd)
      : explicitLinkRunAt(selection.map, selection.dStart) ?? autoLinkWordAt(selection.map, selection.dStart);
    return run ? { href: run.href, start: run.start, end: run.end } : null;
  }, [contextMenu]);

  const menuItems = useMemo<Array<ContextMenuItem | "divider">>(() => {
    if (!contextMenu) return [];
    const { selection, selectedText } = contextMenu;
    const hasRange = Boolean(selection && selection.dStart !== selection.dEnd);
    const canPaste = Boolean(selection && typeof navigator !== "undefined" && navigator.clipboard?.readText);

    const insertItem = (
      id: string,
      noun: string,
      position: Position,
      onSelect: () => void
    ): ContextMenuItem => ({
      id,
      label: `Add ${noun} ${position}`,
      icon: position === "above" ? <ArrowUpToLine size={14} /> : <ArrowDownToLine size={14} />,
      onSelect
    });
    const deleteItem = (
      id: string,
      noun: string,
      onSelect: () => void,
      disabled = false
    ): ContextMenuItem => ({
      id,
      label: `Delete ${noun}`,
      icon: <Trash2 size={14} />,
      disabled,
      onSelect
    });

    const source = selection?.src;
    const structural: Array<ContextMenuItem | "divider"> = [];
    if (source?.kind === "heading") {
      const submenu = (position: Position): ContextMenuItem[] =>
        SECTION_TYPE_OPTIONS.map(({ type, label }) => ({
          id: `add-section-${position}-${type}`,
          label,
          onSelect: () => addSectionRelative(source.sectionId, position, type)
        }));
      structural.push(
        {
          id: "add-section-above",
          label: "Add section above",
          icon: <ArrowUpToLine size={14} />,
          submenu: submenu("above"),
          onSelect: () => {}
        },
        {
          id: "add-section-below",
          label: "Add section below",
          icon: <ArrowDownToLine size={14} />,
          submenu: submenu("below"),
          onSelect: () => {}
        },
        deleteItem("delete-section", "section", () => removeSectionAt(source.sectionId)),
        "divider"
      );
    } else if (source?.kind === "entry") {
      structural.push(
        insertItem("add-entry-above", "entry", "above", () => addEntryRelative(source.sectionId, source.entryId, "above")),
        insertItem("add-entry-below", "entry", "below", () => addEntryRelative(source.sectionId, source.entryId, "below")),
        {
          id: "add-bullet-to-entry",
          label: "Add bullet",
          icon: <ListPlus size={14} />,
          onSelect: () => addBulletToEntry(source.sectionId, source.entryId)
        },
        deleteItem("delete-entry", "entry", () => removeEntryAt(source.sectionId, source.entryId)),
        "divider"
      );
    } else if (source?.kind === "skillsRow") {
      const rowCount = data.sections.find((section) => section.id === source.sectionId)?.items.length ?? 0;
      structural.push(
        insertItem("add-skill-above", "skill row", "above", () => addEntryRelative(source.sectionId, source.entryId, "above")),
        insertItem("add-skill-below", "skill row", "below", () => addEntryRelative(source.sectionId, source.entryId, "below")),
        deleteItem("delete-skill", "skill row", () => removeEntryAt(source.sectionId, source.entryId), rowCount <= 1),
        "divider"
      );
    } else if (source?.kind === "bullet") {
      const section = data.sections.find((item) => item.id === source.sectionId);
      // Summary paragraphs are a single running block: they don't offer add or
      // delete paragraph commands. Only bulleted-entry sections get them.
      if (section?.type !== "summary") {
        structural.push(
          insertItem("add-bullet-above", "bullet", "above", () =>
            addBulletRelative(source.sectionId, source.entryId, source.bulletId, "above")
          ),
          insertItem("add-bullet-below", "bullet", "below", () =>
            addBulletRelative(source.sectionId, source.entryId, source.bulletId, "below")
          ),
          deleteItem("delete-bullet", "bullet", () =>
            removeBulletAt(source.sectionId, source.entryId, source.bulletId)
          ),
          "divider"
        );
      }
    }

    return [
      ...structural,
      {
        id: "cut",
        label: "Cut",
        shortcut: `${MOD}X`,
        icon: <Scissors size={14} />,
        disabled: !hasRange,
        onSelect: () => {
          if (!selection) return;
          void writeClipboard(selectedText).then((copied) => {
            if (copied) commitReplace(selection, selection.dStart, selection.dEnd, "");
          });
        }
      },
      {
        id: "copy",
        label: "Copy",
        shortcut: `${MOD}C`,
        icon: <Copy size={14} />,
        disabled: !selectedText,
        onSelect: () => void writeClipboard(selectedText)
      },
      {
        id: "paste",
        label: "Paste",
        shortcut: `${MOD}V`,
        icon: <ClipboardPaste size={14} />,
        disabled: !canPaste,
        onSelect: () => {
          if (!selection) return;
          void navigator.clipboard?.readText().then((text) => {
            if (text) commitReplace(selection, selection.dStart, selection.dEnd, text);
          }).catch(() => {});
        }
      },
      "divider",
      {
        id: "bold",
        label: "Bold",
        shortcut: `${MOD}B`,
        icon: <Bold size={14} />,
        disabled: !hasRange,
        onSelect: () => selection && commitToggleMark(selection, "bold")
      },
      {
        id: "italic",
        label: "Italic",
        shortcut: `${MOD}I`,
        icon: <Italic size={14} />,
        disabled: !hasRange,
        onSelect: () => selection && commitToggleMark(selection, "italic")
      },
      {
        id: "underline",
        label: "Underline",
        shortcut: `${MOD}U`,
        icon: <Underline size={14} />,
        disabled: !hasRange,
        onSelect: () => selection && commitToggleMark(selection, "underline")
      },
      {
        id: "clear-formatting",
        label: "Clear formatting",
        shortcut: `${MOD}\\`,
        icon: <RemoveFormatting size={14} />,
        disabled: !(hasRange && selection && hasClearableFormatting(selection.map, selection.dStart, selection.dEnd)),
        onSelect: () => selection && commitClearFormatting(selection)
      },
      "divider",
      ...(menuLink
        ? ([
            {
              id: "edit-link",
              label: "Edit link",
              shortcut: `${MOD}K`,
              icon: <Link2 size={14} />,
              onSelect: () => onRequestLinkEditor?.()
            },
            {
              id: "open-link",
              label: "Open link",
              icon: <ExternalLink size={14} />,
              onSelect: () => window.open(menuLink.href, "_blank", "noopener,noreferrer")
            },
            {
              id: "copy-link",
              label: "Copy link",
              icon: <Copy size={14} />,
              onSelect: () => void writeClipboard(menuLink.href)
            },
            {
              id: "remove-link",
              label: "Remove link",
              icon: <Unlink size={14} />,
              onSelect: () => selection && commitLink(selection, menuLink.start, menuLink.end, null)
            },
            "divider"
          ] as Array<ContextMenuItem | "divider">)
        : hasRange
          ? ([
              {
                id: "add-link",
                label: "Add link",
                shortcut: `${MOD}K`,
                icon: <Link2 size={14} />,
                onSelect: () => onRequestLinkEditor?.()
              },
              "divider"
            ] as Array<ContextMenuItem | "divider">)
          : []),
      {
        id: "undo",
        label: "Undo",
        shortcut: `${MOD}Z`,
        icon: <Undo2 size={14} />,
        disabled: !canUndo,
        onSelect: () => commitHistory("undo")
      },
      {
        id: "redo",
        label: "Redo",
        shortcut: REDO_SHORTCUT,
        icon: <Redo2 size={14} />,
        disabled: !canRedo,
        onSelect: () => commitHistory("redo")
      }
    ];
  }, [
    addBulletRelative,
    addBulletToEntry,
    addEntryRelative,
    addSectionRelative,
    canRedo,
    canUndo,
    commitClearFormatting,
    commitHistory,
    commitLink,
    commitReplace,
    commitToggleMark,
    contextMenu,
    data,
    menuLink,
    onRequestLinkEditor,
    removeBulletAt,
    removeEntryAt,
    removeSectionAt,
    writeClipboard
  ]);

  return { contextMenu, menuItems, openContextMenu, closeContextMenu };
}
