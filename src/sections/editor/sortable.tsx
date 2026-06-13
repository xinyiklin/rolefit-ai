import { useCallback, type CSSProperties, type ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";

// Vertical sortable list (reorder within one level). dnd-kit contexts nest, so a
// section list can contain entry lists which contain bullet lists; each drag is
// confined to its own context. A small pointer activation distance keeps clicks on
// the inner fields from starting a drag.
type SortableListProps = {
  ids: string[];
  onReorder: (from: number, to: number) => void;
  children: ReactNode;
};

export function SortableList({ ids, onReorder, children }: SortableListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const from = ids.indexOf(String(active.id));
      const to = ids.indexOf(String(over.id));
      if (from >= 0 && to >= 0) onReorder(from, to);
    },
    [ids, onReorder]
  );

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

// Wires one row into its sortable list: spread `setNodeRef`/`style` on the row's
// root element, append `isDragging` to its class, and render `handle` (the grip)
// inside the row's controls. The grip carries the drag listeners.
export function useSortableRow(id: string, label: string) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition };
  const handle = (
    <button
      type="button"
      className="rdx-iconbtn rdx-drag"
      aria-label={`Drag to reorder ${label}`}
      title={`Drag to reorder ${label}`}
      {...attributes}
      {...listeners}
    >
      <GripVertical size={13} aria-hidden="true" />
    </button>
  );
  return { setNodeRef, style, isDragging, handle };
}
