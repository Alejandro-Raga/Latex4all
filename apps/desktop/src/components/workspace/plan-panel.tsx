import { ListTodoIcon, XIcon } from "lucide-react";
import { PlanView } from "@/components/planner/plan-views";
import { Button } from "@/components/ui/button";
import { projectKey } from "@/lib/plan/plan-store";
import { useDocumentStore } from "@/stores/document-store";
import { DockHeaderBar, DockWideButton } from "./dock/dock-section";

/** The open project's plan, beside the writing: its tasks, and adding more. */
export function PlanPanel({ onClose }: { onClose: () => void }) {
  const root = useDocumentStore((s) => s.projectRoot);
  const name = root?.split(/[\\/]/).filter(Boolean).pop() ?? "Plan";
  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar">
      <DockHeaderBar>
        <ListTodoIcon className="size-3.5 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium text-sm">
          Plan
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
        {root ? (
          <PlanView
            list={{ key: projectKey(root), name, root }}
            mode="list"
            compact
          />
        ) : null}
      </div>
    </div>
  );
}
