import { contentSpansOf, lineOf } from "./domSelection.ts";
import { useCallback, useMemo, useState, type MouseEvent, type KeyboardEvent, type RefObject } from "react";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Bold,
  ClipboardPaste,
  Copy,
  EyeOff,
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
import type {
  HeaderStructureCommands, EntryRowCommands
} from "./useTypesetStructure.ts";

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
  keyboard: boolean;
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
  structureCapabilities: {
    header: boolean;
    sections: boolean;
    nameRemovable?: boolean;
  };
  canPasteAsDocument: boolean;
  headerCommands: HeaderStructureCommands;
  entryRowCommands: EntryRowCommands;
  commands: TypesetEditorCommands;
  // The same state the toolbar renders from, so an item is enabled exactly when
  // its toolbar twin is.
  inlineFormat: InlineFormatState;
  addSectionRelative: (sectionId: string, position: Position, type: ResumeSectionType) => void;
  removeSectionAt: (sectionId: string) => void;
  addEntryRelative: (sectionId: string, entryId: string, position: Position) => void;
  moveEntryRelative: (sectionId: string, entryId: string, direction: -1 | 1) => void;
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
  structureCapabilities,
  canPasteAsDocument,
  headerCommands,
  entryRowCommands,
  commands,
  inlineFormat,
  addSectionRelative,
  removeSectionAt,
  addEntryRelative,
  removeEntryAt,
  moveEntryRelative,
  addBulletToEntry,
  addBulletRelative,
  removeBulletAt,
  canUndo,
  canRedo,
  onRequestLinkEditor
}: ContextMenuControllerArgs) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const closeContextMenu = useCallback(() => {
    if (contextMenu?.keyboard) hostRef.current?.focus({ preventScroll: true });
    setContextMenu(null);
  }, [contextMenu?.keyboard, hostRef]);

  const openContextMenu = useCallback(
    (event: MouseEvent | KeyboardEvent) => {
      const keyboard = "key" in event;
      if (keyboard && event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
      // Only replace the native menu inside the editable page. Drag grips in
      // the sibling structure overlay keep the browser menu.
      if (!hostRef.current?.contains(event.target as Node)) return;
      event.preventDefault();

      const selectionNode = keyboard ? window.getSelection()?.focusNode : null;
      const target = (selectionNode instanceof HTMLElement ? selectionNode : selectionNode?.parentElement) ?? event.target as HTMLElement;
      const rect = target.getBoundingClientRect();
      const clientX = keyboard ? rect.left : event.clientX;
      const clientY = keyboard ? rect.bottom : event.clientY;
      // A right-click in a line's blank area still targets that line, so the
      // structural commands cover the full row and not just its glyphs.
      const directField = target.closest<HTMLElement>("[data-tsdf]:not([data-tsdm])");
      const line = lineOf(target);
      let field = directField;
      if (!field && line) {
        const candidates = contentSpansOf(line);
        const contacts = candidates.filter((candidate) =>
          candidate.getAttribute("data-tsdf")?.startsWith("contact|")
        );
        if (contacts.length) {
          field = contacts.reduce((nearest, candidate) => {
            const nearestRect = nearest.getBoundingClientRect();
            const candidateRect = candidate.getBoundingClientRect();
            const nearestDistance = Math.abs(
              clientX - (nearestRect.left + nearestRect.right) / 2
            );
            const candidateDistance = Math.abs(
              clientX - (candidateRect.left + candidateRect.right) / 2
            );
            return candidateDistance < nearestDistance ? candidate : nearest;
          });
        } else {
          field = candidates[0];
        }
      }
      const key = field?.getAttribute("data-tsdf");

      setContextMenu({
        keyboard,
        x: clientX,
        y: clientY,
        structuralSrc: key ? parseFieldKey(key) : null,
        selectedText: commands.selectionText()
      });
    },
    [commands, hostRef]
  );

  const writePlainText = useCallback((text: string): Promise<boolean> => {
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
    const canPaste =
      typeof navigator !== "undefined" &&
      Boolean(navigator.clipboard?.read || navigator.clipboard?.readText);

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

    const headerSource = structureCapabilities.header ? structuralSrc : null;
    const source = structureCapabilities.sections ? structuralSrc : null;
    const structural: Array<ContextMenuItem | "divider"> = [];
    const rowItems = (sectionId: string, entryId: string): ContextMenuItem[] => {
      const section = data.sections.find((item) => item.id === sectionId);
      const entry = section?.items.find((item) => item.id === entryId);
      if (section?.type !== "standard" || !entry) return [];
      return (["title", "subtitle"] as const).map((row) => {
        const present = entry[row === "title" ? "titleLeft" : "subtitleLeft"] !== null;
        return {
          id: `${present ? "remove" : "add"}-${row}-row-${entryId}`,
          label: `${present ? "Remove" : "Add"} ${row} row`,
          icon: present ? <Trash2 size={14} /> : <ListPlus size={14} />,
          onSelect: () => present
            ? entryRowCommands.removeRow(sectionId, entryId, row)
            : entryRowCommands.addRow(sectionId, entryId, row)
        };
      });
    };
    const moveEntryItems = (sectionId: string, entryId: string): ContextMenuItem[] => {
      const section = data.sections.find((item) => item.id === sectionId);
      const index = section?.items.findIndex((item) => item.id === entryId) ?? -1;
      if (!section || section.items.length < 2 || index < 0) return [];
      return ([-1, 1] as const).map((direction) => ({
        id: `move-entry-${direction}`, label: `Move entry ${direction === -1 ? "up" : "down"}`,
        disabled: index + direction < 0 || index + direction >= section.items.length,
        onSelect: () => moveEntryRelative(sectionId, entryId, direction)
      }));
    };
    if (source?.kind === "entry" || source?.kind === "bullet") {
      const rows = rowItems(source.sectionId, source.entryId);
      if (rows.length) structural.push(...rows, "divider");
    }
    if (source?.kind === "heading") {
      const section = data.sections.find((item) => item.id === source.sectionId);
      if (section?.type === "standard") section.items.forEach((entry, index) => {
        if (entry.titleLeft !== null || entry.subtitleLeft !== null || entry.bullets.length) return;
        structural.push({
          id: `empty-entry-${entry.id}`, label: `Empty entry ${index + 1}`,
          submenu: rowItems(section.id, entry.id), onSelect: () => {}
        });
      });
      if (structural.length) structural.push("divider");
    }
    if (headerSource?.kind === "contact") {
      structural.push(
        {
          id: "add-contact-before",
          label: "Add contact before",
          icon: <ArrowUpToLine size={14} />,
          onSelect: () => headerCommands.addContactRelative(headerSource.index, "before")
        },
        {
          id: "add-contact-after",
          label: "Add contact after",
          icon: <ArrowDownToLine size={14} />,
          onSelect: () => headerCommands.addContactRelative(headerSource.index, "after")
        },
        deleteItem("delete-contact", "contact", () =>
          headerCommands.removeContact(headerSource.index)
        ),
        ...(structureCapabilities.nameRemovable && data.header?.name === null
          ? [{
              id: "add-name",
              label: "Add name",
              icon: <ListPlus size={14} />,
              onSelect: headerCommands.addName
            } satisfies ContextMenuItem]
          : []),
        "divider",
        {
          id: "hide-header",
          label: "Hide header",
          icon: <EyeOff size={14} />,
          onSelect: headerCommands.hideHeader
        },
        "divider"
      );
    } else if (headerSource?.kind === "name") {
      structural.push(
        {
          id: "add-contact-at-end",
          label: data.header?.contact.length ? "Add contact at end" : "Add contact",
          icon: <ListPlus size={14} />,
          onSelect: headerCommands.addContactAtEnd
        },
        ...(structureCapabilities.nameRemovable
          ? [{
              id: "remove-name",
              label: "Remove name",
              icon: <Trash2 size={14} />,
              onSelect: headerCommands.removeName
            } satisfies ContextMenuItem]
          : []),
        "divider",
        {
          id: "hide-header",
          label: "Hide header",
          icon: <EyeOff size={14} />,
          onSelect: headerCommands.hideHeader
        },
        "divider"
      );
    } else if (source?.kind === "heading") {
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
        ...moveEntryItems(source.sectionId, source.entryId),
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
      const entryIndex = section?.items.findIndex((entry) => entry.id === source.entryId) ?? -1;
      const entry = section?.items[entryIndex];
      if (section?.type === "standard" && entry?.titleLeft === null && entry.subtitleLeft === null) {
        structural.push(
          insertItem("add-entry-above", "entry", "above", () => addEntryRelative(section.id, entry.id, "above")),
          insertItem("add-entry-below", "entry", "below", () => addEntryRelative(section.id, entry.id, "below")),
          ...moveEntryItems(section.id, entry.id),
          deleteItem("delete-entry", "entry", () => removeEntryAt(section.id, entry.id)),
          "divider"
        );
      }
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
          void commands.cutSelection();
        }
      },
      {
        id: "copy",
        label: "Copy",
        shortcut: `${MOD}C`,
        icon: <Copy size={14} />,
        disabled: !hasRange,
        onSelect: () => void commands.copySelection()
      },
      {
        id: "paste",
        label: "Paste",
        shortcut: `${MOD}V`,
        icon: <ClipboardPaste size={14} />,
        disabled: !canPaste,
        onSelect: () => {
          void commands.pasteFromClipboard();
        }
      },
      ...(canPasteAsDocument
        ? [{
            id: "paste-as-document",
            label: "Paste as document…",
            icon: <ClipboardPaste size={14} />,
            disabled: !canPaste,
            onSelect: () => {
              void commands.pasteAsDocumentFromClipboard();
            }
          } satisfies ContextMenuItem]
        : []),
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
              onSelect: () => void writePlainText(href)
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
    canPasteAsDocument,
    commands,
    contextMenu,
    data,
    headerCommands,
    entryRowCommands,
    inlineFormat,
    onRequestLinkEditor,
    removeBulletAt,
    removeEntryAt,
    moveEntryRelative,
    removeSectionAt,
    structureCapabilities,
    writePlainText
  ]);

  return { contextMenu, menuItems, openContextMenu, closeContextMenu };
}
