import { useMemo, useState } from "react";
import {
  CheckIcon,
  HashIcon,
  LightbulbIcon,
  PlusIcon,
  ShapesIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { create } from "zustand";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { connectToIdea, connectToTopic } from "@/lib/vault/connect-topic";
import { chooseNoteKind, deleteNote } from "@/lib/vault/note-changes";
import { findNote, type NoteKind } from "@/lib/vault/vault-index";
import { topicNotes, topicsOf } from "@/lib/vault/topics";
import { useKindChoices, useVaultStore } from "@/stores/vault-store";

/** The note a menu acts on: its name, found (or made) when chosen. */
type Resolve = () => Promise<string>;

type Group = "topic" | "idea";

const useNewTopic = create<{
  resolve: Resolve | null;
  group: Group;
  ask: (resolve: Resolve, group?: Group) => void;
  close: () => void;
}>((set) => ({
  resolve: null,
  group: "topic",
  ask: (resolve, group = "topic") => set({ resolve, group }),
  close: () => set({ resolve: null }),
}));

async function connect(resolve: Resolve, topic: string, group: Group) {
  const id = toast.loading(`Connecting to ${topic}…`);
  try {
    const note = await resolve();
    const name = await (group === "idea" ? connectToIdea : connectToTopic)(
      note,
      topic,
    );
    toast.success(`${note} is in ${name}`, { id });
  } catch (err) {
    toast.error(err instanceof Error ? err.message : String(err), { id });
  }
}

/**
 * "Connect to topic ▸": the vault's topics (ticked where the note is in
 * one already), and a new one.
 */
export function TopicMenu({
  noteName,
  resolve,
  group = "topic",
}: {
  /** Known when the note exists already, to tick its topics. */
  noteName?: string;
  resolve: Resolve;
  /** "idea": the same, for the vault's ideas. */
  group?: Group;
}) {
  const index = useVaultStore((s) => s.index);
  const topics = useMemo(
    () =>
      !index
        ? []
        : group === "idea"
          ? index.list
              .filter((n) => n.kind === "idea")
              .sort((a, b) => a.name.localeCompare(b.name))
          : topicNotes(index),
    [index, group],
  );
  const note = index && noteName ? findNote(index, noteName) : undefined;
  const joined =
    index && note
      ? group === "idea"
        ? new Set(
            topics
              .filter((t) => t.outgoing.includes(note.name))
              .map((t) => t.name),
          )
        : topicsOf(index, note)
      : new Set<string>();
  const Icon = group === "idea" ? LightbulbIcon : HashIcon;
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <Icon className="size-3.5" />
        <span className="flex-1 text-left">
          Connect to {group === "idea" ? "idea" : "topic"}
        </span>
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="max-h-80 w-56 overflow-y-auto">
        {topics.map((t) => (
          <ContextMenuItem
            key={t.path}
            disabled={joined.has(t.name)}
            onClick={() => connect(resolve, t.name, group)}
          >
            {joined.has(t.name) ? (
              <CheckIcon className="size-3.5" />
            ) : (
              <Icon className="size-3.5 opacity-40" />
            )}
            <span className="truncate">{t.name}</span>
          </ContextMenuItem>
        ))}
        {topics.length > 0 && <ContextMenuSeparator />}
        <ContextMenuItem
          onClick={() => useNewTopic.getState().ask(resolve, group)}
        >
          <PlusIcon className="size-3.5" />
          New {group === "idea" ? "idea" : "topic"}…
        </ContextMenuItem>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

/**
 * "Type ▸": what a note is (paper, project, topic, idea, note), picked by
 * hand when the vault's own signs point the wrong way, or back to what
 * Latex4All finds.
 */
export function NoteKindMenu({ noteName }: { noteName: string }) {
  const note = useVaultStore((s) =>
    s.index ? findNote(s.index, noteName) : undefined,
  );
  const choices = useKindChoices();
  if (!note) return null;
  const set = (kind: NoteKind | null) =>
    chooseNoteKind(note.name, kind)
      .then((moved) => {
        if (moved) toast.success(`Moved ${note.name} to ${moved}`);
      })
      .catch((err) =>
        toast.error(
          `Couldn't move ${note.name}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <ShapesIcon className="size-3.5" />
        Type
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="w-44">
        {choices.map(({ kind, label }) => (
          <ContextMenuItem key={kind} onClick={() => set(kind)}>
            {note.kind === kind ? (
              <CheckIcon className="size-3.5" />
            ) : (
              <span className="size-3.5" />
            )}
            {label}
          </ContextMenuItem>
        ))}
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!note.kindChosen} onClick={() => set(null)}>
          <span className="size-3.5" />
          Automatic
        </ContextMenuItem>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

/** "Delete note…", after saying what links to it. */
export function DeleteNoteItem({ noteName }: { noteName: string }) {
  const note = useVaultStore((s) =>
    s.index ? findNote(s.index, noteName) : undefined,
  );
  if (!note) return null;
  return (
    <ContextMenuItem
      variant="destructive"
      onClick={() => {
        const links = note.incoming.length;
        if (
          !window.confirm(
            `Delete “${note.name}” from the vault?${
              links
                ? ` ${links} note${links === 1 ? " links" : "s link"} to it; ${links === 1 ? "that link" : "those links"} will point nowhere.`
                : ""
            }`,
          )
        )
          return;
        deleteNote(note.path)
          .then(() => toast.success(`Deleted ${note.name}`))
          .catch((err) =>
            toast.error(err instanceof Error ? err.message : String(err)),
          );
      }}
    >
      <Trash2Icon className="size-3.5" />
      Delete note…
    </ContextMenuItem>
  );
}

/** Names a new topic; mounted once, opened from any TopicMenu. */
export function NewTopicDialog() {
  const resolve = useNewTopic((s) => s.resolve);
  const group = useNewTopic((s) => s.group);
  const close = useNewTopic((s) => s.close);
  const index = useVaultStore((s) => s.index);
  const [name, setName] = useState("");
  const existing = useMemo(
    () =>
      !index
        ? []
        : group === "idea"
          ? index.list.filter((n) => n.kind === "idea").map((n) => n.name)
          : topicNotes(index).map((t) => t.name),
    [index, group],
  );
  // Close to an existing topic? Offer it, rather than a near-duplicate.
  const similar = name.trim()
    ? existing.filter((t) =>
        t.toLowerCase().includes(name.trim().toLowerCase()),
      )
    : [];
  const submit = (topic: string) => {
    if (!resolve || !topic.trim()) return;
    connect(resolve, topic.trim(), group);
    setName("");
    close();
  };
  return (
    <Dialog
      open={resolve !== null}
      onOpenChange={(open) => {
        if (!open) {
          setName("");
          close();
        }
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New {group === "idea" ? "idea" : "topic"}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit(name);
          }}
        >
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Absorptive capacity"
            aria-label={group === "idea" ? "Idea name" : "Topic name"}
          />
          {similar.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {similar.slice(0, 6).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => submit(t)}
                  className="rounded-full border border-border px-2 py-0.5 text-xs hover:bg-muted"
                >
                  # {t}
                </button>
              ))}
            </div>
          )}
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={!name.trim()}>
              Connect
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Everything a note's right-click offers: its type, its topics, deleting it. */
export function NoteMenuItems({ noteName }: { noteName: string }) {
  const note = useVaultStore((s) =>
    s.index ? findNote(s.index, noteName) : undefined,
  );
  if (!note) {
    return <ContextMenuItem disabled>No note by this name yet</ContextMenuItem>;
  }
  return (
    <>
      <NoteKindMenu noteName={note.name} />
      {note.kind !== "topic" && (
        <TopicMenu noteName={note.name} resolve={async () => note.name} />
      )}
      <ContextMenuSeparator />
      <DeleteNoteItem noteName={note.name} />
    </>
  );
}

/** A note anywhere it's listed, with its right-click menu. */
export function NoteContextMenu({
  noteName,
  children,
}: {
  noteName: string;
  children: React.ReactElement;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <NoteMenuItems noteName={noteName} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
