import { create } from "zustand";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  type AiLogEntry,
  readLog,
  readMemory,
  writeMemory,
} from "@/lib/ai-memory";
import { useDocumentStore } from "@/stores/document-store";

const PLACEHOLDER = `- Citations in APA style; the bibliography is references.bib.
- Chapter 3 is a draft: don't polish it yet.
- British spelling.`;

/**
 * The project's shared memory (AGENTS.md), read by every assistant, and
 * what they've done lately.
 */
/** Whether the project memory is open (from the chat, ⌘K or Settings). */
export const useMemoryDialog = create<{ open: boolean; show: () => void }>(
  (set) => ({ open: false, show: () => set({ open: true }) }),
);

export function MemoryDialog() {
  const open = useMemoryDialog((s) => s.open);
  const onOpenChange = (o: boolean) => useMemoryDialog.setState({ open: o });
  const root = useDocumentStore((s) => s.projectRoot);
  const [text, setText] = useState("");
  const [exists, setExists] = useState(false);
  const [log, setLog] = useState<AiLogEntry[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !root) return;
    void readMemory(root).then((m) => {
      setText(m ?? "");
      setExists(m !== null);
    });
    void readLog(root).then((l) => setLog(l.slice(-12).reverse()));
  }, [open, root]);

  const save = async () => {
    if (!root) return;
    // Nothing written and no memory yet: no empty file.
    if (!text.trim() && !exists) {
      onOpenChange(false);
      return;
    }
    setSaving(true);
    try {
      await writeMemory(root, text.endsWith("\n") ? text : `${text}\n`);
      toast.success("Saved to AGENTS.md");
      onOpenChange(false);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-4 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Project memory</DialogTitle>
          <DialogDescription>
            Notes that every AI in this project reads. Ask any of them to
            remember something and it goes here.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-1.5">
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-medium">AGENTS.md</span>
            <span className="text-muted-foreground">
              {exists ? "In the project folder" : "Created when you save"}
            </span>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={PLACEHOLDER}
            className="min-h-56 w-full flex-1 resize-y rounded-md border border-border bg-background p-3 text-sm leading-relaxed"
            aria-label="Project memory"
          />
        </div>

        {log.length > 0 && (
          <div className="min-h-0">
            <div className="pb-1.5 font-medium text-xs">Recent work</div>
            <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
              {log.map((e) => (
                <div
                  key={`${e.at}-${e.tab}`}
                  className="flex items-baseline gap-2 text-xs"
                >
                  <span className="w-20 shrink-0 text-muted-foreground tabular-nums">
                    {new Date(e.at).toLocaleString(undefined, {
                      weekday: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span className="shrink-0 rounded bg-muted px-1.5 py-px text-[10px]">
                    {e.who}
                  </span>
                  <span className="min-w-0 flex-1 truncate" title={e.ask}>
                    {e.ask || "—"}
                  </span>
                  {e.files.length > 0 && (
                    <span
                      className="max-w-40 shrink-0 truncate text-muted-foreground"
                      title={e.files.join(", ")}
                    >
                      {e.files.join(", ")}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !root}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
