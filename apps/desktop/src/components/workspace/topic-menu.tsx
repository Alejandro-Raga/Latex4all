import { useEffect, useMemo, useState } from "react";
import {
  CheckIcon,
  HashIcon,
  LightbulbIcon,
  LinkIcon,
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
import { connectNotes } from "@/lib/vault/connect-notes";
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
      {note.kind !== "topic" && note.kind !== "idea" && (
        <TopicMenu
          group="idea"
          noteName={note.name}
          resolve={async () => note.name}
        />
      )}
      <ConnectNoteItem resolve={async () => note.name} />
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

const useConnectNote = create<{
  resolve: Resolve | null;
  ask: (resolve: Resolve) => void;
  close: () => void;
}>((set) => ({
  resolve: null,
  ask: (resolve) => set({ resolve }),
  close: () => set({ resolve: null }),
}));

/** "Connect to note…": links the note with any other in the vault. */
export function ConnectNoteItem({ resolve }: { resolve: Resolve }) {
  return (
    <ContextMenuItem onClick={() => useConnectNote.getState().ask(resolve)}>
      <LinkIcon className="size-3.5" />
      Connect to note…
    </ContextMenuItem>
  );
}

/** Picks the other note; mounted once, opened from any ConnectNoteItem. */
export function ConnectNoteDialog() {
  const resolve = useConnectNote((s) => s.resolve);
  const close = useConnectNote((s) => s.close);
  const index = useVaultStore((s) => s.index);
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState<string | null>(null);

  // The note may not exist yet (a paper from Zotero): made on opening.
  const [resolving, setResolving] = useState(false);
  const opened = resolve !== null;
  useEffect(() => {
    setFrom(null);
    setQuery("");
    if (!resolve) return;
    let cancelled = false;
    setResolving(true);
    resolve()
      .then((name) => !cancelled && setFrom(name))
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : String(err));
        close();
      })
      .finally(() => !cancelled && setResolving(false));
    return () => {
      cancelled = true;
    };
  }, [resolve, close]);

  const source = index && from ? findNote(index, from) : undefined;
  const matches = useMemo(() => {
    if (!index) return [];
    const q = query.trim().toLowerCase();
    return index.list
      .filter((n) => n.path !== source?.path)
      .filter((n) => !q || n.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 60);
  }, [index, query, source?.path]);

  const pick = (name: string) => {
    if (!from) return;
    close();
    const id = toast.loading(`Connecting to ${name}…`);
    connectNotes(from, name)
      .then((to) => toast.success(`${from} and ${to} are connected`, { id }))
      .catch((err) =>
        toast.error(err instanceof Error ? err.message : String(err), { id }),
      );
  };

  return (
    <Dialog open={opened} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="truncate">
            Connect {from ? `“${from}”` : "note"} to…
          </DialogTitle>
        </DialogHeader>
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (matches[0]) pick(matches[0].name);
          }}
        >
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes…"
            aria-label="Note to connect to"
            disabled={resolving}
          />
          <div className="max-h-72 overflow-y-auto">
            {matches.map((n) => {
              const linked =
                !!source &&
                (source.outgoing.includes(n.name) ||
                  n.outgoing.includes(source.name));
              return (
                <button
                  key={n.path}
                  type="button"
                  disabled={linked || resolving}
                  onClick={() => pick(n.name)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-muted disabled:opacity-50 disabled:hover:bg-transparent"
                >
                  {linked ? (
                    <CheckIcon className="size-3.5 shrink-0" />
                  ) : (
                    <LinkIcon className="size-3.5 shrink-0 opacity-40" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{n.name}</span>
                  <span className="shrink-0 text-muted-foreground text-xs">
                    {n.kind}
                  </span>
                </button>
              );
            })}
            {matches.length === 0 && (
              <p className="px-2 py-1 text-muted-foreground text-sm">
                No notes match.
              </p>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
