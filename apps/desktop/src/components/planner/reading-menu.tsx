import { BookmarkPlusIcon, CheckIcon, InboxIcon } from "lucide-react";
import { toast } from "sonner";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { newPlanText, parsePlan, serializePlan } from "@/lib/plan/plan-file";
import {
  READING,
  READING_LIST,
  isProjectKey,
  type PlanList,
  planTextNow,
  usePlanLists,
  usePlanStore,
  usePlanTexts,
  writePlan,
} from "@/lib/plan/plan-store";
import { addReading, readingItems } from "@/lib/plan/reading";
import { useDocumentStore } from "@/stores/document-store";
import { ProjectIcon } from "./project-icon";

export interface Paper {
  title: string;
  itemKey?: string;
  /** A link instead: the web, or a PDF on this computer (file://). */
  url?: string;
}

/** The general reading list's name, for papers that belong to no project. */
export const MY_READING = "My reading";

async function addTo(list: PlanList, paper: Paper) {
  try {
    let text = planTextNow(list.key);
    if (text === undefined) {
      await usePlanStore.getState().load(list.key);
      text = planTextNow(list.key);
    }
    const plan = parsePlan(text ?? newPlanText(list.name));
    const next = addReading(plan, paper);
    const name =
      list.key === READING
        ? MY_READING
        : list.personal
          ? `the ${list.name} reading list`
          : `${list.name}'s reading list`;
    if (next === plan) {
      toast.info(`Already in ${name}`);
      return;
    }
    await writePlan(list.key, serializePlan(next));
    toast.success(`Added to ${name}`);
  } catch (err) {
    toast.error(
      `Couldn't add it: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** "Add to reading list ▸": the general list, the open project, the rest. */
export function AddToReadingMenu({ paper }: { paper: Paper }) {
  const lists = usePlanLists();
  const openRoot = useDocumentStore((s) => s.projectRoot);
  const own = lists.filter((l) => l.personal);
  const projects = lists
    .filter((l) => isProjectKey(l.key))
    .sort(
      (a, b) =>
        Number(b.root === openRoot) - Number(a.root === openRoot) ||
        (b.lastOpened ?? 0) - (a.lastOpened ?? 0),
    )
    .slice(0, 12);
  const general = READING_LIST;
  const texts = usePlanTexts([
    READING,
    ...own.map((l) => l.key),
    ...projects.map((p) => p.key),
  ]);
  const listed = (key: string) => {
    const text = texts[key];
    return (
      !!paper.itemKey &&
      !!text &&
      readingItems(parsePlan(text)).some((r) => r.itemKey === paper.itemKey)
    );
  };
  const item = (list: PlanList, label: string, icon: React.ReactNode) => {
    const done = listed(list.key);
    return (
      <ContextMenuItem
        key={list.key}
        disabled={done}
        onClick={() => void addTo(list, paper)}
      >
        {done ? <CheckIcon className="size-3.5" /> : icon}
        <span className="truncate">{label}</span>
      </ContextMenuItem>
    );
  };
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <BookmarkPlusIcon className="size-3.5" />
        <span className="flex-1 text-left">Add to reading list</span>
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="max-h-80 w-56 overflow-y-auto">
        {general &&
          item(
            general,
            MY_READING,
            <InboxIcon className="size-3.5 opacity-60" />,
          )}
        {own.map((l) =>
          item(l, l.name, <ProjectIcon list={l} className="size-3.5" />),
        )}
        {projects.length > 0 && <ContextMenuSeparator />}
        {projects.map((p) =>
          item(
            p,
            p.root === openRoot ? `${p.name} (open)` : p.name,
            <ProjectIcon list={p} className="size-3.5" />,
          ),
        )}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
