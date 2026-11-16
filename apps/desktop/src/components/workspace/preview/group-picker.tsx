import { toast } from "sonner";
import { useDockStore } from "@/stores/dock-store";
import { useVaultStore } from "@/stores/vault-store";
import { findNote } from "@/lib/vault/vault-index";
import { NoteMenuAt } from "../topic-menu";

/**
 * Picks the note a passage goes in: any of the vault's, by type, or a new
 * one. `marker` finds the notes that quote it already, to tick them.
 */
export function NotePicker({
  anchor,
  marker,
  onPick,
  onCancel,
}: {
  anchor: { left: number; top: number };
  marker?: string;
  onPick: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  return (
    <NoteMenuAt
      anchor={anchor}
      done={(n) => !!marker && n.body.includes(marker)}
      onClose={onCancel}
      onPick={(name) => void onPick(name)}
    />
  );
}

/** "Added to …", with a way to open the note. */
export function filedToast(note: string) {
  const index = useVaultStore.getState().index;
  const title = (index && findNote(index, note)?.title) || note;
  toast.success(`Added to “${title}”`, {
    action: {
      label: "Open",
      onClick: () => {
        useDockStore.getState().setOpen("vault", true);
        useVaultStore.getState().open(note);
      },
    },
  });
}
