/** The colors notes are drawn in, in the lists, the pills and the map. */
import { vaultStyle } from "@/stores/vault-store";
import { PAPERS_GROUP } from "./vault-index";

const PAPER_COLOR = "#3b82f6";
const ROOT_COLOR = "#94a3b8";
const FOLDER_COLORS = [
  "#f59e0b",
  "#10b981",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
  "#84cc16",
  "#06b6d4",
];

/** A group's own color, before any picked for it. */
function defaultGroupColor(group: string, kind?: string): string {
  if (kind === "paper" || group === PAPERS_GROUP) return PAPER_COLOR;
  if (!group) return ROOT_COLOR;
  let hash = 0;
  for (const ch of group) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return FOLDER_COLORS[hash % FOLDER_COLORS.length];
}

/** The color a group is drawn in: picked, its type's, or its own. */
export function groupColor(group: string, kind?: string): string {
  const { colors, types } = vaultStyle();
  return (
    colors[group] ??
    types.find((t) => t.label === group)?.color ??
    defaultGroupColor(group, kind)
  );
}
