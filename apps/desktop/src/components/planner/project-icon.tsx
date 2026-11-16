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

/** A project type's color, from the theme: every thesis looks alike. */
export function typeColor(type?: string): string {
  const t = (type ?? "").toLowerCase();
  if (!t) return "var(--muted-foreground)";
  if (t.includes("thesis") || t.includes("tesis")) return "var(--chart-1)";
  if (
    t.includes("presentation") ||
    t.includes("talk") ||
    t.includes("slides")
  ) {
    return "var(--chart-2)";
  }
  if (t.includes("poster")) return "var(--chart-3)";
  if (t.includes("book")) return "var(--chart-4)";
  if (t.includes("article") || t.includes("paper")) return "var(--primary)";
  return "var(--chart-5)";
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
      style={{ color: typeColor(list.type) }}
    />
  );
}
