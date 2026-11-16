/**
 * Dragging tasks in the Planner, with pointer events (dnd-kit): the native
 * drag and drop of web pages doesn't reach the page inside the app's window,
 * which takes file drops from the system for itself.
 *
 * A task dropped on the top or bottom of another lands before or after it;
 * on its middle, it becomes its subtask. Headings, columns and the sidebar's
 * lists take drops as a whole.
 */
import { type ReactNode, useState } from "react";
import {
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { BookOpenIcon, CircleIcon } from "lucide-react";
import { create } from "zustand";
import type { TaskRef } from "@/lib/plan/plan-file";
import type { PlanList } from "@/lib/plan/plan-store";

export type Zone = "before" | "inside" | "after";

/** A task (or subtask, or reading entry) being dragged, and where it's from. */
export interface DragTask {
  list: Pick<PlanList, "key" | "name">;
  ref: TaskRef;
  /** A subtask of that task. */
  sub?: number;
  reading?: boolean;
  /** What the dragged card shows. */
  label: string;
}

export interface DropTarget {
  onDrop: (drag: DragTask, zone: Zone) => void;
  /** Takes a task on its middle, as a subtask. */
  nestable?: boolean;
  /** Only reading entries (or only tasks) land here. */
  accepts?: "tasks" | "reading" | "any";
}

export const useTaskDrag = create<{
  drag: DragTask | null;
  over: { id: string; zone: Zone } | null;
}>(() => ({ drag: null, over: null }));

function zoneFor(e: DragMoveEvent, target?: DropTarget): Zone {
  const rect = e.over?.rect;
  const start = e.activatorEvent as PointerEvent | undefined;
  if (!rect || !start) return "before";
  const y = start.clientY + e.delta.y;
  const at = (y - rect.top) / rect.height;
  if (target?.nestable)
    return at < 0.3 ? "before" : at > 0.7 ? "after" : "inside";
  return at < 0.5 ? "before" : "after";
}

const fits = (drag: DragTask, target?: DropTarget) =>
  !target?.accepts ||
  target.accepts === "any" ||
  (target.accepts === "reading") === !!drag.reading;

/** Around everything that drags or takes drops. */
export function PlannerDnd({ children }: { children: ReactNode }) {
  const sensors = useSensors(
    // A few pixels first: a click stays a click.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );
  const [active, setActive] = useState<DragTask | null>(null);
  const track = (e: DragMoveEvent) => {
    const target = e.over?.data.current as DropTarget | undefined;
    const drag = useTaskDrag.getState().drag;
    const over =
      e.over && drag && fits(drag, target)
        ? { id: String(e.over.id), zone: zoneFor(e, target) }
        : null;
    const now = useTaskDrag.getState().over;
    if (now?.id !== over?.id || now?.zone !== over?.zone) {
      useTaskDrag.setState({ over });
    }
  };
  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e: DragStartEvent) => {
        const drag = e.active.data.current as DragTask;
        setActive(drag);
        useTaskDrag.setState({ drag, over: null });
      }}
      onDragMove={track}
      onDragOver={track}
      onDragCancel={() => {
        setActive(null);
        useTaskDrag.setState({ drag: null, over: null });
      }}
      onDragEnd={(e: DragEndEvent) => {
        const { drag, over } = useTaskDrag.getState();
        setActive(null);
        useTaskDrag.setState({ drag: null, over: null });
        const target = e.over?.data.current as DropTarget | undefined;
        if (drag && target && over && fits(drag, target)) {
          target.onDrop(drag, over.zone);
        }
      }}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {active && (
          <div className="flex max-w-80 items-center gap-2 rounded-lg border border-border bg-popover px-3 py-2 text-sm shadow-xl">
            {active.reading ? (
              <BookOpenIcon className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <CircleIcon className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate">{active.label}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

/** A task that drags, and takes drops before, after or inside it. */
export function useTaskDnd(id: string, drag: DragTask, target: DropTarget) {
  const draggable = useDraggable({ id: `drag:${id}`, data: drag });
  const droppable = useDroppable({ id, data: target });
  const over = useTaskDrag((s) => (s.over?.id === id ? s.over.zone : null));
  return {
    ref: (el: HTMLElement | null) => {
      draggable.setNodeRef(el);
      droppable.setNodeRef(el);
    },
    handlers: { ...draggable.listeners, ...draggable.attributes },
    dragging: draggable.isDragging,
    over: draggable.isDragging ? null : over,
  };
}

/** An area that takes drops as a whole: a heading, a column, a list. */
export function useDropArea(id: string, target: DropTarget) {
  const droppable = useDroppable({ id, data: target });
  const over = useTaskDrag((s) => s.over?.id === id);
  const dragging = useTaskDrag((s) => !!s.drag && fits(s.drag, target));
  return { ref: droppable.setNodeRef, over, dragging };
}

/** The line or slot that shows where a drop will land. */
export function DropMarker({ zone }: { zone: Zone | null }) {
  if (!zone || zone === "inside") return null;
  return (
    <span
      className={
        zone === "before"
          ? "pointer-events-none absolute inset-x-2 -top-px z-10 h-0.5 rounded-full bg-primary"
          : "pointer-events-none absolute inset-x-2 -bottom-px z-10 h-0.5 rounded-full bg-primary"
      }
    />
  );
}
