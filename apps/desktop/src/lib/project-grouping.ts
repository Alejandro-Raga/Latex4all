/**
 * Deciding what the project grid shows, and whether it needs headings.
 *
 * Two of the three orderings are just an ordering: the grid stays one run of
 * cards and only the sequence changes. Grouping by type is different — it needs
 * a heading per type, or the reader cannot tell where one type ends. Rather
 * than have the component branch on that, everything returns groups, and a
 * group with no label renders as a plain run of cards. A single unlabelled
 * group is therefore exactly the grid as it was before any of this existed.
 */

import { UNTYPED_LABEL } from "@/lib/project-meta";

export type ProjectSort = "recent" | "added" | "created" | "type";

export interface SortableProject {
  path: string;
  name: string;
  lastOpened: number;
}

export interface ProjectGroup<T extends SortableProject> {
  /** Stable key for React, distinct from the label so two groups can never
   *  collide on an empty or repeated heading. */
  key: string;
  /** Heading to draw, or null for a run of cards with none. */
  label: string | null;
  projects: T[];
}

export interface GroupingInput<T extends SortableProject> {
  projects: T[];
  sort: ProjectSort;
  /** Normalised paths, as held by the store. */
  favorites: ReadonlySet<string>;
  /** Path to type. Absent means untyped. */
  types: ReadonlyMap<string, string>;
  /** Path to when it was added. Absent falls back to lastOpened, which is what
   *  every project recorded before the field existed. */
  addedAt: ReadonlyMap<string, number>;
  /** Path to the folder's creation time. Absent until it has been read from
   *  disk, where date-added stands in so the order is still stable. */
  createdAt?: ReadonlyMap<string, number>;
}

export const FAVORITES_LABEL = "Favourites";

function byRecency<T extends SortableProject>(a: T, b: T): number {
  return b.lastOpened - a.lastOpened;
}

function byAdded<T extends SortableProject>(
  addedAt: ReadonlyMap<string, number>,
) {
  return (a: T, b: T) =>
    (addedAt.get(b.path) ?? b.lastOpened) -
    (addedAt.get(a.path) ?? a.lastOpened);
}

/** Newest first, falling back through date-added to last-opened so a project
 *  whose folder has not been read yet still lands somewhere sensible rather
 *  than jumping to one end of the list. */
function byCreated<T extends SortableProject>(
  createdAt: ReadonlyMap<string, number>,
  addedAt: ReadonlyMap<string, number>,
) {
  const when = (p: T) =>
    createdAt.get(p.path) ?? addedAt.get(p.path) ?? p.lastOpened;
  return (a: T, b: T) => when(b) - when(a);
}

/**
 * Favourites are pinned above everything and are not repeated in the groups
 * below — a project in two places at once reads as two projects.
 */
export function groupProjects<T extends SortableProject>({
  projects,
  sort,
  favorites,
  types,
  addedAt,
  createdAt,
}: GroupingInput<T>): ProjectGroup<T>[] {
  const compare =
    sort === "added"
      ? byAdded<T>(addedAt)
      : sort === "created"
        ? byCreated<T>(createdAt ?? new Map(), addedAt)
        : byRecency<T>;

  const pinned = projects.filter((p) => favorites.has(p.path)).sort(compare);
  const rest = projects.filter((p) => !favorites.has(p.path)).sort(compare);

  const groups: ProjectGroup<T>[] = [];
  if (pinned.length > 0) {
    groups.push({ key: "favorites", label: FAVORITES_LABEL, projects: pinned });
  }

  if (sort !== "type") {
    if (rest.length > 0) {
      // Unlabelled unless favourites are pinned above it, in which case the
      // run needs a name or it reads as a continuation of the favourites.
      groups.push({
        key: "all",
        label: pinned.length > 0 ? "All projects" : null,
        projects: rest,
      });
    }
    return groups;
  }

  const byType = new Map<string, T[]>();
  for (const project of rest) {
    const type = types.get(project.path) ?? UNTYPED_LABEL;
    const bucket = byType.get(type);
    if (bucket) bucket.push(project);
    else byType.set(type, [project]);
  }

  // Alphabetical, with the untyped bucket last however it sorts: it is the
  // absence of an answer rather than one of the answers.
  const labels = [...byType.keys()].sort((a, b) => {
    if (a === UNTYPED_LABEL) return 1;
    if (b === UNTYPED_LABEL) return -1;
    return a.localeCompare(b);
  });

  for (const label of labels) {
    groups.push({
      key: `type:${label}`,
      label,
      projects: byType.get(label) ?? [],
    });
  }

  return groups;
}

/** Every type currently in use, for the filter menu, alphabetical. */
export function typesInUse(types: ReadonlyMap<string, string>): string[] {
  return [...new Set(types.values())].sort((a, b) => a.localeCompare(b));
}
