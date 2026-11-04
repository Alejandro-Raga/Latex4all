import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-dialog";
import { readDir, readFile, readTextFile, stat } from "@tauri-apps/plugin-fs";
import { rememberedRoots } from "@/lib/workspace-memory";
import { groupProjects, type ProjectSort } from "@/lib/project-grouping";
import { syncProjectTypes } from "@/lib/project-type-sync";
import {
  typeMenuOptions,
  normalizeType,
  UNTYPED_LABEL,
  readProjectType,
  updateProjectMeta,
  writeProjectType,
} from "@/lib/project-meta";
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
import { toast } from "sonner";
import { leaveSharedProject } from "@/stores/collab-store";
import {
  BugIcon,
  CheckIcon,
  StarIcon,
  FolderOpenIcon,
  XIcon,
  FileTextIcon,
  LayoutTemplateIcon,
  LibraryIcon,
  Loader2Icon,
  SearchIcon,
  PanelLeftIcon,
  PlusIcon,
  SettingsIcon,
  GithubIcon,
  UsersIcon,
  CircleHelpIcon,
  ArrowUpDownIcon,
  ChevronDownIcon,
  CopyIcon,
  FolderXIcon,
  LayoutGridIcon,
  ListIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import * as Y from "yjs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { editedLabel } from "@/lib/edited-label";
import { openConflicts } from "@/lib/collab/open-conflicts";
import { loadDoc } from "@/lib/tauri/collab";
import { revealInFileManager, revealLabel } from "@/lib/reveal";
import type { LucideIcon } from "lucide-react";
import {
  CARD_SIZE_MAX,
  CARD_SIZE_MIN,
  useProjectStore,
} from "@/stores/project-store";
import { projectRelocated, useDocumentStore } from "@/stores/document-store";
import { useClaudeSetupStore } from "@/stores/claude-setup-store";
import { useSettingsStore } from "@/stores/settings-store";
import {
  PORTRAIT_ASPECT,
  pageAspectRatio,
  pageFit,
  texSourceAspectRatio,
} from "@/lib/preview-aspect-ratio";
import { DeckSurface, isWide } from "@/components/deck-surface";
import { compileLatex } from "@/lib/latex-compiler";
import { getMupdfClient } from "@/lib/mupdf/mupdf-client";
import { exists, join } from "@/lib/tauri/fs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ProjectWizard, type CreationMode } from "./project-wizard";
import {
  type SettingsSection,
  SettingsView,
} from "@/components/settings/settings-view";
import { JoinDialog } from "@/components/collab/join-dialog";
import { cn } from "@/lib/utils";
import { createLogger } from "@/lib/debug/logger";
import { ThemeMenuButton } from "@/components/theme-picker";
import { LibraryView } from "@/components/library-view";
import { HelpView } from "@/components/help-view";
import { useBugReport } from "@/components/bug-report-dialog";

const log = createLogger("project-picker");

interface DefaultProject {
  path: string;
  name: string;
  last_modified: number;
  has_main_tex: boolean;
}

const SORTS: Array<{ value: ProjectSort; label: string }> = [
  { value: "recent", label: "Recent" },
  { value: "added", label: "Date added" },
  { value: "created", label: "Date created" },
  { value: "type", label: "Grouped by type" },
];

type ProjectPickerSection = "projects" | "library" | "settings" | "help";

type RecentProject = {
  path: string;
  name: string;
  lastOpened: number;
};

type ProjectPreviewData = {
  createdAt: number | null;
} & (
  | {
      kind: "pdf";
      url: string;
      aspectRatio: number;
      pages: number;
      /** A wide document's second page, shown under the first. */
      nextUrl?: string;
    }
  | { kind: "tex"; fileName: string; lines: string[]; aspectRatio: number }
  | { kind: "empty" }
);

type ProjectPreviewState =
  | { status: "loading" }
  | { status: "ready"; data: ProjectPreviewData }
  | { status: "error" };

const projectPreviewCache = new Map<string, ProjectPreviewData>();
const projectPreviewRequests = new Map<string, Promise<ProjectPreviewData>>();
let projectPreviewCompileQueue: Promise<void> = Promise.resolve();

export function ProjectPicker() {
  const [showModeDialog, setShowModeDialog] = useState(false);
  const [showJoinDialog, setShowJoinDialog] = useState(false);
  const [wizardMode, setWizardMode] = useState<CreationMode | null>(null);
  const [appVersion, setAppVersion] = useState("");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [activeSection, setActiveSection] =
    useState<ProjectPickerSection>("projects");
  const [settingsDetailSection, setSettingsDetailSection] =
    useState<SettingsSection>("provider");
  const [searchQuery, setSearchQuery] = useState("");
  const [removeProjectTarget, setRemoveProjectTarget] =
    useState<RecentProject | null>(null);
  const defaultProjectsDiscoveredRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchShortcutLabel = "⌘ K";

  const recentProjects = useProjectStore((s) => s.recentProjects);
  const addRecentProject = useProjectStore((s) => s.addRecentProject);
  const removeRecentProject = useProjectStore((s) => s.removeRecentProject);
  const openProject = useDocumentStore((s) => s.openProject);

  const checkClaudeStatus = useClaudeSetupStore((s) => s.checkStatus);

  useEffect(() => {
    checkClaudeStatus();
    getVersion().then(setAppVersion);
  }, [checkClaudeStatus]);

  useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "k" ||
        event.altKey ||
        event.shiftKey ||
        (!event.metaKey && !event.ctrlKey)
      ) {
        return;
      }

      event.preventDefault();
      setActiveSection("projects");
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
    };

    window.addEventListener("keydown", handleSearchShortcut);
    return () => window.removeEventListener("keydown", handleSearchShortcut);
  }, []);

  useEffect(() => {
    if (defaultProjectsDiscoveredRef.current || recentProjects.length > 0) {
      return;
    }
    defaultProjectsDiscoveredRef.current = true;

    let cancelled = false;

    async function discoverDefaultProjects() {
      try {
        const projects = await invoke<DefaultProject[]>(
          "list_default_projects",
        );
        if (cancelled || projects.length === 0) return;

        // Seeded from the folder rather than the clock. Adding them in a loop
        // stamped every project with the same instant, which left "Recent" and
        // "Date added" showing one arbitrary order that never changed and
        // looked broken. These are projects the app found, not ones it watched
        // being opened, so the folder's own times are the only real answer
        // available.
        for (const project of [...projects].reverse()) {
          const [modified, created] = await Promise.all([
            getProjectModifiedAt(project.path),
            getProjectCreatedAt(project.path),
          ]);
          if (cancelled) return;
          addRecentProject(project.path, {
            lastOpened: modified ?? undefined,
            addedAt: created ?? modified ?? undefined,
          });
        }
      } catch (err) {
        console.warn("Failed to discover default projects:", err);
      }
    }

    discoverDefaultProjects();

    return () => {
      cancelled = true;
    };
  }, [addRecentProject, recentProjects.length]);

  // Projects opened before every one was kept (the list held ten): found
  // again by the workspace each left behind, when still on disk.
  const recoveredRef = useRef(false);
  useEffect(() => {
    if (recoveredRef.current) return;
    recoveredRef.current = true;
    let cancelled = false;
    void (async () => {
      const known = new Set(
        useProjectStore
          .getState()
          .recentProjects.map((p) =>
            p.path.replace(/[\\/]+$/, "").toLowerCase(),
          ),
      );
      for (const root of rememberedRoots()) {
        const path = root.replace(/[\\/]+$/, "");
        if (known.has(path.toLowerCase())) continue;
        if (!(await exists(path).catch(() => false)) || cancelled) continue;
        const [modified, created] = await Promise.all([
          getProjectModifiedAt(path),
          getProjectCreatedAt(path),
        ]);
        if (cancelled) return;
        addRecentProject(path, {
          lastOpened: modified ?? 0,
          addedAt: created ?? modified ?? undefined,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [addRecentProject]);

  const renameRecentProject = useProjectStore((s) => s.renameRecentProject);
  const setLastProjectFolder = useProjectStore((s) => s.setLastProjectFolder);

  const handleOpenFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Open project folder",
      });
      if (typeof selected === "string" && selected) {
        await openProject(selected);
        addRecentProject(selected);
      }
    } catch (err) {
      console.warn("Failed to open selected project folder:", err);
      toast.error("Failed to open project folder", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  /** Moves a project's folder somewhere else, without opening it. */
  const handleMoveProject = async (project: RecentProject) => {
    const destination = await open({
      directory: true,
      multiple: false,
      title: `Move "${project.name}" to…`,
    });
    if (typeof destination !== "string" || !destination) return;
    const separator = project.path.includes("\\") ? "\\" : "/";
    const folderName = project.path.split(/[\\/]/).filter(Boolean).pop() ?? "";
    const target = `${destination.replace(/[\\/]+$/, "")}${separator}${folderName}`;
    try {
      await invoke("move_project", {
        oldPath: project.path,
        newPath: target,
      });
      renameRecentProject(project.path, target);
      projectRelocated(project.path, target);
      setLastProjectFolder(destination);
      toast.success(`Moved to ${destination}`);
    } catch (err) {
      toast.error("Couldn't move the project", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  /**
   * A copy of the project beside it, "Name (copy)", as a project of its own:
   * not shared, without the original's history, its own id (so its own vault
   * note) and no copy of the compiled PDF saved over the original's.
   */
  const handleDuplicateProject = async (project: RecentProject) => {
    const separator = project.path.includes("\\") ? "\\" : "/";
    const parent = project.path.replace(/[\\/][^\\/]+[\\/]?$/, "");
    const base = project.path.split(/[\\/]/).filter(Boolean).pop() ?? "Project";
    let target = "";
    for (let n = 1; n < 100; n++) {
      const candidate = `${parent}${separator}${base} (copy${n > 1 ? ` ${n}` : ""})`;
      if (!(await exists(candidate).catch(() => false))) {
        target = candidate;
        break;
      }
    }
    if (!target) return;
    const id = toast.loading(`Duplicating ${project.name}…`);
    try {
      await invoke("duplicate_project", {
        srcPath: project.path,
        dstPath: target,
      });
      await invoke("allow_project_directory", { rootPath: target });
      await updateProjectMeta(target, {
        id: undefined,
        compiledCopy: undefined,
      });
      addRecentProject(target);
      const name = target.split(/[\\/]/).pop() ?? target;
      toast.success(`Made “${name}”`, {
        id,
        action: { label: "Open", onClick: () => void handleOpenRecent(target) },
      });
    } catch (err) {
      toast.error("Couldn't duplicate the project", {
        id,
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleOpenRecent = async (path: string) => {
    try {
      await openProject(path);
      addRecentProject(path);
    } catch (err) {
      removeRecentProject(path);
      console.warn("Failed to open recent project:", { path, error: err });
    }
  };

  const handleSelectMode = (mode: CreationMode) => {
    setShowModeDialog(false);
    setWizardMode(mode);
  };

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const projectSort = useProjectStore((s) => s.projectSort);
  const setProjectSort = useProjectStore((s) => s.setProjectSort);
  const [typePrompt, setTypePrompt] = useState<string | null>(null);
  const [customType, setCustomType] = useState("");

  const favorites = useProjectStore((s) => s.favorites);
  const projectTypes = useProjectStore((s) => s.projectTypes);
  const addedAt = useProjectStore((s) => s.addedAt);
  const toggleFavorite = useProjectStore((s) => s.toggleFavorite);
  const cacheProjectType = useProjectStore((s) => s.cacheProjectType);
  const createdAt = useProjectStore((s) => s.createdAt);
  const cacheProjectCreatedAt = useProjectStore((s) => s.cacheProjectCreatedAt);

  // Paths with a write in flight. The reconcile below skips them: the cache is
  // updated optimistically when a type is set and the write lands a moment
  // later, so a read in between finds no file and would reset it.
  const pendingTypeWrites = useRef<Set<string>>(new Set());

  // Types live in each project's folder, so the cache has to be reconciled with
  // disk. Deliberately not keyed on the cache — depending on `projectTypes`
  // here made setting a type re-run this, which is what reset it.
  useEffect(() => {
    let cancelled = false;
    void syncProjectTypes({
      paths: recentProjects.map((project) => project.path),
      readType: readProjectType,
      getCached: (path) =>
        useProjectStore.getState().projectTypes[path] ?? null,
      setCached: (path, type) => {
        if (!cancelled) cacheProjectType(path, type);
      },
      isPending: (path) => pendingTypeWrites.current.has(path),
    });
    return () => {
      cancelled = true;
    };
  }, [recentProjects, cacheProjectType]);

  // The folder's own creation date, for ordering by when the project was made.
  useEffect(() => {
    let cancelled = false;
    for (const project of recentProjects) {
      if (useProjectStore.getState().createdAt[project.path] !== undefined) {
        continue;
      }
      getProjectCreatedAt(project.path).then((created) => {
        if (!cancelled && created !== null) {
          cacheProjectCreatedAt(project.path, created);
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [recentProjects, cacheProjectCreatedAt]);

  const setProjectType = useCallback(
    async (path: string, type: string | null) => {
      pendingTypeWrites.current.add(path);
      cacheProjectType(path, type);
      try {
        await writeProjectType(path, type);
      } catch (err) {
        // The folder may be read-only or gone. Put the cache back rather than
        // showing a type the project does not actually carry.
        log.warn(`Could not set type for ${path}: ${String(err)}`);
        cacheProjectType(path, (await readProjectType(path)) ?? null);
        toast.error("Could not save the project type.");
      } finally {
        pendingTypeWrites.current.delete(path);
      }
    },
    [cacheProjectType],
  );

  const projectView = useProjectStore((s) => s.projectView);
  const setProjectView = useProjectStore((s) => s.setProjectView);
  const cardSize = useProjectStore((s) => s.cardSize);
  const setCardSize = useProjectStore((s) => s.setCardSize);
  const typeFilter = useProjectStore((s) => s.typeFilter);
  const setTypeFilter = useProjectStore((s) => s.setTypeFilter);

  const searchedProjects = useMemo(() => {
    if (!normalizedSearch) return recentProjects;
    return recentProjects.filter(
      (project) =>
        project.name.toLowerCase().includes(normalizedSearch) ||
        project.path.toLowerCase().includes(normalizedSearch),
    );
  }, [normalizedSearch, recentProjects]);

  // One chip per type in use, with how many; the chosen one filters. A type
  // no project has any more (its last one removed) shows everything.
  const typeChips = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of searchedProjects) {
      const t = projectTypes[p.path] ?? UNTYPED_LABEL;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    const types = [...counts.keys()].sort((a, b) =>
      a === UNTYPED_LABEL ? 1 : b === UNTYPED_LABEL ? -1 : a.localeCompare(b),
    );
    return [
      {
        label: "All",
        value: null as string | null,
        count: searchedProjects.length,
      },
      ...(types.length > 1 || types[0] !== UNTYPED_LABEL
        ? types.map((t) => ({ label: t, value: t, count: counts.get(t) ?? 0 }))
        : []),
    ];
  }, [searchedProjects, projectTypes]);
  const activeType = typeChips.some((c) => c.value === typeFilter)
    ? typeFilter
    : null;

  const visibleProjects = useMemo(
    () =>
      activeType === null
        ? searchedProjects
        : searchedProjects.filter(
            (p) => (projectTypes[p.path] ?? UNTYPED_LABEL) === activeType,
          ),
    [searchedProjects, activeType, projectTypes],
  );

  /** A project whose folder moved outside the app: pointed at it again. */
  const handleLocateProject = async (project: RecentProject) => {
    const found = await open({
      directory: true,
      multiple: false,
      title: `Where is "${project.name}" now?`,
    });
    if (typeof found !== "string" || !found) return;
    renameRecentProject(project.path, found);
    projectRelocated(project.path, found);
    toast.success(`Found “${project.name}”`);
  };

  const actionsFor = (project: RecentProject): ProjectActions => ({
    onOpen: () => void handleOpenRecent(project.path),
    onRemove: () => setRemoveProjectTarget(project),
    onToggleFavorite: () => toggleFavorite(project.path),
    onSetType: (type) => void setProjectType(project.path, type),
    onCustomType: () => {
      setCustomType(projectTypes[project.path] ?? "");
      setTypePrompt(project.path);
    },
    onMove: () => void handleMoveProject(project),
    onDuplicate: () => void handleDuplicateProject(project),
    onLocate: () => void handleLocateProject(project),
  });

  // Types the user has already made, offered alongside the built-in ones.
  const typeOptions = useMemo(
    () => typeMenuOptions(Object.values(projectTypes)),
    [projectTypes],
  );

  const projectGroups = useMemo(
    () =>
      groupProjects({
        projects: visibleProjects,
        sort: projectSort,
        favorites: new Set(favorites),
        types: new Map(Object.entries(projectTypes)),
        addedAt: new Map(Object.entries(addedAt)),
        createdAt: new Map(Object.entries(createdAt)),
      }),
    [visibleProjects, projectSort, favorites, projectTypes, addedAt, createdAt],
  );

  if (wizardMode) {
    return (
      <ProjectWizard mode={wizardMode} onBack={() => setWizardMode(null)} />
    );
  }

  return (
    <div className="flex h-full bg-background text-foreground">
      <aside
        className={cn(
          "flex shrink-0 flex-col border-sidebar-border border-r bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out",
          isSidebarCollapsed ? "w-12" : "w-56",
        )}
      >
        <div
          className={cn(
            "flex h-[calc(48px+var(--titlebar-height))] items-center gap-2 px-3 pt-[var(--titlebar-height)]",
            isSidebarCollapsed ? "justify-center" : "justify-between",
          )}
        >
          {!isSidebarCollapsed && (
            <div className="flex min-w-0 items-center gap-2">
              <img src="/icon-192.png" alt="Latex4All" className="size-6" />
              <span className="truncate font-semibold text-sm">Latex4All</span>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "rounded-lg text-muted-foreground hover:text-foreground",
              isSidebarCollapsed ? "size-7" : "size-8",
            )}
            onClick={() => setIsSidebarCollapsed((value) => !value)}
            aria-label={
              isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
            }
          >
            <PanelLeftIcon
              className={cn(
                "size-3.5 transition-transform duration-200",
                isSidebarCollapsed && "rotate-180",
              )}
            />
          </Button>
        </div>

        <nav
          className={cn(
            "flex flex-col gap-1",
            isSidebarCollapsed ? "items-center px-0" : "px-2",
          )}
        >
          <ProjectNavButton
            active={activeSection === "projects"}
            collapsed={isSidebarCollapsed}
            icon={FolderOpenIcon}
            onClick={() => setActiveSection("projects")}
          >
            All projects
          </ProjectNavButton>
          <ProjectNavButton
            active={activeSection === "library"}
            collapsed={isSidebarCollapsed}
            icon={LibraryIcon}
            onClick={() => setActiveSection("library")}
          >
            Library & Vault
          </ProjectNavButton>
          <ProjectNavButton
            active={activeSection === "settings"}
            collapsed={isSidebarCollapsed}
            icon={SettingsIcon}
            onClick={() => setActiveSection("settings")}
          >
            Settings
          </ProjectNavButton>
          <ProjectNavButton
            active={activeSection === "help"}
            collapsed={isSidebarCollapsed}
            icon={CircleHelpIcon}
            onClick={() => setActiveSection("help")}
          >
            Help
          </ProjectNavButton>
          <ProjectNavButton
            active={false}
            collapsed={isSidebarCollapsed}
            icon={BugIcon}
            onClick={() => useBugReport.getState().show()}
          >
            Report a bug
          </ProjectNavButton>
        </nav>

        <div
          className={cn(
            "mt-auto flex h-9 items-center border-sidebar-border border-t text-muted-foreground text-xs",
            isSidebarCollapsed ? "justify-center px-0" : "justify-between px-3",
          )}
        >
          {isSidebarCollapsed ? (
            <img src="/icon-192.png" alt="Latex4All" className="size-4" />
          ) : (
            <>
              <span className="truncate">Latex4All v{appVersion}</span>
              <div className="flex shrink-0 items-center gap-1">
                <Button variant="ghost" size="icon" className="size-6" asChild>
                  <a
                    href="https://github.com/Alejandro-Raga/Latex4all"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="GitHub"
                  >
                    <GithubIcon className="size-3.5" />
                  </a>
                </Button>
                <ThemeMenuButton />
              </div>
            </>
          )}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {activeSection === "library" ? (
          <LibraryView />
        ) : activeSection === "help" ? (
          <div className="flex h-full min-h-0 flex-col">
            <header className="flex h-[calc(48px+var(--titlebar-height))] shrink-0 items-center border-border/70 border-b bg-background px-5 pt-[var(--titlebar-height)]">
              <h1 className="font-semibold text-lg leading-none">Help</h1>
            </header>
            <HelpView
              onNavigate={(target) => {
                if (target.kind === "settings") {
                  setSettingsDetailSection(target.section);
                  setActiveSection("settings");
                } else {
                  setActiveSection(target.kind);
                }
              }}
            />
          </div>
        ) : (
          <>
            <header className="flex h-[calc(48px+var(--titlebar-height))] shrink-0 flex-nowrap items-center gap-3 border-border/70 border-b bg-background px-5">
              <div className="mr-auto flex min-w-0 items-center">
                <h1 className="truncate font-semibold text-lg leading-none">
                  {activeSection === "settings" ? "Settings" : "All projects"}
                </h1>
              </div>

              {activeSection === "projects" && (
                <div className="flex min-w-0 flex-1 flex-nowrap items-center justify-end gap-2">
                  <div className="relative flex min-w-40 flex-1 items-center sm:max-w-sm">
                    <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      ref={searchInputRef}
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Search"
                      className="h-9 w-full rounded-lg border border-input bg-background pr-16 pl-9 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
                    />
                    <kbd className="pointer-events-none absolute top-1/2 right-2 flex h-6 min-w-10 -translate-y-1/2 items-center justify-center rounded-md border border-border/70 bg-muted/30 px-1.5 font-medium text-[11px] text-muted-foreground leading-none">
                      {searchShortcutLabel}
                    </kbd>
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="secondary"
                        className="h-9 shrink-0 gap-1 rounded-lg px-3"
                      >
                        Add
                        <ChevronDownIcon className="size-3.5 opacity-70" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() => setShowJoinDialog(true)}
                      >
                        <UsersIcon className="size-4" />
                        Join a shared project…
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => void handleOpenFolder()}
                      >
                        <FolderOpenIcon className="size-4" />
                        Import a folder…
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    onClick={() => setShowModeDialog(true)}
                    className="h-9 shrink-0 gap-1.5 rounded-lg px-4"
                  >
                    <PlusIcon className="size-4" />
                    New
                  </Button>
                </div>
              )}
            </header>

            <div className="min-h-0 flex-1 overflow-auto">
              {activeSection === "settings" ? (
                <SettingsView
                  section={settingsDetailSection}
                  onSectionChange={setSettingsDetailSection}
                />
              ) : (
                <div className="flex w-full flex-col gap-4 px-5 py-5">
                  {visibleProjects.length === 0 ? (
                    <div className="flex min-h-80 flex-col items-center justify-center rounded-lg border border-border border-dashed bg-muted/10 px-6 text-center">
                      <FileTextIcon className="mb-4 size-10 text-muted-foreground/70" />
                      <h2 className="font-semibold text-lg">
                        {normalizedSearch
                          ? "No matching projects"
                          : "No projects"}
                      </h2>
                      <div className="mt-5 flex flex-wrap justify-center gap-3">
                        <Button onClick={() => setShowModeDialog(true)}>
                          <PlusIcon className="mr-2 size-4" />
                          New
                        </Button>
                        <Button onClick={handleOpenFolder} variant="outline">
                          <FolderOpenIcon className="mr-2 size-4" />
                          Import
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                          {typeChips.map((chip) => (
                            <button
                              key={chip.label}
                              type="button"
                              onClick={() => setTypeFilter(chip.value)}
                              className={cn(
                                "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
                                activeType === chip.value
                                  ? "border-foreground/20 bg-accent font-medium text-accent-foreground"
                                  : "border-transparent text-muted-foreground hover:bg-muted/60",
                              )}
                            >
                              {chip.label}
                              <span className="text-muted-foreground/70 tabular-nums">
                                {chip.count}
                              </span>
                            </button>
                          ))}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1 px-2 text-muted-foreground text-xs"
                              >
                                <ArrowUpDownIcon className="size-3.5" />
                                {SORTS.find((x) => x.value === projectSort)
                                  ?.label ?? "Sort"}
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuRadioGroup
                                value={projectSort}
                                onValueChange={(v) =>
                                  setProjectSort(v as ProjectSort)
                                }
                              >
                                {SORTS.map(({ value, label }) => (
                                  <DropdownMenuRadioItem
                                    key={value}
                                    value={value}
                                  >
                                    {label}
                                  </DropdownMenuRadioItem>
                                ))}
                              </DropdownMenuRadioGroup>
                            </DropdownMenuContent>
                          </DropdownMenu>
                          {projectView === "grid" && (
                            <label
                              className="flex items-center gap-1.5 text-muted-foreground"
                              title="Card size"
                            >
                              <ZoomOutIcon className="size-3.5" />
                              <input
                                type="range"
                                min={CARD_SIZE_MIN}
                                max={CARD_SIZE_MAX}
                                step={10}
                                value={cardSize}
                                onChange={(e) =>
                                  setCardSize(Number(e.currentTarget.value))
                                }
                                className="h-1 w-24 accent-primary"
                                aria-label="Card size"
                              />
                              <ZoomInIcon className="size-3.5" />
                            </label>
                          )}
                          <div className="flex rounded-md border p-0.5">
                            {(
                              [
                                ["grid", LayoutGridIcon, "Cards"],
                                ["list", ListIcon, "List"],
                              ] as const
                            ).map(([view, Icon, label]) => (
                              <button
                                key={view}
                                type="button"
                                title={label}
                                aria-label={label}
                                aria-pressed={projectView === view}
                                onClick={() => setProjectView(view)}
                                className={cn(
                                  "rounded p-1 transition-colors",
                                  projectView === view
                                    ? "bg-muted text-foreground"
                                    : "text-muted-foreground hover:text-foreground",
                                )}
                              >
                                <Icon className="size-3.5" />
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      {projectView === "list" && <ProjectListHeader />}
                      {projectGroups.map((group) => (
                        <section
                          key={group.key}
                          className="flex flex-col gap-3"
                        >
                          {group.label && (
                            <div className="flex items-center gap-2">
                              {group.key === "favorites" && (
                                <StarIcon className="size-3.5 fill-current text-amber-500" />
                              )}
                              <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                                {group.label}
                              </span>
                              <span className="text-muted-foreground/60 text-xs tabular-nums">
                                {group.projects.length}
                              </span>
                              <span className="h-px flex-1 bg-border/60" />
                            </div>
                          )}
                          {projectView === "list" ? (
                            <div role="table" className="flex flex-col">
                              {group.projects.map((project) => (
                                <ProjectRow
                                  key={project.path}
                                  project={project}
                                  isFavorite={favorites.includes(project.path)}
                                  type={projectTypes[project.path] ?? null}
                                  typeOptions={typeOptions}
                                  actions={actionsFor(project)}
                                />
                              ))}
                            </div>
                          ) : (
                            <div
                              className="grid gap-5"
                              style={{
                                gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize}px, 1fr))`,
                              }}
                            >
                              {group.projects.map((project) => (
                                <ProjectPreviewCard
                                  key={project.path}
                                  project={project}
                                  isFavorite={favorites.includes(project.path)}
                                  type={projectTypes[project.path] ?? null}
                                  typeOptions={typeOptions}
                                  actions={actionsFor(project)}
                                />
                              ))}
                            </div>
                          )}
                        </section>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </main>

      <JoinDialog open={showJoinDialog} onOpenChange={setShowJoinDialog} />

      {/* New Project mode selection dialog */}
      <Dialog open={showModeDialog} onOpenChange={setShowModeDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create new project</DialogTitle>
            <DialogDescription>How would you like to start?</DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => handleSelectMode("template")}
              className="group flex flex-1 flex-col items-center gap-3 rounded-lg border border-border/70 p-4 text-center transition-colors hover:border-border hover:bg-muted/50"
            >
              <div className="flex size-10 items-center justify-center rounded-md bg-muted/50 transition-colors group-hover:bg-muted">
                <LayoutTemplateIcon className="size-5 text-muted-foreground transition-colors group-hover:text-foreground" />
              </div>
              <div>
                <div className="font-semibold text-sm">From a template</div>
                <p className="mt-1 text-muted-foreground text-xs leading-relaxed">
                  Papers, slides, CVs and letters
                </p>
              </div>
              <span className="rounded-md bg-muted px-2 py-0.5 font-medium text-[10px] text-muted-foreground">
                Recommended
              </span>
            </button>

            <button
              onClick={() => handleSelectMode("scratch")}
              className="group flex flex-1 flex-col items-center gap-3 rounded-lg border border-border/70 p-4 text-center transition-colors hover:border-border hover:bg-muted/50"
            >
              <div className="flex size-10 items-center justify-center rounded-md bg-muted/50 transition-colors group-hover:bg-muted">
                <FileTextIcon className="size-5 text-muted-foreground transition-colors group-hover:text-foreground" />
              </div>
              <div>
                <div className="font-semibold text-sm">Blank document</div>
                <p className="mt-1 text-muted-foreground text-xs leading-relaxed">
                  An empty .tex file
                </p>
              </div>
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={typePrompt !== null}
        onOpenChange={(open) => {
          if (!open) setTypePrompt(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Project type</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (typePrompt === null) return;
              const value = normalizeType(customType);
              void setProjectType(typePrompt, value.length > 0 ? value : null);
              setTypePrompt(null);
            }}
          >
            <Input
              autoFocus
              value={customType}
              onChange={(e) => setCustomType(e.target.value)}
              placeholder="Referee report"
            />
            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setTypePrompt(null)}
              >
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <RemoveProjectDialog
        project={removeProjectTarget}
        onClose={() => setRemoveProjectTarget(null)}
        onRemoved={(path) => removeRecentProject(path)}
      />
    </div>
  );
}

/**
 * Removing a project from All Projects: from the list only (its files stay),
 * or its folder moved to the Trash. A shared project can also stop syncing
 * here; moved to the Trash, it always does. Collaborators keep their copies.
 */
function RemoveProjectDialog({
  project,
  onClose,
  onRemoved,
}: {
  project: RecentProject | null;
  onClose: () => void;
  onRemoved: (path: string) => void;
}) {
  const isShared = useProjectStore((s) =>
    project ? Object.values(s.sharedProjects).includes(project.path) : false,
  );
  const [trash, setTrash] = useState(false);
  const [stopSync, setStopSync] = useState(false);
  const [busy, setBusy] = useState(false);

  // Each time it opens, the safe choice.
  useEffect(() => {
    if (project) {
      setTrash(false);
      setStopSync(false);
    }
  }, [project]);

  const remove = async () => {
    if (!project) return;
    setBusy(true);
    try {
      if (isShared && (trash || stopSync)) {
        await leaveSharedProject(project.path, { keepNotes: !trash });
      }
      if (trash) {
        await invoke("trash_project", { path: project.path });
        toast.success(`“${project.name}” is in the Trash`);
      } else if (isShared && stopSync) {
        toast.success(`“${project.name}” no longer syncs on this computer`);
      }
      onRemoved(project.path);
      onClose();
    } catch (err) {
      toast.error("Couldn't remove the project", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  const choice = (value: boolean, title: string, detail: string) => (
    <label
      className={cn(
        "flex cursor-pointer gap-2.5 rounded-md border p-2.5 text-sm",
        trash === value ? "border-foreground/30 bg-muted/40" : "border-border",
      )}
    >
      <input
        type="radio"
        name="remove-project"
        className="mt-0.5 accent-primary"
        checked={trash === value}
        onChange={() => setTrash(value)}
        disabled={busy}
      />
      <span>
        <span className="block font-medium">{title}</span>
        <span className="block text-muted-foreground text-xs">{detail}</span>
      </span>
    </label>
  );

  return (
    <Dialog
      open={!!project}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remove “{project?.name ?? "this project"}”</DialogTitle>
          <DialogDescription>
            {isShared
              ? "It's shared. Collaborators keep their copies whatever you choose."
              : "Choose whether its files stay on this computer."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {choice(
            false,
            "Remove from the list",
            "Its files stay on this computer.",
          )}
          {choice(
            true,
            "Move to the Trash",
            "Its folder goes to the Trash, from where you can put it back.",
          )}
          {isShared && (
            <label className="flex cursor-pointer items-center gap-2 pt-1 text-sm">
              <input
                type="checkbox"
                className="size-3.5 accent-primary"
                checked={trash || stopSync}
                disabled={trash || busy}
                onChange={(e) => setStopSync(e.currentTarget.checked)}
              />
              Stop syncing it on this computer
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => void remove()}
            disabled={!project || busy}
          >
            {busy && <Loader2Icon className="size-3.5 animate-spin" />}
            {trash ? "Move to Trash" : "Remove"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function projectPreviewCacheKey(project: RecentProject) {
  return `${project.path}:${project.lastOpened}`;
}

function enqueueProjectPreviewCompile<T>(task: () => Promise<T>): Promise<T> {
  const run = projectPreviewCompileQueue.then(task, task);
  projectPreviewCompileQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function firstExistingProjectFile(
  projectPath: string,
  candidates: string[][],
): Promise<{ absolutePath: string; relativePath: string } | null> {
  for (const segments of candidates) {
    const absolutePath = await join(projectPath, ...segments);
    if (await exists(absolutePath)) {
      return {
        absolutePath,
        relativePath: segments.join("/"),
      };
    }
  }
  return null;
}

async function firstExistingPath(
  projectPath: string,
  candidates: string[][],
): Promise<string | null> {
  return (
    (await firstExistingProjectFile(projectPath, candidates))?.absolutePath ??
    null
  );
}

/**
 * The project's compiled PDF, whatever its main file is called: the build
 * folder's newest .pdf named after a .tex at the project's root (a figure
 * PDF copied there has no .tex of its name).
 */
async function builtPdf(projectPath: string): Promise<string | null> {
  const sep = projectPath.includes("\\") ? "\\" : "/";
  // Kept with the app, not in the project; a project not built since then
  // still has its PDF in the folder earlier versions used.
  const legacyDir = [projectPath, ".prism", "build"].join(sep);
  const appDir = await invoke<string>("project_build_dir", {
    projectDir: projectPath,
  }).catch(() => null);
  const buildDir =
    appDir && (await exists(appDir).catch(() => false)) ? appDir : legacyDir;
  try {
    const texNames = new Set(
      (await readDir(projectPath))
        .filter((e) => e.isFile && /\.tex$/i.test(e.name))
        .map((e) => e.name.replace(/\.tex$/i, "").toLowerCase()),
    );
    const pdfs = (await readDir(buildDir)).filter(
      (e) =>
        e.isFile &&
        /\.pdf$/i.test(e.name) &&
        texNames.has(e.name.replace(/\.pdf$/i, "").toLowerCase()),
    );
    let newest: { path: string; at: number } | null = null;
    for (const pdf of pdfs) {
      const path = `${buildDir}${sep}${pdf.name}`;
      const info = (await stat(path)) as { mtime?: unknown };
      const at = statDateToMs(info.mtime) ?? 0;
      if (!newest || at > newest.at) newest = { path, at };
    }
    return newest?.path ?? null;
  } catch {
    return null;
  }
}

type RenderedThumbnail = {
  url: string;
  aspectRatio: number;
  pages: number;
  nextUrl?: string;
};

async function renderPdfThumbnailFromBytes(
  bytes: Uint8Array,
): Promise<RenderedThumbnail> {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const client = getMupdfClient();
  let docId: number | null = null;

  try {
    docId = await client.openDocument(buffer);
    // The first page's own bounds, so a deck reports itself as a deck. Read
    // before rendering: both need the document open, and this is the cheaper
    // of the two if the render throws.
    const { width, height } = await client.getPageSize(docId, 0);
    const aspectRatio = pageAspectRatio(width, height);
    const pages = await client.countPages(docId).catch(() => 1);
    const render = async (page: number) => {
      const png = await client.renderThumbnail(docId as number, page, 420);
      return URL.createObjectURL(
        new Blob([new Uint8Array(png)], { type: "image/png" }),
      );
    };
    const url = await render(0);
    // A deck shows its first two slides, one above the other.
    const nextUrl =
      isWide(aspectRatio) && pages > 1
        ? await render(1).catch(() => undefined)
        : undefined;
    return { url, aspectRatio, pages, nextUrl };
  } finally {
    if (docId !== null) {
      await client.closeDocument(docId).catch(() => {});
    }
  }
}

async function renderPdfThumbnail(pdfPath: string): Promise<RenderedThumbnail> {
  return renderPdfThumbnailFromBytes(await readFile(pdfPath));
}

function previewAspectRatio(preview: ProjectPreviewState): number {
  if (preview.status !== "ready") return PORTRAIT_ASPECT;
  if (preview.data.kind === "empty") return PORTRAIT_ASPECT;
  return preview.data.aspectRatio;
}

function texPreviewLines(content: string) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 12)
    .map((line) => (line.length > 70 ? `${line.slice(0, 67)}...` : line));
}

function statDateToMs(value: unknown): number | null {
  if (!value) return null;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string") {
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : null;
  }
  return null;
}

async function getProjectCreatedAt(
  projectPath: string,
): Promise<number | null> {
  try {
    const info = (await stat(projectPath)) as {
      birthtime?: unknown;
      ctime?: unknown;
      mtime?: unknown;
    };
    return (
      statDateToMs(info.birthtime) ??
      statDateToMs(info.ctime) ??
      statDateToMs(info.mtime)
    );
  } catch {
    return null;
  }
}

/** When the folder was last written to. The best available stand-in for "when
 *  you last worked on this" for a project the app discovered rather than
 *  watched you open. */
async function getProjectModifiedAt(
  projectPath: string,
): Promise<number | null> {
  try {
    const info = (await stat(projectPath)) as { mtime?: unknown };
    return statDateToMs(info.mtime);
  } catch {
    return null;
  }
}

function formatProjectCreatedDate(createdAt: number | null) {
  if (!createdAt) return "";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(createdAt));
}

async function loadProjectPreview(
  project: RecentProject,
): Promise<ProjectPreviewData> {
  const cacheKey = projectPreviewCacheKey(project);
  const cached = projectPreviewCache.get(cacheKey);
  if (cached) return cached;

  const pending = projectPreviewRequests.get(cacheKey);
  if (pending) return pending;

  const promise = (async () => {
    try {
      return await computeProjectPreview(project, cacheKey);
    } catch (err) {
      const detail =
        err instanceof Error ? (err.stack ?? err.message) : String(err);
      log.warn(`Preview pipeline threw for ${project.path}: ${detail}`);
      const data: ProjectPreviewData = {
        kind: "empty",
        createdAt: await getProjectCreatedAt(project.path).catch(() => null),
      };
      projectPreviewCache.set(cacheKey, data);
      return data;
    }
  })();

  projectPreviewRequests.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    projectPreviewRequests.delete(cacheKey);
  }
}

async function computeProjectPreview(
  project: RecentProject,
  cacheKey: string,
): Promise<ProjectPreviewData> {
  {
    const createdAt = await getProjectCreatedAt(project.path);
    const pdfPath =
      (await builtPdf(project.path)) ??
      (await firstExistingPath(project.path, [["main.pdf"], ["document.pdf"]]));

    if (pdfPath) {
      try {
        const data: ProjectPreviewData = {
          kind: "pdf",
          ...(await renderPdfThumbnail(pdfPath)),
          createdAt,
        };
        projectPreviewCache.set(cacheKey, data);
        return data;
      } catch (err) {
        log.warn(
          `Failed to render thumbnail for ${project.path}: ${pdfPath} — ${String(err)}`,
        );
      }
    } else {
      log.info(`No cached PDF found for ${project.path}`);
    }

    const texFile = await firstExistingProjectFile(project.path, [
      ["main.tex"],
      ["document.tex"],
    ]);

    if (texFile) {
      try {
        const useTexlive =
          useSettingsStore.getState().compilerBackend === "texlive";
        const pdfBytes = await enqueueProjectPreviewCompile(() =>
          compileLatex(project.path, texFile.relativePath, useTexlive, false),
        );
        const data: ProjectPreviewData = {
          kind: "pdf",
          ...(await renderPdfThumbnailFromBytes(pdfBytes)),
          createdAt,
        };
        projectPreviewCache.set(cacheKey, data);
        return data;
      } catch (err) {
        log.warn(
          `Failed to compile preview for ${project.path}/${texFile.relativePath}: ${String(err)}`,
        );
      }

      const fileName = texFile.absolutePath.split(/[\\/]/).pop() ?? "main.tex";
      const source = await readTextFile(texFile.absolutePath);
      const data: ProjectPreviewData = {
        kind: "tex",
        fileName,
        lines: texPreviewLines(source),
        aspectRatio: texSourceAspectRatio(source),
        createdAt,
      };
      projectPreviewCache.set(cacheKey, data);
      return data;
    }

    log.info(`No main.tex/document.tex found for ${project.path}`);
    const data: ProjectPreviewData = { kind: "empty", createdAt };
    projectPreviewCache.set(cacheKey, data);
    return data;
  }
}

/** What the page says about a project besides its preview. */
interface ProjectFacts {
  /** Its folder is gone (moved or deleted outside the app). */
  missing: boolean;
  /** When one of its own files last changed. */
  editedAt: number | null;
  /** Conflicts waiting in a shared project's document. */
  conflicts: number;
}

const projectFactsCache = new Map<string, ProjectFacts>();

/** The newest change among the project's own files (not the folder's date,
 *  which only moves when a file is added or removed). */
async function projectEditedAt(path: string): Promise<number | null> {
  let newest = await getProjectModifiedAt(path);
  try {
    for (const entry of await readDir(path)) {
      if (!entry.isFile || !/\.(tex|bib|sty|cls|md)$/i.test(entry.name)) {
        continue;
      }
      const info = (await stat(await join(path, entry.name))) as {
        mtime?: unknown;
      };
      const at = statDateToMs(info.mtime);
      if (at !== null && (newest === null || at > newest)) newest = at;
    }
  } catch {
    // Unreadable: the folder's own date stands.
  }
  return newest;
}

async function readProjectFacts(
  project: RecentProject,
  shared: boolean,
): Promise<ProjectFacts> {
  if (!(await exists(project.path).catch(() => false))) {
    return { missing: true, editedAt: null, conflicts: 0 };
  }
  const editedAt = await projectEditedAt(project.path);
  let conflicts = 0;
  if (shared) {
    const saved = await loadDoc(project.path).catch(() => null);
    if (saved) {
      const doc = new Y.Doc();
      Y.applyUpdate(doc, saved.data);
      conflicts = openConflicts(doc);
      doc.destroy();
    }
  }
  return { missing: false, editedAt, conflicts };
}

function useProjectFacts(project: RecentProject, shared: boolean) {
  const key = `${project.path}:${project.lastOpened}:${shared}`;
  const [facts, setFacts] = useState<ProjectFacts | null>(
    () => projectFactsCache.get(key) ?? null,
  );
  useEffect(() => {
    let cancelled = false;
    const cached = projectFactsCache.get(key);
    if (cached) {
      setFacts(cached);
      return;
    }
    readProjectFacts(project, shared)
      .then((read) => {
        projectFactsCache.set(key, read);
        if (!cancelled) setFacts(read);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [key, project, shared]);
  return facts;
}

/** Opens the project's compiled PDF in the system's viewer. */
async function openProjectPdf(project: RecentProject) {
  const pdf =
    (await builtPdf(project.path)) ??
    (await firstExistingPath(project.path, [["main.pdf"], ["document.pdf"]]));
  if (!pdf) {
    toast.info(`“${project.name}” has no PDF yet. Compile it first.`);
    return;
  }
  await invoke("open_pdf_externally", { path: pdf }).catch((err) =>
    toast.error(String(err)),
  );
}

interface ProjectActions {
  onOpen: () => void;
  onRemove: () => void;
  onToggleFavorite: () => void;
  onSetType: (type: string | null) => void;
  onCustomType: () => void;
  onMove: () => void;
  onDuplicate: () => void;
  onLocate: () => void;
}

/** The right-click menu, the same on a card and on a row. */
function ProjectMenu({
  project,
  isFavorite,
  type,
  typeOptions,
  missing,
  actions,
}: {
  project: RecentProject;
  isFavorite: boolean;
  type: string | null;
  typeOptions: string[];
  missing: boolean;
  actions: ProjectActions;
}) {
  if (missing) {
    return (
      <ContextMenuContent>
        <ContextMenuItem onSelect={actions.onLocate}>Locate…</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={actions.onRemove}>Remove…</ContextMenuItem>
      </ContextMenuContent>
    );
  }
  return (
    <ContextMenuContent>
      <ContextMenuItem onSelect={actions.onOpen}>Open</ContextMenuItem>
      <ContextMenuItem onSelect={() => void openProjectPdf(project)}>
        Open PDF
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => revealInFileManager(project.path)}>
        {revealLabel()}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={actions.onToggleFavorite}>
        {isFavorite ? "Remove from favourites" : "Add to favourites"}
      </ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger>Type</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {typeOptions.map((suggestion) => (
            <ContextMenuItem
              key={suggestion}
              onSelect={() => actions.onSetType(suggestion)}
            >
              {suggestion}
              {type === suggestion && (
                <CheckIcon className="ml-auto size-3.5" />
              )}
            </ContextMenuItem>
          ))}
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={actions.onCustomType}>
            Something else…
          </ContextMenuItem>
          {type && (
            <ContextMenuItem onSelect={() => actions.onSetType(null)}>
              Clear
            </ContextMenuItem>
          )}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={actions.onDuplicate}>
        Duplicate
      </ContextMenuItem>
      <ContextMenuItem onSelect={actions.onMove}>Move to…</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={actions.onRemove}>Remove…</ContextMenuItem>
    </ContextMenuContent>
  );
}

/** "Shared", or what's waiting in it. */
function SharedBadge({ conflicts }: { conflicts: number }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 font-medium text-[10px]",
        conflicts > 0
          ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
          : "bg-muted text-muted-foreground",
      )}
      title={
        conflicts > 0
          ? `${conflicts} ${conflicts === 1 ? "conflict" : "conflicts"} to resolve`
          : "Shared"
      }
    >
      <UsersIcon className="size-3" />
      {conflicts > 0 ? `${conflicts} to resolve` : "Shared"}
    </span>
  );
}

/** A project's preview, loaded once and kept for the session. */
function useProjectPreview(project: RecentProject, enabled = true) {
  const [preview, setPreview] = useState<ProjectPreviewState>(() => {
    const cached = projectPreviewCache.get(projectPreviewCacheKey(project));
    return cached ? { status: "ready", data: cached } : { status: "loading" };
  });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const cached = projectPreviewCache.get(projectPreviewCacheKey(project));
    if (cached) {
      setPreview({ status: "ready", data: cached });
      return;
    }
    setPreview({ status: "loading" });
    loadProjectPreview(project)
      .then((data) => {
        if (!cancelled) setPreview({ status: "ready", data });
      })
      .catch((err) => {
        log.warn(`Failed to load preview for ${project.path}: ${String(err)}`);
        if (!cancelled) setPreview({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [project, enabled]);
  return preview;
}

/** A small round button over a card's preview, shown on hover. */
function CardButton({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "flex size-7 items-center justify-center rounded-full bg-background/90 text-foreground/80 shadow-sm ring-1 ring-border/60 backdrop-blur-sm transition-colors hover:bg-background hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

function ProjectPreviewCard({
  project,
  isFavorite,
  type,
  typeOptions,
  actions,
}: {
  project: RecentProject;
  isFavorite: boolean;
  type: string | null;
  typeOptions: string[];
  actions: ProjectActions;
}) {
  const isShared = useProjectStore((s) =>
    Object.values(s.sharedProjects).includes(project.path),
  );
  const facts = useProjectFacts(project, isShared);
  const missing = facts?.missing ?? false;
  const preview = useProjectPreview(project, !missing);
  const aspectRatio = previewAspectRatio(preview);
  const deck =
    preview.status === "ready" &&
    preview.data.kind === "pdf" &&
    isWide(preview.data.aspectRatio)
      ? preview.data
      : null;
  const edited =
    editedLabel(facts?.editedAt ?? null) ||
    (preview.status === "ready"
      ? formatProjectCreatedDate(preview.data.createdAt)
      : "");

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            "group relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-card shadow-xs transition-all duration-200",
            "focus-within:ring-2 focus-within:ring-ring/40 hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-lg",
            missing && "opacity-80",
          )}
        >
          {/* The preview keeps one 3:4 shape for the whole grid; what's in it
              varies. A page sits on the card like paper on a desk; a deck
              shows its first two slides (DeckSurface). */}
          <div className="relative aspect-[3/4] w-full">
            <button
              type="button"
              className="absolute inset-0 overflow-hidden bg-muted/40 text-left outline-none"
              onClick={missing ? actions.onLocate : actions.onOpen}
              aria-label={
                missing ? `Locate ${project.name}` : `Open ${project.name}`
              }
            >
              {missing ? (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground">
                  <FolderXIcon className="size-6" />
                  <span className="font-medium text-xs">Folder not found</span>
                  <span className="rounded-md border bg-background px-2 py-1 text-[11px] text-foreground">
                    Locate…
                  </span>
                </div>
              ) : deck ? (
                <DeckSurface
                  deck={deck}
                  slides={type === "Presentation" || deck.aspectRatio > 1.5}
                  projectName={project.name}
                />
              ) : (
                <div className="absolute inset-3 flex items-center justify-center">
                  <div
                    className={cn(
                      "overflow-hidden rounded-[3px] bg-background shadow-sm ring-1 ring-border/50",
                      pageFit(aspectRatio) === "height" ? "h-full" : "w-full",
                    )}
                    style={{ aspectRatio }}
                  >
                    <ProjectPreviewSurface
                      preview={preview}
                      projectName={project.name}
                    />
                  </div>
                </div>
              )}
            </button>

            {/* Star stays once set: it's the state, not a hover affordance. */}
            <CardButton
              label={
                isFavorite
                  ? `Remove ${project.name} from favourites`
                  : `Add ${project.name} to favourites`
              }
              onClick={actions.onToggleFavorite}
              className={cn(
                "absolute top-2 left-2 transition-opacity group-hover:opacity-100",
                isFavorite ? "opacity-100" : "opacity-0",
              )}
            >
              <StarIcon
                className={cn(
                  "size-3.5",
                  isFavorite && "fill-current text-amber-500",
                )}
              />
            </CardButton>
            <CardButton
              label={`Remove ${project.name}`}
              onClick={actions.onRemove}
              className="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100"
            >
              <XIcon className="size-3.5" />
            </CardButton>
            {!missing && (
              <div className="absolute right-2 bottom-2 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                <CardButton
                  label="Open PDF"
                  onClick={() => void openProjectPdf(project)}
                >
                  <FileTextIcon className="size-3.5" />
                </CardButton>
                <CardButton
                  label={revealLabel()}
                  onClick={() => revealInFileManager(project.path)}
                >
                  <FolderOpenIcon className="size-3.5" />
                </CardButton>
                <CardButton label="Duplicate" onClick={actions.onDuplicate}>
                  <CopyIcon className="size-3.5" />
                </CardButton>
              </div>
            )}
          </div>

          <div className="flex h-14 flex-col justify-center gap-0.5 border-border/60 border-t px-3">
            <div className="flex min-w-0 items-center gap-1.5">
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left font-medium text-sm leading-tight hover:underline"
                onClick={missing ? actions.onLocate : actions.onOpen}
                title={project.path}
              >
                {project.name}
              </button>
              {isShared && <SharedBadge conflicts={facts?.conflicts ?? 0} />}
            </div>
            <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
              <span className="truncate">
                {missing ? "Folder not found" : edited}
              </span>
              {type && (
                <>
                  <span className="text-muted-foreground/40">·</span>
                  <span className="truncate">{type}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </ContextMenuTrigger>
      <ProjectMenu
        project={project}
        isFavorite={isFavorite}
        type={type}
        typeOptions={typeOptions}
        missing={missing}
        actions={actions}
      />
    </ContextMenu>
  );
}

/** The list view's columns, the same on every row and its headings. */
const LIST_COLUMNS =
  "grid-cols-[2.25rem_minmax(0,1fr)_8rem_9rem_7.5rem_6.5rem]";

/** The list view's column headings. */
function ProjectListHeader() {
  return (
    <div
      role="row"
      className={cn(
        "grid items-center gap-3 border-border/60 border-b px-2 pb-1.5 font-medium text-muted-foreground text-xs",
        LIST_COLUMNS,
      )}
    >
      <span />
      <span>Name</span>
      <span>Type</span>
      <span>Edited</span>
      <span>Sharing</span>
      <span />
    </div>
  );
}

/** A project as a row of the list view. */
function ProjectRow({
  project,
  isFavorite,
  type,
  typeOptions,
  actions,
}: {
  project: RecentProject;
  isFavorite: boolean;
  type: string | null;
  typeOptions: string[];
  actions: ProjectActions;
}) {
  const isShared = useProjectStore((s) =>
    Object.values(s.sharedProjects).includes(project.path),
  );
  const facts = useProjectFacts(project, isShared);
  const missing = facts?.missing ?? false;
  const preview = useProjectPreview(project, !missing);
  const thumb =
    preview.status === "ready" && preview.data.kind === "pdf"
      ? preview.data.url
      : null;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="row"
          className={cn(
            "group grid h-14 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-muted/60",
            LIST_COLUMNS,
          )}
          onClick={missing ? actions.onLocate : actions.onOpen}
          onKeyDown={(e) => {
            if (e.key === "Enter")
              (missing ? actions.onLocate : actions.onOpen)();
          }}
          tabIndex={0}
        >
          <div className="flex h-11 w-9 items-center justify-center overflow-hidden rounded-[3px] bg-muted ring-1 ring-border/60">
            {missing ? (
              <FolderXIcon className="size-4 text-muted-foreground" />
            ) : thumb ? (
              <img
                src={thumb}
                alt=""
                className="h-full w-full bg-white object-cover object-top"
              />
            ) : (
              <FileTextIcon className="size-4 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              {isFavorite && (
                <StarIcon className="size-3 shrink-0 fill-current text-amber-500" />
              )}
              <span className="truncate font-medium text-sm">
                {project.name}
              </span>
            </div>
            <div
              className="truncate text-muted-foreground text-xs"
              title={project.path}
            >
              {project.path}
            </div>
          </div>
          <span className="truncate text-muted-foreground text-xs">
            {type ?? ""}
          </span>
          <span className="truncate text-muted-foreground text-xs">
            {missing
              ? "Folder not found"
              : editedLabel(facts?.editedAt ?? null)}
          </span>
          <span>
            {isShared && <SharedBadge conflicts={facts?.conflicts ?? 0} />}
          </span>
          <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            {!missing && (
              <>
                <CardButton
                  label="Open PDF"
                  onClick={() => void openProjectPdf(project)}
                >
                  <FileTextIcon className="size-3.5" />
                </CardButton>
                <CardButton
                  label={revealLabel()}
                  onClick={() => revealInFileManager(project.path)}
                >
                  <FolderOpenIcon className="size-3.5" />
                </CardButton>
              </>
            )}
            <CardButton
              label={`Remove ${project.name}`}
              onClick={actions.onRemove}
            >
              <XIcon className="size-3.5" />
            </CardButton>
          </div>
        </div>
      </ContextMenuTrigger>
      <ProjectMenu
        project={project}
        isFavorite={isFavorite}
        type={type}
        typeOptions={typeOptions}
        missing={missing}
        actions={actions}
      />
    </ContextMenu>
  );
}

function ProjectPreviewSurface({
  preview,
  projectName,
}: {
  preview: ProjectPreviewState;
  projectName: string;
}) {
  if (preview.status === "loading") {
    return (
      <div className="flex h-full w-full items-center justify-center bg-muted/10">
        <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (preview.status === "ready" && preview.data.kind === "pdf") {
    return (
      <img
        src={preview.data.url}
        alt={`${projectName} preview`}
        className="h-full w-full bg-white object-cover object-top"
      />
    );
  }

  if (preview.status === "ready" && preview.data.kind === "tex") {
    return (
      <div className="h-full w-full overflow-hidden bg-background">
        <div className="flex h-7 items-center border-border/60 border-b px-2">
          <span className="truncate font-mono text-[10px] text-muted-foreground">
            {preview.data.fileName}
          </span>
        </div>
        <div className="space-y-1 px-2 py-2 font-mono text-[10px] text-muted-foreground">
          {preview.data.lines.map((line, index) => (
            <div key={`${index}-${line}`} className="truncate">
              {line}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-muted/10 text-muted-foreground">
      <FileTextIcon className="mb-2 size-5" />
      <span className="text-xs">No preview</span>
    </div>
  );
}

function ProjectNavButton({
  active,
  collapsed,
  icon: Icon,
  onClick,
  children,
}: {
  active: boolean;
  collapsed: boolean;
  icon: LucideIcon;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center rounded-lg font-medium text-sm transition-colors",
        collapsed
          ? "size-8 justify-center"
          : "h-10 w-full justify-start gap-3 px-3 text-left",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
      title={typeof children === "string" ? children : undefined}
    >
      <Icon className="size-3.5 shrink-0" />
      {!collapsed && <span className="truncate">{children}</span>}
    </button>
  );
}
