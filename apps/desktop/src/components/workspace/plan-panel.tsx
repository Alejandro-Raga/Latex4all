import { useState } from "react";
import {
  BookOpenIcon,
  KanbanIcon,
  ListIcon,
  ListTodoIcon,
  XIcon,
} from "lucide-react";
import {
  PlanView,
  type PlanViewMode,
  ReadingView,
} from "@/components/planner/plan-views";
import { PlannerDnd } from "@/components/planner/planner-dnd";
import { Button } from "@/components/ui/button";
import { projectKey, usePlanLists } from "@/lib/plan/plan-store";
import { cn } from "@/lib/utils";
import { useDocumentStore } from "@/stores/document-store";
import { DockHeaderBar, DockWideButton } from "./dock/dock-section";

function Toggle({
  on,
  onClick,
  label,
  children,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={on}
      className={cn(
        "flex size-6 items-center justify-center rounded",
        on
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** The open project's plan beside the writing: its tasks, or its reading list. */
export function PlanPanel({ onClose }: { onClose: () => void }) {
  const root = useDocumentStore((s) => s.projectRoot);
  const lists = usePlanLists();
  const [tab, setTab] = useState<"tasks" | "reading">("tasks");
  const [mode, setMode] = useState<PlanViewMode>("list");
  if (!root) return null;
  const key = projectKey(root);
  const list = lists.find((l) => l.key === key) ?? {
    key,
    name: root.split(/[\\/]/).filter(Boolean).pop() ?? "Plan",
    root,
  };
  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar">
      <DockHeaderBar>
        <ListTodoIcon className="size-3.5 text-muted-foreground" />
        <span className="font-medium text-sm">Plan</span>
        <span className="flex flex-1 items-center gap-0.5 pl-2">
          <Toggle
            on={tab === "tasks"}
            onClick={() => setTab("tasks")}
            label="Tasks"
          >
            <ListTodoIcon className="size-3.5" />
          </Toggle>
          <Toggle
            on={tab === "reading"}
            onClick={() => setTab("reading")}
            label="Reading list"
          >
            <BookOpenIcon className="size-3.5" />
          </Toggle>
          <span className="mx-1 h-3.5 w-px bg-border" />
          <Toggle
            on={mode === "list"}
            onClick={() => setMode("list")}
            label="List"
          >
            <ListIcon className="size-3.5" />
          </Toggle>
          <Toggle
            on={mode === "board"}
            onClick={() => setMode("board")}
            label="Board"
          >
            <KanbanIcon className="size-3.5" />
          </Toggle>
        </span>
        <DockWideButton />
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={onClose}
          title="Close"
          aria-label="Close"
        >
          <XIcon className="size-3.5" />
        </Button>
      </DockHeaderBar>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <PlannerDnd>
          {tab === "reading" ? (
            <ReadingView list={list} mode={mode} inline />
          ) : (
            <PlanView list={list} mode={mode} inline />
          )}
        </PlannerDnd>
      </div>
    </div>
  );
}
