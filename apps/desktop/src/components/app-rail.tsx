/**
 * The app's own navigation, on the left everywhere: Home (your projects),
 * Writing (the open project), the Planner and Library & Vault; Settings,
 * Help and Report a bug at the bottom. Icons only unless widened.
 */
import {
  BugIcon,
  CircleHelpIcon,
  FolderOpenIcon,
  LibraryIcon,
  ListTodoIcon,
  type LucideIcon,
  PaletteIcon,
  PanelLeftIcon,
  PenLineIcon,
  SettingsIcon,
} from "lucide-react";
import { useState } from "react";
import { useBugReport } from "@/components/bug-report-dialog";
import { ThemeMenu } from "@/components/theme-picker";
import { cn } from "@/lib/utils";
import { useDocumentStore } from "@/stores/document-store";
import {
  goToPlace,
  type HomeSection,
  toWriting,
  useNav,
} from "@/stores/nav-store";
import { useEditorFull, useReaderFull } from "@/stores/reader-full-store";

const WIDE = "app-rail-wide";

function useWide(): [boolean, (wide: boolean) => void] {
  const [wide, setWide] = useState(() => {
    try {
      return localStorage.getItem(WIDE) === "1";
    } catch {
      return false;
    }
  });
  return [
    wide,
    (next) => {
      setWide(next);
      try {
        localStorage.setItem(WIDE, next ? "1" : "0");
      } catch {
        // For this session.
      }
    },
  ];
}

const railItem = (active: boolean, wide: boolean) =>
  cn(
    "flex h-9 items-center gap-2.5 rounded-lg text-sm transition-colors",
    wide ? "w-full px-2.5" : "w-9 justify-center",
    active
      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
      : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
  );

function RailButton({
  icon: Icon,
  label,
  hint,
  active,
  wide,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  hint?: string;
  active: boolean;
  wide: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      title={hint ? `${label} (${hint})` : label}
      className={railItem(active, wide)}
    >
      <Icon className="size-4 shrink-0" />
      {wide && <span className="truncate">{label}</span>}
    </button>
  );
}

export function AppRail() {
  const [wide, setWide] = useWide();
  const projectRoot = useDocumentStore((s) => s.projectRoot);
  const away = useNav((s) => s.away);
  const section = useNav((s) => s.section);
  const readerFull = useReaderFull((s) => s.on);
  const editorFull = useEditorFull((s) => s.on);
  const writing = !!projectRoot && !away;
  // Reading across the whole window: the rail makes way too.
  if (readerFull || (writing && editorFull)) return null;
  const go = (to: HomeSection) => useNav.getState().setSection(to);
  const at = (to: HomeSection) => !writing && section === to;
  const mac =
    typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");
  const key = (n: string) => `${mac ? "⌘" : "Ctrl+"}${n}`;
  return (
    <nav
      aria-label="Latex4All"
      className={cn(
        "app-rail flex shrink-0 flex-col border-r pt-[var(--titlebar-height)] transition-[width] duration-200 ease-out",
        wide ? "w-48 px-2" : "w-12 items-center px-1.5",
      )}
    >
      <div
        className={cn(
          "flex h-12 shrink-0 items-center",
          wide ? "justify-between px-1" : "justify-center",
        )}
      >
        {wide && (
          <span className="flex min-w-0 items-center gap-2">
            <img src="/icon-192.png" alt="" className="size-5" />
            <span className="truncate font-semibold text-sm">Latex4All</span>
          </span>
        )}
        <button
          type="button"
          onClick={() => setWide(!wide)}
          aria-label={wide ? "Collapse the menu" : "Expand the menu"}
          title={wide ? "Collapse the menu" : "Expand the menu"}
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
        >
          <PanelLeftIcon className={cn("size-4", !wide && "rotate-180")} />
        </button>
      </div>
      <div className="flex flex-col gap-1">
        <RailButton
          icon={FolderOpenIcon}
          label="Home"
          hint={key("1")}
          active={at("projects")}
          wide={wide}
          onClick={() => goToPlace("projects")}
        />
        <RailButton
          icon={PenLineIcon}
          label="Writing"
          hint={
            projectRoot
              ? `${projectRoot.split(/[/\\]/).pop()}, ${key("4")}`
              : key("4")
          }
          active={writing}
          wide={wide}
          onClick={() => void toWriting()}
        />
        <RailButton
          icon={ListTodoIcon}
          label="Planner"
          hint={key("3")}
          active={at("planner")}
          wide={wide}
          onClick={() => goToPlace("planner")}
        />
        <RailButton
          icon={LibraryIcon}
          label="Library & Vault"
          hint={key("2")}
          active={at("library")}
          wide={wide}
          onClick={() => goToPlace("library")}
        />
      </div>
      <div className="mt-auto flex flex-col gap-1 pb-2">
        <ThemeMenu onEditCustom={() => go("settings")}>
          <button
            type="button"
            aria-label="Color theme"
            title="Color theme"
            className={railItem(false, wide)}
          >
            <PaletteIcon className="size-4 shrink-0" />
            {wide && <span className="truncate">Theme</span>}
          </button>
        </ThemeMenu>
        <RailButton
          icon={SettingsIcon}
          label="Settings"
          active={at("settings")}
          wide={wide}
          onClick={() => go("settings")}
        />
        <RailButton
          icon={CircleHelpIcon}
          label="Help"
          active={at("help")}
          wide={wide}
          onClick={() => go("help")}
        />
        <RailButton
          icon={BugIcon}
          label="Report a bug"
          active={false}
          wide={wide}
          onClick={() => useBugReport.getState().show()}
        />
      </div>
    </nav>
  );
}
