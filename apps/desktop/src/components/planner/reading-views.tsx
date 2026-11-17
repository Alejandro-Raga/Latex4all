/**
 * Reading lists: a project's backlog of papers, in the order they'll be
 * read. A paper's marker is its status (to read, reading with how far,
 * read), the reader's to set; its pills say what's been done with it.
 */
import { type ReactNode, useMemo, useState } from "react";
import {
  BookOpenIcon,
  CheckIcon,
  CircleDotIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  LibraryBigIcon,
  Loader2Icon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { lookupDoi } from "@/lib/plan/doi";
import { itemsIn, useZoteroLibrary } from "@/lib/zotero-library";
import { searchReferences } from "@/lib/zotero-search";
import {
  deleteTask,
  moveTask,
  newPlanText,
  type Plan,
  parsePlan,
  type TaskRef,
  today,
} from "@/lib/plan/plan-file";
import { type PlanList, usePlanText } from "@/lib/plan/plan-store";
import {
  addReading,
  linkReading,
  MARK_COLOR,
  MARK_HINT,
  MARK_LABEL,
  nextStatus,
  parsePaperInput,
  type ReadingItem,
  type ReadingStatus,
  readingItems,
  readingSection,
  STATUS_COLOR,
  STATUS_LABEL,
  STATUSES,
  setReadingStatus,
} from "@/lib/plan/reading";
import { createZoteroItems } from "@/lib/zotero-api";
import { cn } from "@/lib/utils";
import { useZoteroStore } from "@/stores/zotero-store";
import { openToRead } from "./open-paper";
import { editPlan, moveToPlan } from "./plan-actions";
import { BoardFrame, Card, Column, Empty, MoveToMenu } from "./plan-views";
import {
  type DragTask,
  DropMarker,
  type Zone,
  useDropArea,
  useTaskDnd,
} from "./planner-dnd";
import type { TaskContext } from "./task-parts";

const setStatus = (list: PlanList, ref: TaskRef, status: ReadingStatus) =>
  editPlan(list, (p) => setReadingStatus(p, ref, status, today()));

/* ─────────────────────────── The marker and pills ─────────────────────────── */

/**
 * A paper's status at a glance: an empty ring to read, a ring filling with
 * the pages read while reading, a check once read. A click moves it on.
 */
function StatusMarker({
  item,
  onChange,
}: {
  item: ReadingItem;
  onChange: (status: ReadingStatus) => void;
}) {
  const next = nextStatus(item.status);
  const color = STATUS_COLOR[item.status];
  const share =
    item.status === "reading"
      ? item.page && item.pages
        ? Math.max(0.08, Math.min(1, item.page / item.pages))
        : 0.25
      : 0;
  const r = 7;
  const around = 2 * Math.PI * r;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onChange(next);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      title={`${STATUS_LABEL[item.status]}${pageText(item) ? ` · ${pageText(item)}` : ""}. Click: ${STATUS_LABEL[next]}`}
      aria-label={`${STATUS_LABEL[item.status]}: mark as ${STATUS_LABEL[next].toLowerCase()}`}
      className="flex size-[18px] shrink-0 items-center justify-center transition-transform hover:scale-110"
    >
      {item.status === "read" ? (
        <span
          className="flex size-[18px] items-center justify-center rounded-full"
          style={{ backgroundColor: color }}
        >
          <CheckIcon className="size-3 text-white" strokeWidth={3.5} />
        </span>
      ) : (
        <svg viewBox="0 0 18 18" className="size-[18px] -rotate-90" aria-hidden>
          <circle
            cx="9"
            cy="9"
            r={r}
            fill="none"
            strokeWidth="1.75"
            style={{ stroke: `color-mix(in oklab, ${color} 45%, transparent)` }}
          />
          {share > 0 && (
            <circle
              cx="9"
              cy="9"
              r={r}
              fill="none"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={`${around * share} ${around}`}
              style={{ stroke: color }}
            />
          )}
        </svg>
      )}
    </button>
  );
}

const pageText = (item: ReadingItem) =>
  item.page ? `p. ${item.page}${item.pages ? ` of ${item.pages}` : ""}` : "";

function Pill({
  label,
  color,
  hint,
}: {
  label: string;
  color: string;
  hint: string;
}) {
  return (
    <span
      title={hint}
      className="flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px font-medium text-[10px] text-foreground"
      style={{
        backgroundColor: `color-mix(in oklab, ${color} 16%, var(--background))`,
        borderColor: `color-mix(in oklab, ${color} 40%, var(--background))`,
      }}
    >
      <span
        className="size-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}

/** What's been done with a paper, and whether it's in Zotero. */
function Pills({ item }: { item: ReadingItem }) {
  return (
    <>
      {!item.itemKey && (
        <Pill
          label="Not in Zotero"
          color="var(--muted-foreground)"
          hint="Added by hand. Right-click it to add it to Zotero."
        />
      )}
      {item.marks.map((m) => (
        <Pill
          key={m}
          label={MARK_LABEL[m]}
          color={MARK_COLOR[m]}
          hint={MARK_HINT[m]}
        />
      ))}
    </>
  );
}

/* ─────────────────────────── Opening, Zotero ─────────────────────────── */

function open(item: ReadingItem) {
  if (item.itemKey) openToRead(item.itemKey, item.title);
  else if (item.url)
    void shellOpen(item.url).catch(() =>
      toast.error("Couldn't open the link."),
    );
  else toast.info("Add it to Zotero to read it here, or give it a link.");
}

/** Puts a paper typed in by hand into Zotero, and links the entry to it. */
async function addToZotero(list: PlanList, item: ReadingItem) {
  const { apiKey, userID } = useZoteroStore.getState();
  if (!apiKey || !userID) {
    toast.error("Connect Zotero in Settings first.");
    return;
  }
  const id = toast.loading("Adding it to Zotero…");
  try {
    const found = item.doi ? await lookupDoi(item.doi) : null;
    const title = found?.title ?? item.title;
    const fields: Record<string, unknown> = found
      ? {
          itemType: "journalArticle",
          title,
          creators: found.authors.map((a) => ({ creatorType: "author", ...a })),
          publicationTitle: found.journal ?? "",
          date: found.year ?? "",
          DOI: item.doi,
          url: item.url ?? "",
        }
      : item.url
        ? { itemType: "webpage", title, url: item.url }
        : { itemType: "document", title };
    const [result] = await createZoteroItems(apiKey, userID, [fields]);
    if (!result || "error" in result) {
      throw new Error(
        result && "error" in result ? result.error : "Zotero didn't save it.",
      );
    }
    await editPlan(list, (p) => linkReading(p, item.ref, result.key, title));
    toast.success(`Added “${title}” to Zotero`, { id });
  } catch (err) {
    toast.error(
      `Couldn't add it: ${err instanceof Error ? err.message : String(err)}`,
      { id },
    );
  }
}

/** A paper's right-click menu. */
function ReadingMenu({
  list,
  item,
  children,
}: {
  list: PlanList;
  item: ReadingItem;
  children: ReactNode;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {item.itemKey ? (
          <ContextMenuItem onClick={() => open(item)}>
            <BookOpenIcon className="size-3.5" />
            Open to read
          </ContextMenuItem>
        ) : (
          <>
            {item.url && (
              <ContextMenuItem onClick={() => open(item)}>
                <ExternalLinkIcon className="size-3.5" />
                Open the link
              </ContextMenuItem>
            )}
            <ContextMenuItem onClick={() => void addToZotero(list, item)}>
              <LibraryBigIcon className="size-3.5" />
              Add to Zotero
            </ContextMenuItem>
          </>
        )}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <CircleDotIcon className="size-3.5" />
            Status
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-44">
            {STATUSES.map((s) => (
              <ContextMenuItem
                key={s}
                onClick={() => void setStatus(list, item.ref, s)}
              >
                {STATUS_LABEL[s]}
                {s === item.status && (
                  <CheckIcon className="ml-auto size-3.5" />
                )}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <MoveToMenu
          list={list}
          label="Move to"
          onPick={(target) =>
            void moveToPlan(
              { list, ref: item.ref, reading: true, label: item.title },
              target,
            )
          }
        />
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onClick={() => void editPlan(list, (p) => deleteTask(p, item.ref))}
        >
          <Trash2Icon className="size-3.5" />
          Remove from list
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/* ─────────────────────────── Rows and groups ─────────────────────────── */

/**
 * Dropped on a paper: before or after it in the reading order, taking the
 * status of the group it lands in; from another list, moved over.
 */
function dropOnPaper(list: PlanList, target: ReadingItem) {
  return (d: DragTask, zone: Zone) => {
    if (d.list.key !== list.key) {
      void moveToPlan(d, list);
      return;
    }
    void editPlan(list, (p) => {
      const at = zone === "after" ? target.ref.item + 1 : target.ref.item;
      let next = moveTask(p, d.ref, target.ref.section, at);
      // Where it is now, to give it the group's status.
      const moved =
        d.ref.section === target.ref.section && d.ref.item < at ? at - 1 : at;
      next = setReadingStatus(
        next,
        { section: target.ref.section, item: moved },
        target.status,
        today(),
      );
      return next;
    });
  };
}

function ReadingRow({
  list,
  item,
  rank,
  context,
}: {
  list: PlanList;
  item: ReadingItem;
  rank?: number;
  context?: TaskContext;
}) {
  const dnd = useTaskDnd(
    `read:${list.key}:${item.ref.section}:${item.ref.item}`,
    { list, ref: item.ref, reading: true, label: item.title },
    { accepts: "reading", onDrop: dropOnPaper(list, item) },
  );
  return (
    <ReadingMenu list={list} item={item}>
      <div
        ref={dnd.ref}
        {...(dnd.handlers as React.HTMLAttributes<HTMLDivElement>)}
        onDoubleClick={() => open(item)}
        className={cn(
          "group relative flex cursor-default items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-muted/70",
          dnd.dragging && "opacity-30",
        )}
      >
        <DropMarker zone={dnd.over} />
        {rank !== undefined && (
          <span className="w-4 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
            {rank}
          </span>
        )}
        <StatusMarker
          item={item}
          onChange={(s) => void setStatus(list, item.ref, s)}
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm",
            item.status === "read" && "text-muted-foreground",
          )}
          title={item.title}
        >
          {item.title}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <Pills item={item} />
          {item.page && item.status !== "to-read" && (
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {pageText(item)}
            </span>
          )}
          {context && (
            <span className="flex max-w-32 items-center gap-1 text-[11px] text-muted-foreground">
              {context.icon}
              <span className="truncate">{context.name}</span>
            </span>
          )}
        </span>
      </div>
    </ReadingMenu>
  );
}

const GROUPS: { status: ReadingStatus; title: string; folded?: boolean }[] = [
  { status: "reading", title: "Reading now" },
  { status: "to-read", title: "Up next" },
  { status: "reread", title: "To re-read" },
  { status: "read", title: "Read", folded: true },
];

/** A group (Reading now, Up next, Read): dropping on it gives its status. */
function ReadingGroup({
  id,
  title,
  status,
  count,
  folded: startFolded,
  onDrop,
  children,
}: {
  id: string;
  title: string;
  status: ReadingStatus;
  count: number;
  folded?: boolean;
  onDrop: (d: DragTask) => void;
  children: ReactNode;
}) {
  const [folded, setFolded] = useState(!!startFolded);
  const drop = useDropArea(id, {
    accepts: "reading",
    onDrop: (d) => onDrop(d),
  });
  return (
    <section className="pt-3">
      <button
        ref={drop.ref}
        type="button"
        onClick={() => setFolded(!folded)}
        className={cn(
          "flex w-full items-center gap-1.5 border-border border-b px-1 pb-1.5 text-left font-semibold text-[15px]",
          drop.over && "border-primary",
        )}
      >
        <ChevronRightIcon
          className={cn(
            "size-4 text-muted-foreground transition-transform",
            !folded && "rotate-90",
          )}
        />
        <span
          className="size-2 rounded-full"
          style={{ backgroundColor: STATUS_COLOR[status] }}
        />
        {title}
        <span className="font-normal text-muted-foreground text-xs tabular-nums">
          {count}
        </span>
      </button>
      {!folded && (
        <div className="pt-1">
          {children}
          {count === 0 && (
            <p className="px-3 py-2 text-muted-foreground/70 text-xs">
              Drop papers here
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/** Papers in a group's status: to the end of the list, with that status. */
function dropOnGroup(list: PlanList, status: ReadingStatus) {
  return (d: DragTask) => {
    if (d.list.key !== list.key) {
      void moveToPlan(d, list);
      return;
    }
    void editPlan(list, (p) => {
      const at = readingSection(p).index;
      let next = moveTask(p, d.ref, at);
      const items = readingItems(next);
      const last = items[items.length - 1];
      if (last) next = setReadingStatus(next, last.ref, status, today());
      return next;
    });
  };
}

/* ─────────────────────────── Adding papers ─────────────────────────── */

/**
 * Papers from the Zotero library, found by typing or by collection, added
 * with a click; the list stays open to add several.
 */
function ZoteroPicker({
  list,
  listed,
}: {
  list: PlanList;
  listed: Set<string>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [collection, setCollection] = useState("");
  const apiKey = useZoteroStore((s) => s.apiKey);
  const userID = useZoteroStore((s) => s.userID);
  const mirror = useZoteroLibrary((s) => s.mirror);
  const loading = useZoteroLibrary((s) => s.loading);
  const results = useMemo(() => {
    if (!mirror) return [];
    const items = itemsIn(mirror, collection || null);
    return searchReferences(
      items,
      query,
      query.trim() ? "relevance" : "newest",
    ).slice(0, 60);
  }, [mirror, collection, query]);
  const collections = useMemo(
    () =>
      [...(mirror?.collections ?? [])].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    [mirror],
  );
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && apiKey && userID) {
          void useZoteroLibrary.getState().ensure(apiKey, userID);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-muted/60 px-3 text-sm hover:bg-muted"
        >
          <LibraryBigIcon className="size-4 text-primary" />
          Add from Zotero
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        {!apiKey || !userID ? (
          <p className="p-4 text-muted-foreground text-sm">
            Connect Zotero in Settings to add papers from your library.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2 border-border border-b p-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search your library"
                aria-label="Search your Zotero library"
                className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm outline-none focus:border-ring"
              />
              {collections.length > 0 && (
                <select
                  value={collection}
                  onChange={(e) => setCollection(e.target.value)}
                  aria-label="Collection"
                  className="h-8 max-w-32 rounded-md border border-input bg-background px-1.5 text-xs"
                >
                  <option value="">All</option>
                  {collections.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto p-1">
              {results.map((item) => {
                const added = listed.has(item.key);
                return (
                  <button
                    key={item.key}
                    type="button"
                    disabled={added}
                    onClick={() =>
                      void editPlan(list, (p) =>
                        addReading(p, { title: item.title, itemKey: item.key }),
                      )
                    }
                    className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted disabled:opacity-60 disabled:hover:bg-transparent"
                  >
                    {added ? (
                      <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-chart-2" />
                    ) : (
                      <PlusIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-sm">{item.title}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {[item.creators, item.year].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </button>
                );
              })}
              {results.length === 0 && (
                <p className="p-3 text-muted-foreground text-sm">
                  {loading ? "Loading your library…" : "Nothing matches."}
                </p>
              )}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Adds by title, DOI or link; a DOI alone is named from Crossref. */
function AddPaper({ list, className }: { list: PlanList; className?: string }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const typed = text.trim();
        if (!typed || busy) return;
        const paper = parsePaperInput(typed);
        if (paper.doi && paper.title === paper.doi) {
          setBusy(true);
          const found = await lookupDoi(paper.doi);
          setBusy(false);
          if (found) paper.title = found.title;
        }
        await editPlan(list, (p) => addReading(p, paper));
        setText("");
      }}
      className={cn(
        "flex items-center gap-2 rounded-lg border border-transparent bg-muted/60 px-2.5 focus-within:border-ring focus-within:bg-background",
        className,
      )}
    >
      {busy ? (
        <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
      ) : (
        <PlusIcon className="size-4 text-primary" />
      )}
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a paper: its title, DOI or link"
        aria-label="Add a paper"
        className="h-9 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
    </form>
  );
}

const READING_HELP =
  "Add a paper above by its title, DOI or link, or right-click one in your Zotero library and choose Add to reading list.";

/* ─────────────────────────── A list, and all of them ─────────────────────────── */

/** Papers in their groups: Reading now, Up next (numbered), Read. */
function Grouped({
  rows,
  plans,
}: {
  rows: { list: PlanList; item: ReadingItem; context?: TaskContext }[];
  /** The one list these come from, if one: dropping on a group sets status there. */
  plans?: { list: PlanList; plan: Plan };
}) {
  return (
    <>
      {GROUPS.map((g) => {
        const group = rows.filter((r) => r.item.status === g.status);
        if (!plans && group.length === 0) return null;
        return (
          <ReadingGroup
            key={g.status}
            id={`rgroup:${plans?.list.key ?? "all"}:${g.status}`}
            title={g.title}
            status={g.status}
            count={group.length}
            folded={g.folded}
            onDrop={(d) => {
              if (plans) dropOnGroup(plans.list, g.status)(d);
              else void setStatus(d.list as PlanList, d.ref, g.status);
            }}
          >
            {group.map((r, i) => (
              <ReadingRow
                key={`${r.list.key}-${r.item.ref.item}-${r.item.title}`}
                list={r.list}
                item={r.item}
                rank={g.status === "to-read" ? i + 1 : undefined}
                context={r.context}
              />
            ))}
          </ReadingGroup>
        );
      })}
    </>
  );
}

/** A plan's reading list: grouped in reading order, or by status on a board. */
export function ReadingView({
  list,
  mode,
  inline,
}: {
  list: PlanList;
  mode: "list" | "board";
  inline?: boolean;
}) {
  const text = usePlanText(list.key);
  if (text === undefined) {
    return <p className="p-4 text-muted-foreground text-sm">Loading…</p>;
  }
  const plan = parsePlan(text ?? newPlanText(list.name));
  const items = readingItems(plan);

  if (mode === "board") {
    return (
      <BoardFrame>
        {STATUSES.map((s) => (
          <Column
            key={s}
            id={`status:${list.key}:${s}`}
            accepts="reading"
            title={
              <span className="font-semibold text-sm">{STATUS_LABEL[s]}</span>
            }
            color={STATUS_COLOR[s]}
            count={items.filter((r) => r.status === s).length}
            onDrop={(d) => {
              if (d.list.key === list.key) void setStatus(list, d.ref, s);
            }}
          >
            {items
              .filter((r) => r.status === s)
              .map((r) => (
                <ReadingCard
                  key={`${r.ref.item}-${r.title}`}
                  list={list}
                  item={r}
                />
              ))}
          </Column>
        ))}
      </BoardFrame>
    );
  }

  return (
    <div className={cn(inline ? "p-2" : "px-8 py-5")}>
      <div className="flex gap-2">
        <AddPaper list={list} className="flex-1" />
        <ZoteroPicker
          list={list}
          listed={new Set(items.flatMap((r) => (r.itemKey ? [r.itemKey] : [])))}
        />
      </div>
      {items.length === 0 ? (
        <Empty
          icon={<BookOpenIcon className="size-6" />}
          title="Nothing to read yet."
          text={READING_HELP}
        />
      ) : (
        <>
          <Grouped
            rows={items.map((item) => ({ list, item }))}
            plans={{ list, plan }}
          />
          <p className="px-2 pt-4 text-muted-foreground text-xs">
            Drag papers to set the order you'll read them in. Click the circle
            to mark one as reading or read; right-click to open it.
          </p>
        </>
      )}
    </div>
  );
}

function ReadingCard({ list, item }: { list: PlanList; item: ReadingItem }) {
  const dnd = useTaskDnd(
    `rcard:${list.key}:${item.ref.section}:${item.ref.item}`,
    { list, ref: item.ref, reading: true, label: item.title },
    { accepts: "reading", onDrop: dropOnPaper(list, item) },
  );
  return (
    <ReadingMenu list={list} item={item}>
      <div>
        <Card dnd={dnd}>
          <div
            className="flex items-start gap-2"
            onDoubleClick={() => open(item)}
          >
            <span className="pt-px">
              <StatusMarker
                item={item}
                onChange={(s) => void setStatus(list, item.ref, s)}
              />
            </span>
            <span className="min-w-0 flex-1 text-sm leading-snug">
              {item.title}
            </span>
          </div>
          {(item.marks.length > 0 || !item.itemKey || item.page) && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-[26px]">
              <Pills item={item} />
              {item.page && item.status !== "to-read" && (
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {pageText(item)}
                </span>
              )}
            </div>
          )}
        </Card>
      </div>
    </ReadingMenu>
  );
}

/** Every reading list together: what's being read, what's next, what's read. */
export function AllReading({
  rows,
  general,
}: {
  rows: { list: PlanList; item: ReadingItem; context: TaskContext }[];
  /** Your own list, where papers added here go. */
  general?: PlanList;
}) {
  return (
    <div className="px-8 py-5">
      {general && (
        <div className="flex gap-2">
          <AddPaper list={general} className="flex-1" />
          <ZoteroPicker
            list={general}
            listed={
              new Set(
                rows
                  .filter((r) => r.list.key === general.key)
                  .flatMap((r) => (r.item.itemKey ? [r.item.itemKey] : [])),
              )
            }
          />
        </div>
      )}
      {rows.length === 0 ? (
        <Empty
          icon={<BookOpenIcon className="size-6" />}
          title="Nothing to read yet."
          text={READING_HELP}
        />
      ) : (
        <Grouped rows={rows} />
      )}
    </div>
  );
}
