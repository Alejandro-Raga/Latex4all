import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatDistanceToNowStrict } from "date-fns";
import {
  CheckIcon,
  PencilIcon,
  RotateCcwIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ANNOTATION_COLORS,
  type Annotation,
  type AnnotationColor,
  type AnnotationComment,
} from "@/lib/annotations/types";
import { cn } from "@/lib/utils";
import { useViewportAnchoredPosition } from "./use-viewport-anchored-position";

export const SWATCH_CLASSES: Record<AnnotationColor, string> = {
  yellow: "bg-yellow-400",
  green: "bg-green-400",
  blue: "bg-blue-400",
  pink: "bg-pink-400",
  purple: "bg-violet-400",
};

export function ColorSwatches({
  value,
  onPick,
}: {
  value?: AnnotationColor;
  onPick: (color: AnnotationColor) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {ANNOTATION_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={`${color} highlight`}
          onClick={() => onPick(color)}
          className={cn(
            "size-3.5 rounded-full transition-transform hover:scale-110",
            SWATCH_CLASSES[color],
            value === color &&
              "ring-2 ring-foreground/40 ring-offset-1 ring-offset-background",
          )}
        />
      ))}
    </div>
  );
}

/** A text box that sends on Enter (Shift+Enter for a new line). */
function NoteInput({
  placeholder,
  initial = "",
  autoFocus,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  placeholder: string;
  initial?: string;
  autoFocus?: boolean;
  submitLabel?: string;
  onSubmit: (text: string) => void;
  onCancel?: () => void;
}) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Focused on appearing when asked to, e.g. a new note or an edit.
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setText("");
  };

  return (
    <div className="space-y-1.5">
      <textarea
        ref={ref}
        rows={1}
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape" && onCancel) {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
        }}
        className="w-full resize-none rounded-md border border-input bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus:border-ring"
      />
      {(submitLabel || onCancel) && (
        <div className="flex justify-end gap-1.5">
          {onCancel && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={onCancel}
            >
              Cancel
            </Button>
          )}
          {submitLabel && (
            <Button
              size="sm"
              className="h-6 px-2 text-xs"
              disabled={!text.trim()}
              onClick={submit}
            >
              {submitLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function Comment({
  comment,
  mine,
  onEdit,
  onDelete,
}: {
  comment: AnnotationComment;
  mine: boolean;
  onEdit: (text: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="group/comment space-y-0.5">
      <div className="flex items-center gap-1.5 text-xs">
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: comment.authorColor }}
        />
        <span className="truncate font-medium">{comment.author}</span>
        <span className="shrink-0 text-muted-foreground">
          {formatDistanceToNowStrict(comment.at, { addSuffix: true })}
          {comment.edited ? " · edited" : ""}
        </span>
        {mine && !editing && (
          <span className="ml-auto flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover/comment:opacity-100">
            <button
              type="button"
              aria-label="Edit"
              onClick={() => setEditing(true)}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <PencilIcon className="size-3" />
            </button>
            <button
              type="button"
              aria-label="Delete"
              onClick={onDelete}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <XIcon className="size-3" />
            </button>
          </span>
        )}
      </div>
      {editing ? (
        <NoteInput
          placeholder="Edit note"
          initial={comment.text}
          autoFocus
          submitLabel="Save"
          onSubmit={(text) => {
            onEdit(text);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <p className="whitespace-pre-wrap break-words pl-3.5 text-sm">
          {comment.text}
        </p>
      )}
    </div>
  );
}

export interface AnnotationActions {
  setColor: (color: AnnotationColor) => void;
  addComment: (text: string) => void;
  editComment: (commentId: string, text: string) => void;
  deleteComment: (commentId: string) => void;
  setResolved: (resolved: boolean) => void;
  remove: () => void;
}

const CARD_WIDTH = 288;

/**
 * Shown when hovering a highlight: its thread and what can be done with it.
 * With no annotation, it's the box for writing a new note.
 */
export function AnnotationCard({
  annotation,
  authorName,
  anchor,
  actions,
  onCompose,
  onDismiss,
  onPointerEnter,
  onPointerLeave,
  onFocusChange,
}: {
  annotation: Annotation | null;
  authorName: string;
  anchor: { x: number; y: number };
  actions: AnnotationActions | null;
  /** Writing a new note, for `annotation === null`. */
  onCompose?: (text: string) => void;
  onDismiss: () => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  /** While something inside has focus, hovering away mustn't close it. */
  onFocusChange: (focused: boolean) => void;
}) {
  const { ref, coords } = useViewportAnchoredPosition(anchor);
  const [addingNote, setAddingNote] = useState(false);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleMouseDown);
      document.addEventListener("keydown", handleKeyDown);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onDismiss, ref]);

  const comments = annotation?.comments ?? [];

  return createPortal(
    <div
      ref={ref}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onFocus={() => onFocusChange(true)}
      onBlur={(e) => {
        if (!ref.current?.contains(e.relatedTarget as Node))
          onFocusChange(false);
      }}
      className="fixed z-50 space-y-2.5 rounded-lg border border-border bg-background p-3 shadow-lg"
      style={{
        width: CARD_WIDTH,
        top: coords ? coords.top : anchor.y,
        left: coords ? coords.left : anchor.x,
        visibility: coords ? "visible" : "hidden",
      }}
    >
      {!annotation || !actions ? (
        <NoteInput
          placeholder="Add a note…"
          autoFocus
          submitLabel="Add"
          onSubmit={(text) => onCompose?.(text)}
          onCancel={onDismiss}
        />
      ) : (
        <>
          <div className="flex items-center gap-2">
            <ColorSwatches value={annotation.color} onPick={actions.setColor} />
            {annotation.resolved && (
              <span className="text-muted-foreground text-xs">Resolved</span>
            )}
            <button
              type="button"
              aria-label="Remove highlight"
              title="Remove highlight"
              onClick={actions.remove}
              className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Trash2Icon className="size-3.5" />
            </button>
          </div>

          {comments.length > 0 && (
            <div className="max-h-64 space-y-2.5 overflow-y-auto">
              {comments.map((comment) => (
                <Comment
                  key={comment.id}
                  comment={comment}
                  mine={comment.author === authorName}
                  onEdit={(text) => actions.editComment(comment.id, text)}
                  onDelete={() => actions.deleteComment(comment.id)}
                />
              ))}
            </div>
          )}

          {comments.length > 0 ? (
            <div className="flex items-start gap-1.5">
              <div className="min-w-0 flex-1">
                <NoteInput placeholder="Reply…" onSubmit={actions.addComment} />
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-[30px] shrink-0 gap-1 px-2 text-xs"
                onClick={() => actions.setResolved(!annotation.resolved)}
              >
                {annotation.resolved ? (
                  <>
                    <RotateCcwIcon className="size-3" />
                    Reopen
                  </>
                ) : (
                  <>
                    <CheckIcon className="size-3" />
                    Resolve
                  </>
                )}
              </Button>
            </div>
          ) : addingNote ? (
            <NoteInput
              placeholder="Add a note…"
              autoFocus
              submitLabel="Add"
              onSubmit={(text) => {
                actions.addComment(text);
                setAddingNote(false);
              }}
              onCancel={() => setAddingNote(false)}
            />
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-full justify-start px-1.5 text-muted-foreground text-xs"
              onClick={() => setAddingNote(true)}
            >
              Add note
            </Button>
          )}
        </>
      )}
    </div>,
    document.body,
  );
}
