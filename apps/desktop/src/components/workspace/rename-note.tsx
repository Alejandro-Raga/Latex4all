/**
 * Renaming a vault note from its right-click menu: the file takes the new
 * name, and every link to it follows.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { create } from "zustand";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NoteExistsError } from "@/lib/vault/load";
import { renameNote } from "@/lib/vault/note-changes";
import { findNote } from "@/lib/vault/vault-index";
import { useVaultStore } from "@/stores/vault-store";

export const useRenameNote = create<{
  /** The note being renamed, by name. */
  name: string | null;
  show: (name: string) => void;
  hide: () => void;
}>((set) => ({
  name: null,
  show: (name) => set({ name }),
  hide: () => set({ name: null }),
}));

/** Characters a note's name can't have (a file name, and a link). */
const NOT_ALLOWED = /[\\/:*?"<>|#^[\]]/;

/** What's wrong with `name` as a note's name, or null. */
export function nameProblem(name: string): string | null {
  if (!name.trim()) return "Type a name.";
  if (NOT_ALLOWED.test(name)) {
    return "A name can't have \\ / : * ? \" < > | # ^ [ or ].";
  }
  if (name.trim().startsWith(".")) return "A name can't start with a dot.";
  return null;
}

export function RenameNoteDialog() {
  const { name, hide } = useRenameNote();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (name) setValue(name);
  }, [name]);

  const problem = value.trim() === name ? null : nameProblem(value);
  const unchanged = value.trim() === name;

  const submit = async () => {
    const vault = useVaultStore.getState();
    const note = name && vault.index ? findNote(vault.index, name) : undefined;
    const next = value.trim();
    if (!note || unchanged || problem) return;
    const folder = note.path.split("/").slice(0, -1).join("/");
    const target = `${folder ? `${folder}/` : ""}${next}.md`;
    const wasOpen = vault.current === note.name;
    setBusy(true);
    try {
      // Only its capitals changed: by way of another name, since to the
      // disk (macOS, Windows) both are one file.
      let from = note.path;
      if (next.toLowerCase() === note.name.toLowerCase()) {
        from = `${folder ? `${folder}/` : ""}${next} (renaming).md`;
        await renameNote(note.path, from);
      }
      const updated = await renameNote(from, target);
      // What it was set to be (paper, idea…) goes with it.
      useVaultStore.setState((s) => ({
        noteKinds: Object.fromEntries(
          Object.entries(s.noteKinds).map(([key, kinds]) => {
            const kind = kinds[note.name.toLowerCase()];
            if (!kind) return [key, kinds];
            const { [note.name.toLowerCase()]: _, ...rest } = kinds;
            return [key, { ...rest, [next.toLowerCase()]: kind }];
          }),
        ),
      }));
      if (wasOpen) useVaultStore.setState({ current: next });
      toast.success(
        updated
          ? `Renamed to ${next}. ${updated} ${updated === 1 ? "note links" : "notes link"} to it, updated.`
          : `Renamed to ${next}`,
      );
      hide();
    } catch (err) {
      toast.error(
        err instanceof NoteExistsError
          ? `There's already a note called ${next}.`
          : err instanceof Error
            ? err.message
            : String(err),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={name !== null} onOpenChange={(o) => !o && hide()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename note</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="space-y-3"
        >
          <Input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Name"
          />
          {problem && <p className="text-destructive text-xs">{problem}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={hide}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || unchanged || !!problem}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
