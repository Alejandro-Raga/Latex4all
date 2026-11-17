/**
 * Adding a task from anywhere: ⌘⇧A (Ctrl+Shift+A), or "Add a task" on a
 * paper or note in the Library and Vault, which pins it to the task.
 */
import { PinIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { create } from "zustand";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { addTask, notesLines } from "@/lib/plan/plan-file";
import {
  INBOX,
  isProjectKey,
  projectKey,
  usePlanLists,
} from "@/lib/plan/plan-store";
import { parseQuickAdd } from "@/lib/plan/quick-add";
import { useDocumentStore } from "@/stores/document-store";
import { editPlan } from "./plan-actions";

export const useQuickTask = create<{
  open: boolean;
  /** A note pinned to the task, by name, and its title to show. */
  pin?: { name: string; title: string };
  text: string;
  show: (from?: {
    pin?: { name: string; title: string };
    text?: string;
  }) => void;
  hide: () => void;
}>((set) => ({
  open: false,
  text: "",
  show: (from) => set({ open: true, pin: from?.pin, text: from?.text ?? "" }),
  hide: () => set({ open: false, pin: undefined, text: "" }),
}));

export function QuickTask() {
  const { open, pin, text: start, hide } = useQuickTask();
  const lists = usePlanLists();
  const openRoot = useDocumentStore((s) => s.projectRoot);
  const [text, setText] = useState("");
  const [target, setTarget] = useState(INBOX);
  useEffect(() => {
    if (!open) return;
    setText(start);
    // The open project's list, if there is one; else the Inbox.
    const here = openRoot ? projectKey(openRoot) : null;
    setTarget(here && lists.some((l) => l.key === here) ? here : INBOX);
  }, [open, start, openRoot, lists]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === "a"
      ) {
        e.preventDefault();
        useQuickTask.getState().show();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const add = async () => {
    const parsed = parseQuickAdd(text);
    if (!parsed.title) return;
    const list = lists.find((l) => l.key === target);
    if (!list) return;
    hide();
    await editPlan(list, (p) =>
      addTask(p, {
        ...parsed,
        notes: pin ? notesLines("", [pin.name]) : [],
      }),
    );
    toast.success(`Added to ${list.name}`);
  };

  const own = lists.filter((l) => !isProjectKey(l.key));
  const projects = lists.filter((l) => isProjectKey(l.key));
  return (
    <Dialog open={open} onOpenChange={(o) => !o && hide()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a task</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
          className="space-y-3"
        >
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Like “Email María friday !high”"
            aria-label="Task"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring"
          />
          {pin && (
            <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
              <PinIcon className="size-3" />
              <span className="truncate">{pin.title}</span>
            </p>
          )}
          <div className="flex items-center gap-2">
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              aria-label="List"
              className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
            >
              {own.map((l) => (
                <option key={l.key} value={l.key}>
                  {l.name}
                </option>
              ))}
              {projects.length > 0 && (
                <optgroup label="Projects">
                  {projects.map((l) => (
                    <option key={l.key} value={l.key}>
                      {l.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <button
              type="submit"
              disabled={!text.trim()}
              className="h-8 rounded-md bg-primary px-3 font-medium text-primary-foreground text-sm disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
