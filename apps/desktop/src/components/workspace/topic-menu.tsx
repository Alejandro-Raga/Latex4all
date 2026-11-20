import { useMemo, useState } from "react";
import {
  ListPlusIcon,
  CheckIcon,
  LinkIcon,
  NotebookPenIcon,
  PencilIcon,
  PlusIcon,
  ShapesIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { create } from "zustand";
import { useQuickTask } from "@/components/planner/quick-task";
import { useRenameNote } from "./rename-note";
import { AddToReadingMenu } from "@/components/planner/reading-menu";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { linkNotes } from "@/lib/vault/connect-notes";
import { createNoteOfKind } from "@/lib/vault/new-note";
import { chooseNoteKind, deleteNote } from "@/lib/vault/note-changes";
import {
  findNote,
  KIND_GROUPS,
  type NoteKind,
  type VaultNote,
} from "@/lib/vault/vault-index";
import { useKindChoices, useVaultStore } from "@/stores/vault-store";

/** The note a menu acts on: its name, found (or made) when chosen. */
type Resolve = () => Promise<string>;

/** Papers come from Zotero and projects from their folders: not made here. */
const canCreate = (kind: NoteKind) => kind !== "paper" && kind !== "project";

/** A new note being named; `then` gets the note once it's made. */
const useNewNote = create<{
  kind: NoteKind | null;
  label: string;
  then: ((note: string) => Promise<void> | void) | null;
  ask: (
    kind: NoteKind,
    label: string,
    then: (note: string) => Promise<void> | void,
  ) => void;
  close: () => void;
}>((set) => ({
  kind: null,
  label: "",
  then: null,
  ask: (kind, label, then) => set({ kind, label, then }),
  close: () => set({ kind: null, then: null }),
}));

/**
 * Names a new note of a type, offering the ones by a similar name instead of
 * a near-duplicate. Mounted once, opened from any "New …" in a note menu.
 */
export function NewNoteDialog() {
  const kind = useNewNote((s) => s.kind);
  const label = useNewNote((s) => s.label);
  const then = useNewNote((s) => s.then);
  const close = useNewNote((s) => s.close);
  const index = useVaultStore((s) => s.index);
  const [name, setName] = useState("");
  const typed = name.trim().toLowerCase();
  const similar = useMemo(
    () =>
      !index || !typed || !kind
        ? []
        : index.list
            .filter(
              (n) => n.kind === kind && n.title.toLowerCase().includes(typed),
            )
            .slice(0, 6),
    [index, typed, kind],
  );
  const finish = (pick: () => Promise<string>) => {
    const after = then;
    setName("");
    close();
    pick()
      .then((note) => after?.(note))
      .catch((err) =>
        toast.error(err instanceof Error ? err.message : String(err)),
      );
  };
  return (
    <Dialog
      open={kind !== null}
      onOpenChange={(open) => {
        if (!open) {
          setName("");
          close();
        }
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New {label.toLowerCase()}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const title = name.trim();
            if (kind && title) finish(() => createNoteOfKind(kind, title));
          }}
        >
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Title"
            aria-label="Title of the new note"
          />
          {similar.length > 0 && (
            <div className="space-y-1">
              <p className="text-muted-foreground text-xs">Or one you have:</p>
              <div className="flex flex-wrap gap-1.5">
                {similar.map((n) => (
                  <button
                    key={n.path}
                    type="button"
                    onClick={() => finish(async () => n.name)}
                    className="max-w-full truncate rounded-full border border-border px-2 py-0.5 text-xs hover:bg-muted"
                    title={n.title}
                  >
                    {n.title}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={!name.trim()}>
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
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

/** Everything a note's right-click offers: its type, its links, deleting it. */
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
      <ConnectNoteMenu noteName={note.name} resolve={async () => note.name} />
      <ContextMenuItem
        onClick={() =>
          useQuickTask
            .getState()
            .show({ pin: { name: note.name, title: note.title } })
        }
      >
        <ListPlusIcon className="size-3.5" />
        Add a task
      </ContextMenuItem>
      {note.kind === "paper" && (
        <AddToReadingMenu
          paper={{ title: note.title, itemKey: note.zoteroKey ?? undefined }}
        />
      )}
      <ContextMenuSeparator />
      <ContextMenuItem onClick={() => useRenameNote.getState().show(note.name)}>
        <PencilIcon className="size-3.5" />
        Rename…
      </ContextMenuItem>
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

/** A paper's first author and year, as the vault lists show them. */
function byline(note: VaultNote): string {
  if (note.kind !== "paper") return "";
  const author = note.authors[0]?.split(",")[0].split(" ").pop();
  return [author, note.year].filter(Boolean).join(" · ");
}

async function connectTo(resolve: Resolve, other: string) {
  const id = toast.loading("Connecting…");
  try {
    const note = await resolve();
    await linkNotes(note, other);
    const index = useVaultStore.getState().index;
    const shown = (index && findNote(index, other)?.title) || other;
    toast.success(`Connected to ${shown}`, { id });
  } catch (err) {
    toast.error(err instanceof Error ? err.message : String(err), { id });
  }
}

/** The menu parts a list of notes is drawn with: a right-click's or a dropdown's. */
interface MenuParts {
  Sub: typeof ContextMenuSub;
  SubTrigger: typeof ContextMenuSubTrigger;
  SubContent: typeof ContextMenuSubContent;
  Item: typeof ContextMenuItem;
  Separator: typeof ContextMenuSeparator;
}

const CONTEXT_PARTS: MenuParts = {
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
};

const DROPDOWN_PARTS = {
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
} as unknown as MenuParts;

/**
 * The vault's notes by type (Papers, Topics, …), one submenu each, shown as
 * the lists show them, with a new one of that type at the end; `done` ticks
 * the ones it's connected to already.
 */
function NotesByType({
  parts: { Sub, SubTrigger, SubContent, Item, Separator },
  exclude,
  done,
  onPick,
}: {
  parts: MenuParts;
  exclude?: string;
  done: (note: VaultNote) => boolean;
  /** The note picked, by name: one listed, or one just made. */
  onPick: (note: string) => void;
}) {
  const index = useVaultStore((s) => s.index);
  const choices = useKindChoices();
  const groups = useMemo(() => {
    const byKind = new Map<string, VaultNote[]>();
    for (const n of index?.list ?? []) {
      if (n.path === exclude) continue;
      const list = byKind.get(n.kind) ?? [];
      list.push(n);
      byKind.set(n.kind, list);
    }
    return choices
      .map(({ kind, label }) => ({
        kind,
        label,
        plural:
          kind === "note"
            ? "Notes"
            : ((KIND_GROUPS as Record<string, string>)[kind] ?? label),
        notes: (byKind.get(kind) ?? []).sort((a, b) =>
          a.title.localeCompare(b.title, undefined, { numeric: true }),
        ),
      }))
      .filter((g) => g.notes.length > 0 || canCreate(g.kind));
  }, [index, choices, exclude]);
  return groups.map((g) => (
    <Sub key={g.kind}>
      <SubTrigger>
        <span className="flex-1 text-left">{g.plural}</span>
        <span className="text-muted-foreground text-xs">{g.notes.length}</span>
      </SubTrigger>
      <SubContent className="glass max-h-80 w-72 overflow-y-auto">
        {g.notes.map((n) => {
          const linked = done(n);
          return (
            <Item
              key={n.path}
              disabled={linked}
              onClick={() => onPick(n.name)}
              className="items-start"
            >
              {linked ? (
                <CheckIcon className="mt-0.5 size-3.5" />
              ) : (
                <LinkIcon className="mt-0.5 size-3.5 opacity-40" />
              )}
              <span className="min-w-0 flex-1" title={n.title}>
                <span className="line-clamp-2">{n.title}</span>
                {byline(n) && (
                  <span className="block truncate text-muted-foreground text-xs">
                    {byline(n)}
                  </span>
                )}
              </span>
            </Item>
          );
        })}
        {canCreate(g.kind) && (
          <>
            {g.notes.length > 0 && <Separator />}
            <Item
              onClick={() => useNewNote.getState().ask(g.kind, g.label, onPick)}
            >
              <PlusIcon className="size-3.5" />
              New {g.label.toLowerCase()}…
            </Item>
          </>
        )}
      </SubContent>
    </Sub>
  ));
}

/**
 * "Connect to note ▸" in a right-click menu: the note links with any other,
 * picked by type, or a new one.
 */
export function ConnectNoteMenu({
  noteName,
  resolve,
}: {
  /** Known when the note exists already, to tick its links. */
  noteName?: string;
  resolve: Resolve;
}) {
  const source = useVaultStore((s) =>
    s.index && noteName ? findNote(s.index, noteName) : undefined,
  );
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <LinkIcon className="size-3.5" />
        <span className="flex-1 text-left">Connect to note</span>
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="w-44">
        <NotesByType
          parts={CONTEXT_PARTS}
          exclude={source?.path}
          done={(n) =>
            !!source &&
            (source.outgoing.includes(n.name) ||
              n.outgoing.includes(source.name))
          }
          onPick={(n) => connectTo(resolve, n)}
        />
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

/**
 * "Add to note ▸" in a right-click menu, for a passage: quoted in the note
 * picked, by type, or in a new one. `marker` ticks the notes quoting it.
 */
export function AddToNoteMenu({
  marker,
  exclude,
  onPick,
}: {
  marker?: string;
  /** The note it's shown in, not offered. */
  exclude?: string;
  onPick: (note: string) => void;
}) {
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <NotebookPenIcon className="size-3.5" />
        <span className="flex-1 text-left">Add to note</span>
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="w-44">
        <NotesByType
          parts={CONTEXT_PARTS}
          exclude={exclude}
          done={(n) => !!marker && n.body.includes(marker)}
          onPick={onPick}
        />
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

/**
 * The same notes by type, as a menu opened at a point: for what isn't a note
 * itself, a highlight or a selected passage, which is quoted in the note.
 */
export function NoteMenuAt({
  anchor,
  done,
  onPick,
  onClose,
  label = "Add to note",
}: {
  anchor: { left: number; top: number };
  done: (note: VaultNote) => boolean;
  onPick: (note: string) => void;
  onClose: () => void;
  /** Over the list: what picking one does. */
  label?: string;
}) {
  return (
    <DropdownMenu open onOpenChange={(open) => !open && onClose()}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          className="pointer-events-none fixed size-0"
          style={{ left: anchor.left, top: anchor.top }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="glass w-44">
        <DropdownMenuLabel className="text-muted-foreground text-xs">
          {label}
        </DropdownMenuLabel>
        <NotesByType
          parts={DROPDOWN_PARTS}
          done={done}
          onPick={(n) => {
            onClose();
            onPick(n);
          }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
