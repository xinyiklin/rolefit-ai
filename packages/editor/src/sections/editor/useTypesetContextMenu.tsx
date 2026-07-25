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

import { SECTION_TYPE_OPTIONS, type ResumeData, type ResumeSectionType } from "@typeset/engine/lib/resumeData.ts";
import { parseFieldKey, type FieldSrc } from "@typeset/engine/typeset/types.ts";
import type { InlineFormatState, TypesetEditorCommands } from "./TypesetEditor.tsx";
import type { ContextMenuItem } from "./TypesetContextMenu.tsx";

const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
const MOD = IS_MAC ? "⌘" : "Ctrl+";
const REDO_SHORTCUT = IS_MAC ? "⇧⌘Z" : "Ctrl+Y";

type Position = "above" | "below";

// Captured when the menu opens, for deciding what to SHOW. The commands act on
// the live selection instead of on a copy of it: the menu's buttons suppress
// their own mousedown and any pointerdown elsewhere closes the menu, so nothing
// can move the selection in between, and re-reading it keeps a menu item and the
// equivalent toolbar button acting on exactly the same thing.
type ContextMenuState = {
  x: number;
  y: number;
  // The field the pointer was over, which drives the structural commands. It is
  // deliberately independent of the selection: right-clicking a bullet offers to
  // delete THAT bullet, the way a word processor targets what you pointed at.
  structuralSrc: FieldSrc | null;
  selectedText: string;
};

type ContextMenuControllerArgs = {
  data: ResumeData;
  hostRef: RefObject<HTMLDivElement | null>;
  // Structural commands belong to the resume grammar. A cover letter is plain
  // correspondence — paragraphs, no sections or bullets — so it shows the menu
  // without them rather than showing no menu at all.
  structureEditing: boolean;
  commands: TypesetEditorCommands;
  // The same state the toolbar renders from, so an item is enabled exactly when
  // its toolbar twin is.
  inlineFormat: InlineFormatState;
  addSectionRelative: (sectionId: string, position: Position, type: ResumeSectionType) => void;
  removeSectionAt: (sectionId: string) => void;
  addEntryRelative: (sectionId: string, entryId: string, position: Position) => void;
  removeEntryAt: (sectionId: string, entryId: string) => void;
  addBulletToEntry: (sectionId: string, entryId: string) => void;
  addBulletRelative: (sectionId: string, entryId: string, bulletId: string, position: Position) => void;
  removeBulletAt: (sectionId: string, entryId: string, bulletId: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  onRequestLinkEditor?: () => void;
};

export function useTypesetContextMenu({
  data,
  hostRef,
  structureEditing,
  commands,
  inlineFormat,
  addSectionRelative,
  removeSectionAt,
  addEntryRelative,
  removeEntryAt,
  addBulletToEntry,
  addBulletRelative,
  removeBulletAt,
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
      // A right-click in a line's blank area still targets that line, so the
      // structural commands cover the full row and not just its glyphs.
      const field =
        target.closest<HTMLElement>("[data-tsdf]:not([data-tsdm])") ??
        target.closest<HTMLElement>(".tsd-line")?.querySelector<HTMLElement>("[data-tsdf]:not([data-tsdm])");
      const key = field?.getAttribute("data-tsdf");

      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        structuralSrc: key ? parseFieldKey(key) : null,
        selectedText: commands.selectionText()
      });
    },
    [commands, hostRef]
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

  const menuItems = useMemo<Array<ContextMenuItem | "divider">>(() => {
    if (!contextMenu) return [];
    const { structuralSrc, selectedText } = contextMenu;
    const hasRange = Boolean(selectedText);
    const canPaste = typeof navigator !== "undefined" && Boolean(navigator.clipboard?.readText);

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

    const source = structureEditing ? structuralSrc : null;
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

    const href = inlineFormat.linkHref;
    return [
      ...structural,
      {
        id: "cut",
        label: "Cut",
        shortcut: `${MOD}X`,
        icon: <Scissors size={14} />,
        disabled: !hasRange,
        onSelect: () => {
          void writeClipboard(selectedText).then((copied) => {
            if (copied) commands.deleteSelection();
          });
        }
      },
      {
        id: "copy",
        label: "Copy",
        shortcut: `${MOD}C`,
        icon: <Copy size={14} />,
        disabled: !hasRange,
        onSelect: () => void writeClipboard(selectedText)
      },
      {
        id: "paste",
        label: "Paste",
        shortcut: `${MOD}V`,
        icon: <ClipboardPaste size={14} />,
        disabled: !canPaste,
        onSelect: () => {
          void navigator.clipboard
            ?.readText()
            .then((text) => {
              if (text) commands.insertText(text);
            })
            .catch(() => {});
        }
      },
      "divider",
      {
        id: "bold",
        label: "Bold",
        shortcut: `${MOD}B`,
        icon: <Bold size={14} />,
        disabled: !inlineFormat.canFormat,
        onSelect: () => commands.toggleMark("bold")
      },
      {
        id: "italic",
        label: "Italic",
        shortcut: `${MOD}I`,
        icon: <Italic size={14} />,
        disabled: !inlineFormat.canFormat,
        onSelect: () => commands.toggleMark("italic")
      },
      {
        id: "underline",
        label: "Underline",
        shortcut: `${MOD}U`,
        icon: <Underline size={14} />,
        disabled: !inlineFormat.canFormat,
        onSelect: () => commands.toggleMark("underline")
      },
      {
        id: "clear-formatting",
        label: "Clear formatting",
        shortcut: `${MOD}\\`,
        icon: <RemoveFormatting size={14} />,
        disabled: !inlineFormat.canClearFormatting,
        onSelect: () => commands.clearFormatting()
      },
      "divider",
      ...(href
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
              onSelect: () => window.open(href, "_blank", "noopener,noreferrer")
            },
            {
              id: "copy-link",
              label: "Copy link",
              icon: <Copy size={14} />,
              onSelect: () => void writeClipboard(href)
            },
            {
              // Works for a detected bare URL too: removing an automatic link
              // marks the run <nolink>, so the text stays and stops linking.
              id: "remove-link",
              label: "Remove link",
              icon: <Unlink size={14} />,
              onSelect: () => commands.removeLink()
            },
            "divider"
          ] as Array<ContextMenuItem | "divider">)
        : inlineFormat.canLink
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
        onSelect: () => commands.undo()
      },
      {
        id: "redo",
        label: "Redo",
        shortcut: REDO_SHORTCUT,
        icon: <Redo2 size={14} />,
        disabled: !canRedo,
        onSelect: () => commands.redo()
      }
    ];
  }, [
    addBulletRelative,
    addBulletToEntry,
    addEntryRelative,
    addSectionRelative,
    canRedo,
    canUndo,
    commands,
    contextMenu,
    data,
    inlineFormat,
    onRequestLinkEditor,
    removeBulletAt,
    removeEntryAt,
    removeSectionAt,
    structureEditing,
    writeClipboard
  ]);

  return { contextMenu, menuItems, openContextMenu, closeContextMenu };
}
