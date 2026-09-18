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
  type AnnotationSuggestion,
} from "@/lib/annotations/types";
import type { AnnotationActions } from "@/lib/annotations/actions";
import { cn } from "@/lib/utils";
import { useViewportAnchoredPosition } from "./use-viewport-anchored-position";

export const SWATCH_CLASSES: Record<
  (typeof ANNOTATION_COLORS)[number],
  string
> = {
  yellow: "bg-yellow-400",
  green: "bg-green-400",
  blue: "bg-blue-400",
  pink: "bg-pink-400",
  purple: "bg-violet-400",
};

const SELECTED_SWATCH =
  "ring-2 ring-foreground/40 ring-offset-1 ring-offset-background";

export function ColorSwatches({
  value,
  onPick,
  onClear,
}: {
  value?: AnnotationColor;
  onPick: (color: AnnotationColor) => void;
  /** Adds a "no highlight" swatch. */
  onClear?: () => void;
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
            value === color && SELECTED_SWATCH,
          )}
        />
      ))}
      {onClear && (
        <button
          type="button"
          aria-label="No highlight"
          title="No highlight"
          onClick={onClear}
          className={cn(
            "relative size-3.5 overflow-hidden rounded-full border border-muted-foreground/50 transition-transform hover:scale-110",
            value === "none" && SELECTED_SWATCH,
          )}
        >
          <span className="absolute top-1/2 left-1/2 h-px w-[140%] -translate-x-1/2 -translate-y-1/2 -rotate-45 bg-muted-foreground/70" />
        </button>
      )}
    </div>
  );
}

/** A text box that sends on Enter (Shift+Enter for a new line). */
export function NoteInput({
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

export function Comment({
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

export type { AnnotationActions } from "@/lib/annotations/actions";

/** What a suggestion would do: the text struck out, and what replaces it. */
export function SuggestionDiff({
  quote,
  text,
  className,
}: {
  quote: string;
  text: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "whitespace-pre-wrap break-words rounded bg-muted px-2 py-1.5 font-mono text-xs",
        className,
      )}
    >
      {quote && (
        <del className="text-muted-foreground decoration-muted-foreground/60">
          {quote}
        </del>
      )}
      {quote && text && " "}
      {text && (
        <ins className="text-green-700 no-underline dark:text-green-400">
          {text}
        </ins>
      )}
    </div>
  );
}

/** Who a suggestion is from, as a heading. */
export function suggestionTitle(
  suggestion: AnnotationSuggestion,
  authorName: string,
) {
  if (suggestion.conflict) {
    if (!suggestion.text) return "Deleted by someone else at the same time";
    return suggestion.author === authorName
      ? "Your version"
      : `${suggestion.author || "Someone else"}'s version`;
  }
  return suggestion.author === authorName
    ? "You suggested"
    : `${suggestion.author} suggested`;
}

/** Accept and reject, worded for what's being settled. */
export function SuggestionButtons({
  suggestion,
  onSettle,
}: {
  suggestion: AnnotationSuggestion;
  onSettle: (accept: boolean) => void;
}) {
  const accept = suggestion.conflict
    ? suggestion.text
      ? "Use this"
      : "Delete it"
    : "Accept";
  return (
    <div className="flex gap-1.5">
      <Button
        size="sm"
        className="h-6 gap-1 px-2 text-xs"
        onClick={() => onSettle(true)}
      >
        <CheckIcon className="size-3" />
        {accept}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 gap-1 px-2 text-xs"
        onClick={() => onSettle(false)}
      >
        <XIcon className="size-3" />
        {suggestion.conflict ? "Keep current" : "Reject"}
      </Button>
    </div>
  );
}

/** Writing a suggestion: the selected text, to edit into what it should be. */
function SuggestionInput({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const changed = text !== initial;
  return (
    <div className="space-y-1.5">
      <textarea
        ref={ref}
        rows={1}
        value={text}
        placeholder="Delete it"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (changed) onSubmit(text);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
        }}
        className="w-full resize-none rounded-md border border-input bg-transparent px-2 py-1.5 font-mono text-xs outline-none placeholder:text-muted-foreground focus:border-ring"
      />
      <div className="flex justify-end gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          className="h-6 px-2 text-xs"
          disabled={!changed}
          onClick={() => onSubmit(text)}
        >
          Suggest
        </Button>
      </div>
    </div>
  );
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
  quote = "",
  composing = "note",
  onCompose,
  onSuggest,
  onDismiss,
  onPointerEnter,
  onPointerLeave,
  onFocusChange,
}: {
  annotation: Annotation | null;
  authorName: string;
  anchor: { x: number; y: number };
  actions: AnnotationActions | null;
  /** The annotated (or selected) text as it is now. */
  quote?: string;
  /** For `annotation === null`: writing a note, or suggesting an edit. */
  composing?: "note" | "suggest";
  /** Writing a new note, for `annotation === null`. */
  onCompose?: (text: string) => void;
  /** Suggesting `quote` be replaced with this. */
  onSuggest?: (text: string) => void;
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
      {annotation?.suggestion && actions ? (
        <>
          <div className="flex items-center gap-1.5 text-xs">
            {annotation.suggestion.authorColor && (
              <span
                className="size-2 shrink-0 rounded-full"
                style={{
                  backgroundColor: annotation.suggestion.authorColor,
                }}
              />
            )}
            <span className="truncate font-medium">
              {suggestionTitle(annotation.suggestion, authorName)}
            </span>
            {annotation.suggestion.at > 0 && (
              <span className="shrink-0 text-muted-foreground">
                {formatDistanceToNowStrict(annotation.suggestion.at, {
                  addSuffix: true,
                })}
              </span>
            )}
          </div>
          <SuggestionDiff
            quote={quote}
            text={annotation.suggestion.text}
            className="max-h-40 overflow-y-auto"
          />
          <SuggestionButtons
            suggestion={annotation.suggestion}
            onSettle={actions.settleSuggestion}
          />
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
          <NoteInput placeholder="Reply…" onSubmit={actions.addComment} />
        </>
      ) : !annotation && composing === "suggest" ? (
        <SuggestionInput
          initial={quote}
          onSubmit={(text) => onSuggest?.(text)}
          onCancel={onDismiss}
        />
      ) : !annotation || !actions ? (
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
            <ColorSwatches
              value={annotation.color}
              onPick={actions.setColor}
              onClear={actions.clearHighlight}
            />
            {annotation.resolved && (
              <span className="text-muted-foreground text-xs">Resolved</span>
            )}
            <button
              type="button"
              aria-label="Delete"
              title="Delete"
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
