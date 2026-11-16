/**
 * Reading lists keep up with what's done to a paper anywhere in the app:
 * opened, highlighted, quoted in a note, cited. Each moves the paper forward
 * on every reading list it's on (never back).
 */
import { useProjectStore } from "@/stores/project-store";
import { parsePlan, serializePlan, today } from "./plan-file";
import {
  INBOX,
  type PlanKey,
  planTextNow,
  projectKey,
  usePlanStore,
  writePlan,
} from "./plan-store";
import { advanceReading, type ReadingStatus } from "./reading";

/** Every plan a paper could be listed in: the general list and projects. */
function allKeys(): PlanKey[] {
  return [
    INBOX,
    ...useProjectStore.getState().recentProjects.map((p) => projectKey(p.path)),
  ];
}

async function advanceIn(
  key: PlanKey,
  itemKeys: string[],
  status: ReadingStatus,
) {
  let text = planTextNow(key);
  if (text === undefined) {
    await usePlanStore.getState().load(key);
    text = planTextNow(key);
  }
  if (!text || !itemKeys.some((k) => text.includes(k))) return;
  let plan = parsePlan(text);
  for (const itemKey of itemKeys) {
    plan = advanceReading(plan, itemKey, status, today());
  }
  const next = serializePlan(plan);
  if (next !== text) await writePlan(key, next);
}

/** Moves papers forward on every reading list they're on. */
export async function advanceEverywhere(
  itemKeys: string | string[],
  status: ReadingStatus,
  /** Only this plan (citations count for their own project). */
  only?: PlanKey,
): Promise<void> {
  const keys = (Array.isArray(itemKeys) ? itemKeys : [itemKeys]).filter(
    Boolean,
  );
  if (keys.length === 0) return;
  for (const key of only ? [only] : allKeys()) {
    await advanceIn(key, keys, status).catch(() => {});
  }
}
