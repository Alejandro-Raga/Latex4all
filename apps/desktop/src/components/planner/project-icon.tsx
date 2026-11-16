import {
  BookOpenIcon,
  ClipboardListIcon,
  FileTextIcon,
  FolderIcon,
  GraduationCapIcon,
  IdCardIcon,
  type LucideIcon,
  MailIcon,
  PresentationIcon,
  ScrollTextIcon,
} from "lucide-react";
import type { PlanList } from "@/lib/plan/plan-store";
import { cn } from "@/lib/utils";

/** A project type's icon: an article a page, a thesis a cap… */
export function typeIcon(type?: string): LucideIcon {
  const t = (type ?? "").toLowerCase();
  if (t.includes("thesis") || t.includes("tesis")) return GraduationCapIcon;
  if (
    t.includes("presentation") ||
    t.includes("talk") ||
    t.includes("slides")
  ) {
    return PresentationIcon;
  }
  if (t.includes("poster")) return ScrollTextIcon;
  if (t.includes("book")) return BookOpenIcon;
  if (t.includes("report") || t.includes("grant") || t.includes("proposal")) {
    return ClipboardListIcon;
  }
  if (t.includes("cv")) return IdCardIcon;
  if (t.includes("letter")) return MailIcon;
  if (t) return FileTextIcon;
  return FolderIcon;
}

const COLORS = [
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#f97316",
  "#14b8a6",
  "#22c55e",
  "#eab308",
  "#06b6d4",
];

/** A project's own color, the same every time. */
export function projectColor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length];
}

export function ProjectIcon({
  list,
  className,
}: {
  list: Pick<PlanList, "name" | "type">;
  className?: string;
}) {
  const Icon = typeIcon(list.type);
  return (
    <Icon
      className={cn("shrink-0", className)}
      style={{ color: projectColor(list.name) }}
    />
  );
}
