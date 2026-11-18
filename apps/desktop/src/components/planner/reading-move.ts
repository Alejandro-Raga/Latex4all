import { useEffect } from "react";
import { newPlanText, parsePlan, serializePlan } from "@/lib/plan/plan-file";
import {
  INBOX,
  planTextNow,
  READING,
  usePlanStore,
  inTurn,
  writePlan,
} from "@/lib/plan/plan-store";
import { moveReading } from "@/lib/plan/reading";

const MOVED = "planner-reading-moved";

async function textOf(key: string) {
  if (planTextNow(key) === undefined) {
    await usePlanStore.getState().load(key);
  }
  return planTextNow(key) ?? null;
}

/**
 * Once: the Inbox's reading list moves to Reading, general reading's own
 * place, so the Inbox is only for tasks.
 */
export function useMoveInboxReading() {
  useEffect(() => {
    try {
      if (localStorage.getItem(MOVED)) return;
    } catch {
      return;
    }
    void (async () => {
      const inboxText = await textOf(INBOX);
      if (inboxText) {
        const readingText = await textOf(READING);
        const moved = moveReading(
          parsePlan(inboxText),
          parsePlan(readingText ?? newPlanText("Reading")),
        );
        const to = serializePlan(moved.to);
        if (to !== readingText) {
          // The papers land first; only then do they leave the Inbox.
          await inTurn([READING, INBOX], async () => {
            await writePlan(READING, to);
            await writePlan(INBOX, serializePlan(moved.from));
          });
        }
      }
      try {
        localStorage.setItem(MOVED, "1");
      } catch {
        // Tried again next time; moving twice finds nothing to move.
      }
    })().catch(() => {});
  }, []);
}
