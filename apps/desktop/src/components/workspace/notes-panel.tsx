import { useMemo, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { CheckIcon, RotateCcwIcon, Trash2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Comment,
  NoteInput,
  SWATCH_CLASSES,
  SuggestionDiff,
  suggestionTitle,
} from "@/components/workspace/editor/annotation-card";
import type { Annotation } from "@/lib/annotations/types";
import { cn } from "@/lib/utils";
import { currentAuthor, useAnnotationsStore } from "@/stores/annotations-store";
import { useDocumentStore } from "@/stores/document-store";
import { SidePanelHeader } from "./side-panel-header";

interface Note {
  path: string;
  annotation: Annotation;
  quote: string;
}

function barClass(annotation: Annotation) {
  if (annotation.suggestion?.conflict) return "bg-orange-500";
  if (annotation.suggestion) return "bg-green-500";
  if (annotation.resolved) return "bg-slate-400/60";
  if (annotation.color === "none") return "bg-muted-foreground/30";
  return SWATCH_CLASSES[annotation.color];
}

function NoteItem({
  note,
  showFile,
  expanded,
  onOpen,
}: {
  note: Note;
  showFile: boolean;
  /** Showing the whole thread and a reply box. */
  expanded: boolean;
  onOpen: () => void;
}) {
  const source = useAnnotationsStore((s) => s.source);
  const { annotation } = note;
  const { suggestion } = annotation;
  const [first] = annotation.comments;
  // A suggestion's thread is all replies; a note's starts with the note.
  const thread = suggestion
    ? annotation.comments
    : annotation.comments.slice(1);
  const replies = thread.length;
  const latestAt =
    annotation.comments[annotation.comments.length - 1]?.at ??
    suggestion?.at ??
    0;
  const who = suggestion
    ? {
        name: suggestionTitle(suggestion, currentAuthor().name),
        color: suggestion.authorColor,
      }
    : { name: first.author, color: first.authorColor };

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted/60"
      >
        <span
          className={cn(
            "w-0.5 shrink-0 self-stretch rounded-full",
            barClass(annotation),
          )}
        />
        <span className="min-w-0 flex-1 space-y-1">
          {suggestion ? (
            <>
              {showFile && (
                <span className="block text-muted-foreground text-xs">
                  {note.path.split("/").pop()}
                </span>
              )}
              <SuggestionDiff
                quote={note.quote}
                text={suggestion.text}
                className={cn(!expanded && "line-clamp-3")}
              />
            </>
          ) : (
            <>
              {note.quote && (
                <span className="line-clamp-1 block text-muted-foreground text-xs italic">
                  {showFile && (
                    <span className="not-italic">
                      {note.path.split("/").pop()} ·{" "}
                    </span>
                  )}
                  “{note.quote}”
                </span>
              )}
              <span
                className={cn(
                  "block whitespace-pre-wrap break-words text-sm",
                  !expanded && "line-clamp-3",
                )}
              >
                {first.text}
              </span>
            </>
          )}
          <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
            {who.color && (
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: who.color }}
              />
            )}
            <span className="truncate">{who.name}</span>
            {replies > 0 && (
              <span className="shrink-0">
                · {replies} {replies === 1 ? "reply" : "replies"}
              </span>
            )}
            {latestAt > 0 && (
              <span className="shrink-0">
                · {formatDistanceToNowStrict(latestAt, { addSuffix: true })}
              </span>
            )}
          </span>
        </span>
      </button>
      {expanded && source && (
        <div className="space-y-2.5 px-2 pt-1 pb-2.5 pl-4">
          {thread.map((comment) => (
            <Comment
              key={comment.id}
              comment={comment}
              mine={comment.author === currentAuthor().name}
              onEdit={(text) =>
                source.editComment(annotation.id, comment.id, text)
              }
              onDelete={() => source.deleteComment(annotation.id, comment.id)}
            />
          ))}
          <NoteInput
            placeholder="Reply…"
            onSubmit={(text) =>
              source.addComment(annotation.id, currentAuthor(), text)
            }
          />
        </div>
      )}
      {source && (
        <div className="absolute top-1.5 right-1.5 flex gap-0.5 rounded-md bg-background/90 opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
          {suggestion ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                title={suggestion.conflict ? "Use this" : "Accept"}
                aria-label={suggestion.conflict ? "Use this" : "Accept"}
                onClick={() =>
                  source.settleSuggestion(annotation.id, true, currentAuthor())
                }
              >
                <CheckIcon className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                title={suggestion.conflict ? "Keep current" : "Reject"}
                aria-label={suggestion.conflict ? "Keep current" : "Reject"}
                onClick={() =>
                  source.settleSuggestion(annotation.id, false, currentAuthor())
                }
              >
                <XIcon className="size-3.5" />
              </Button>
            </>
          ) : annotation.resolved ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                title="Reopen"
                aria-label="Reopen"
                onClick={() => source.setResolved(annotation.id, false)}
              >
                <RotateCcwIcon className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                title="Delete"
                aria-label="Delete"
                onClick={() => source.remove(annotation.id)}
              >
                <Trash2Icon className="size-3" />
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              title="Resolve"
              aria-label="Resolve"
              onClick={() => source.setResolved(annotation.id, true)}
            >
              <CheckIcon className="size-3.5" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Every note and suggested edit in the project: settle them, and jump to
 * where they are.
 */
export function NotesPanel({ onClose }: { onClose: () => void }) {
  const source = useAnnotationsStore((s) => s.source);
  const version = useAnnotationsStore((s) => s.version);
  const files = useDocumentStore((s) => s.files);
  const [tab, setTab] = useState<"open" | "resolved">("open");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const notes = useMemo<Note[]>(() => {
    if (!source) return [];
    return source
      .listAll()
      .filter(
        ({ annotation }) =>
          annotation.comments.length > 0 || annotation.suggestion,
      )
      .map(({ path, annotation }) => {
        const content = files.find((f) => f.relativePath === path)?.content;
        const quote = (content?.slice(annotation.from, annotation.to) ?? "")
          .replace(/\s+/g, " ")
          .trim();
        return { path, annotation, quote };
      })
      .sort((a, b) =>
        a.path === b.path
          ? a.annotation.from - b.annotation.from
          : a.path.localeCompare(b.path),
      );
  }, [source, version, files]);

  const open = notes.filter((n) => !n.annotation.resolved);
  const resolved = notes.filter((n) => n.annotation.resolved);
  const shown = tab === "open" ? open : resolved;
  const manyFiles = new Set(notes.map((n) => n.path)).size > 1;

  const goTo = (note: Note) => {
    const documents = useDocumentStore.getState();
    if (documents.activeFileId !== note.path)
      documents.setActiveFile(note.path);
    documents.requestJumpToPosition(note.annotation.from);
  };

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      <SidePanelHeader onClose={onClose} />

      <div className="px-3 pt-2.5 pb-1">
        <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-0.5">
          {(
            [
              ["open", "Open", open.length],
              ["resolved", "Resolved", resolved.length],
            ] as const
          ).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={cn(
                "rounded px-2 py-1 text-xs transition-colors",
                tab === value
                  ? "bg-background font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
              {count > 0 && (
                <span className="ml-1 text-muted-foreground">{count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {shown.length === 0 ? (
          <p className="px-3 py-6 text-center text-muted-foreground text-xs">
            {tab === "open" ? "No open notes" : "No resolved notes"}
          </p>
        ) : (
          shown.map((note) => (
            <NoteItem
              key={note.annotation.id}
              note={note}
              showFile={manyFiles}
              expanded={expandedId === note.annotation.id}
              onOpen={() => {
                goTo(note);
                setExpandedId((id) =>
                  id === note.annotation.id ? null : note.annotation.id,
                );
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}
