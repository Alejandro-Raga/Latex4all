/**
 * A task left out of the Eisenhower matrix (a far-off goal like "Finish
 * chapter 1" with many subtasks under it): marked on its line with
 * `[matrix:: no]`, an inline field Obsidian leaves alone. Its subtasks stay
 * out with it.
 */
import type { Task } from "./plan-file";

const FIELD = /\s*\[matrix::\s*no\s*\]/gi;

export const outOfMatrix = (t: Pick<Task, "title">) =>
  /\[matrix::\s*no\s*\]/i.test(t.title);

/** The title as shown: without the marker. */
export const withoutMatrixField = (title: string) =>
  title.replace(FIELD, "").trim();

/** The title with the task left out of the matrix, or back in. */
export const withMatrix = (title: string, out: boolean) =>
  out
    ? `${withoutMatrixField(title)} [matrix:: no]`
    : withoutMatrixField(title);

/** Fields kept on a task's line but not shown: `[matrix:: no]`, `[for:: …]`. */
const HIDDEN = /\s*\[(?:matrix|for)::[^\]]*\]/gi;

/** The title as shown anywhere: without the hidden fields. */
export const shownTitle = (title: string) => title.replace(HIDDEN, "").trim();

/** A title edited as shown, given back its hidden fields. */
export function withHiddenFields(edited: string, original: string): string {
  const kept = original.match(HIDDEN)?.map((f) => f.trim()) ?? [];
  return [shownTitle(edited), ...kept].join(" ");
}
