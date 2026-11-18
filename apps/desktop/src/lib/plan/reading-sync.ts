/**
 * Reading lists keep up with what's done to a paper anywhere in the app:
 * opened, highlighted, quoted in a note, cited. Each moves the paper forward
 * on every reading list it's on (never back).
 */
import { useProjectStore } from "@/stores/project-store";
import { parsePlan, serializePlan } from "./plan-file";
import {
  INBOX,
  READING,
  listKey,
  useOwnLists,
  type PlanKey,
  inTurn,
  planTextNow,
  projectKey,
  usePlanStore,
  writePlan,
} from "./plan-store";
import {
  addMark,
  markBookmark,
  markOpened,
  markPage,
  markStatus,
  type ReadingStatus,
  type ReadingMark,
} from "./reading";
import type { Plan } from "./plan-file";

/** Every plan a paper could be listed in: the general list and projects. */
function allKeys(): PlanKey[] {
  return [
    INBOX,
    READING,
    ...useOwnLists.getState().lists.map((l) => listKey(l.file)),
    ...useProjectStore.getState().recentProjects.map((p) => projectKey(p.path)),
  ];
}

type Change = (plan: Plan, itemKey: string) => Plan;

function changeIn(key: PlanKey, itemKeys: string[], change: Change) {
  // In turn with the plan's other changes, from what they left.
  return inTurn([key], () => applyChange(key, itemKeys, change));
}

async function applyChange(key: PlanKey, itemKeys: string[], change: Change) {
  let text = planTextNow(key);
  if (text === undefined) {
    await usePlanStore.getState().load(key);
    text = planTextNow(key);
  }
  if (!text || !itemKeys.some((k) => text.includes(k))) return;
  let plan = parsePlan(text);
  for (const itemKey of itemKeys) plan = change(plan, itemKey);
  const next = serializePlan(plan);
  if (next !== text) await writePlan(key, next);
}

async function changeAll(
  itemKeys: string | string[],
  change: Change,
  only?: PlanKey,
) {
  const keys = (Array.isArray(itemKeys) ? itemKeys : [itemKeys]).filter(
    Boolean,
  );
  if (keys.length === 0) return;
  for (const key of only ? [only] : allKeys()) {
    await changeIn(key, keys, change).catch(() => {});
  }
}

/**
 * Something done with papers, for the reading lists they're on: opened
 * (started), or highlighted, quoted in a note, cited (a mark each).
 */
export function noteReading(
  itemKeys: string | string[],
  what: "opened" | ReadingMark,
  /** Only this plan (citations count for their own project). */
  only?: PlanKey,
): Promise<void> {
  return changeAll(
    itemKeys,
    what === "opened" ? markOpened : (plan, key) => addMark(plan, key, what),
    only,
  );
}

/** The last page read of a paper, on its reading lists. */
export function notePage(itemKey: string, page: number, pages?: number) {
  return changeAll(itemKey, (plan, key) => markPage(plan, key, page, pages));
}

/** A paper's bookmark, on its reading lists (none: taken away). */
export function noteBookmark(
  itemKey: string,
  page: number | undefined,
  pages?: number,
) {
  return changeAll(itemKey, (plan, key) =>
    markBookmark(plan, key, page, pages),
  );
}

/** A paper's status, on every reading list it's on. */
export function noteStatus(itemKey: string, status: ReadingStatus) {
  const day = new Date();
  const z = new Date(day.getTime() - day.getTimezoneOffset() * 60_000);
  const today = z.toISOString().slice(0, 10);
  return changeAll(itemKey, (plan, key) =>
    markStatus(plan, key, status, today),
  );
}
