/**
 * "Priority ▸" in a project's right-click menu (in the Planner and on the
 * projects page): its priority, or completed, as in the Planner's header.
 */
import { CheckCircle2Icon, CheckIcon, FlagIcon } from "lucide-react";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import {
  parsePlan,
  type Priority,
  projectDone,
  projectPriority,
  setProjectDone,
  setProjectPriority,
} from "@/lib/plan/plan-file";
import { projectKey, usePlanText } from "@/lib/plan/plan-store";
import { editPlan } from "./plan-actions";
import { PRIORITY_COLOR, PRIORITY_LABEL } from "./task-parts";

export function ProjectPriorityMenu({
  root,
  name,
}: {
  root: string;
  name: string;
}) {
  const key = projectKey(root);
  const text = usePlanText(key);
  const plan = text ? parsePlan(text) : null;
  const priority = plan ? projectPriority(plan) : 0;
  const done = plan ? projectDone(plan) : false;
  const list = { key, name };
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <FlagIcon className="size-3.5" />
        Priority
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="w-44">
        {([4, 3, 2, 1, 0] as Priority[]).map((p) => (
          <ContextMenuItem
            key={p}
            onClick={() =>
              void editPlan(list, (pl) => setProjectPriority(pl, p))
            }
          >
            <FlagIcon
              className="size-3.5"
              style={{ color: PRIORITY_COLOR[p] }}
              fill={p ? PRIORITY_COLOR[p] : "none"}
            />
            <span className="flex-1">{PRIORITY_LABEL[p]}</span>
            {p === priority && !done && <CheckIcon className="size-3.5" />}
          </ContextMenuItem>
        ))}
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={() => void editPlan(list, (pl) => setProjectDone(pl, !done))}
        >
          <CheckCircle2Icon className="size-3.5 text-emerald-600" />
          {done ? "Not completed" : "Completed"}
        </ContextMenuItem>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
