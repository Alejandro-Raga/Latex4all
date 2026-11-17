import {
  InboxIcon,
  ListTodoIcon,
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
import { INBOX, type PlanList } from "@/lib/plan/plan-store";
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

/** Two theme colors blended: more distinct colors, still the theme's. */
const blend = (a: number, b: number) =>
  `color-mix(in oklab, var(--chart-${a}) 55%, var(--chart-${b}))`;

/**
 * Each kind of project has its color, from the theme: every article looks
 * like every other article, in any theme, and differs from a thesis.
 */
const TYPE_COLORS: [RegExp, string][] = [
  [/article|paper|artículo/, "var(--chart-1)"],
  [/thesis|tesis|dissertation/, "var(--chart-2)"],
  [/presentation|talk|slides|presentación/, "var(--chart-3)"],
  [/poster|póster/, "var(--chart-4)"],
  [/chapter|capítulo/, "var(--chart-5)"],
  [/book|libro/, blend(5, 2)],
  [/report|grant|proposal|informe/, blend(1, 3)],
  [/cv|résumé|resume/, blend(4, 2)],
  [/letter|carta/, blend(3, 4)],
];

/** Your own types: a color of the theme's picked by the name, always the same. */
const OWN_COLORS = [
  blend(1, 4),
  blend(2, 3),
  blend(3, 5),
  blend(4, 1),
  blend(5, 3),
];

export function typeColor(type?: string): string {
  const t = (type ?? "").trim().toLowerCase();
  if (!t) return "var(--muted-foreground)";
  for (const [re, color] of TYPE_COLORS) if (re.test(t)) return color;
  let hash = 0;
  for (const ch of t) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return OWN_COLORS[hash % OWN_COLORS.length];
}

/** A list of one's own: its color, or a default. */
export const listColor = (list: Pick<PlanList, "color">) =>
  list.color ?? "var(--chart-5)";

export function ProjectIcon({
  list,
  className,
}: {
  list: Pick<PlanList, "name" | "type"> &
    Partial<Pick<PlanList, "key" | "personal" | "color">>;
  className?: string;
}) {
  if (list.key === INBOX) {
    return (
      <InboxIcon
        className={cn("shrink-0", className)}
        style={{ color: "var(--muted-foreground)" }}
      />
    );
  }
  if (list.personal) {
    return (
      <ListTodoIcon
        className={cn("shrink-0", className)}
        style={{ color: listColor(list) }}
      />
    );
  }
  const Icon = typeIcon(list.type);
  return (
    <Icon
      className={cn("shrink-0", className)}
      style={{ color: typeColor(list.type) }}
    />
  );
}
