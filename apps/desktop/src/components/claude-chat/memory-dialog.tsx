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
  const [log, setLog] = useState<AiLogEntry[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !root) return;
    void readMemory(root).then((m) => setText(m ?? ""));
    void readLog(root).then((l) => setLog(l.slice(-8).reverse()));
  }, [open, root]);

  const save = async () => {
    if (!root) return;
    // Nothing written and no memory yet: no empty file.
    if (!text.trim() && !(await readMemory(root))) {
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Project memory</DialogTitle>
          <DialogDescription>
            Every assistant here reads this (AGENTS.md), and can add to it.
          </DialogDescription>
        </DialogHeader>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={PLACEHOLDER}
          className="h-48 w-full resize-y rounded-md border border-border bg-background p-2 font-mono text-xs"
          aria-label="Project memory"
        />
        {log.length > 0 && (
          <div className="space-y-1">
            <div className="text-muted-foreground text-xs">Recent work</div>
            {log.map((e) => (
              <div key={`${e.at}-${e.tab}`} className="truncate text-xs">
                <span className="text-muted-foreground">
                  {new Date(e.at).toLocaleString(undefined, {
                    weekday: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  · {e.who}:{" "}
                </span>
                {e.ask || "—"}
                {e.files.length > 0 && (
                  <span className="text-muted-foreground">
                    {" "}
                    → {e.files.join(", ")}
                  </span>
                )}
              </div>
            ))}
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
