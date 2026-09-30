import { useMemo, useState } from "react";
import { CheckIcon, HashIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { create } from "zustand";
import { Button } from "@/components/ui/button";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { connectToTopic } from "@/lib/vault/connect-topic";
import { findNote } from "@/lib/vault/vault-index";
import { topicNotes, topicsOf } from "@/lib/vault/topics";
import { useVaultStore } from "@/stores/vault-store";

/** The note a menu acts on: its name, found (or made) when chosen. */
type Resolve = () => Promise<string>;

const useNewTopic = create<{
  resolve: Resolve | null;
  ask: (resolve: Resolve) => void;
  close: () => void;
}>((set) => ({
  resolve: null,
  ask: (resolve) => set({ resolve }),
  close: () => set({ resolve: null }),
}));

async function connect(resolve: Resolve, topic: string) {
  const id = toast.loading(`Connecting to ${topic}…`);
  try {
    const note = await resolve();
    const name = await connectToTopic(note, topic);
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
}: {
  /** Known when the note exists already, to tick its topics. */
  noteName?: string;
  resolve: Resolve;
}) {
  const index = useVaultStore((s) => s.index);
  const topics = useMemo(() => (index ? topicNotes(index) : []), [index]);
  const note = index && noteName ? findNote(index, noteName) : undefined;
  const joined = index && note ? topicsOf(index, note) : new Set<string>();
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <HashIcon className="size-3.5" />
        Connect to topic
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="max-h-80 w-56 overflow-y-auto">
        {topics.map((t) => (
          <ContextMenuItem
            key={t.path}
            disabled={joined.has(t.name)}
            onClick={() => connect(resolve, t.name)}
          >
            {joined.has(t.name) ? (
              <CheckIcon className="size-3.5" />
            ) : (
              <HashIcon className="size-3.5 opacity-40" />
            )}
            <span className="truncate">{t.name}</span>
          </ContextMenuItem>
        ))}
        {topics.length > 0 && <ContextMenuSeparator />}
        <ContextMenuItem onClick={() => useNewTopic.getState().ask(resolve)}>
          <PlusIcon className="size-3.5" />
          New topic…
        </ContextMenuItem>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

/** Names a new topic; mounted once, opened from any TopicMenu. */
export function NewTopicDialog() {
  const resolve = useNewTopic((s) => s.resolve);
  const close = useNewTopic((s) => s.close);
  const index = useVaultStore((s) => s.index);
  const [name, setName] = useState("");
  const existing = useMemo(
    () => (index ? topicNotes(index).map((t) => t.name) : []),
    [index],
  );
  // Close to an existing topic? Offer it, rather than a near-duplicate.
  const similar = name.trim()
    ? existing.filter((t) =>
        t.toLowerCase().includes(name.trim().toLowerCase()),
      )
    : [];
  const submit = (topic: string) => {
    if (!resolve || !topic.trim()) return;
    connect(resolve, topic.trim());
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
          <DialogTitle>New topic</DialogTitle>
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
            aria-label="Topic name"
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
