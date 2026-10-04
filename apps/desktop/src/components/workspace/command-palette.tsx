import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Command } from "cmdk";
import {
  BrainIcon,
  BugIcon,
  FileIcon,
  FileTextIcon,
  LibraryIcon,
  MessageSquareIcon,
  NotebookTextIcon,
  PaletteIcon,
  QuoteIcon,
  RefreshCwIcon,
  SettingsIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { create } from "zustand";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { APP_THEMES } from "@/lib/app-themes";
import {
  type DockPanel,
  isDockPanelOpen,
  useDockStore,
} from "@/stores/dock-store";
import { useDocumentStore } from "@/stores/document-store";
import { useReadingStore } from "@/stores/reading-store";
import {
  type SettingsSection,
  useSettingsWindow,
} from "@/stores/settings-window-store";
import { useVaultStore } from "@/stores/vault-store";
import { useCitationCheck } from "./citation-check";
import { useMemoryDialog } from "@/components/claude-chat/memory-dialog";
import { useBugReport } from "@/components/bug-report-dialog";
import { syncProjectNote } from "./project-note-sync";

export const useCommandPalette = create<{
  open: boolean;
  setOpen: (open: boolean) => void;
}>((set) => ({ open: false, setOpen: (open) => set({ open }) }));

const PANELS: { panel: DockPanel; label: string; key: string }[] = [
  { panel: "reference", label: "Reference", key: "1" },
  { panel: "vault", label: "Vault", key: "2" },
  { panel: "notes", label: "Notes", key: "3" },
];

const SETTINGS: { id: SettingsSection; label: string }[] = [
  { id: "appearance", label: "Appearance" },
  { id: "editor", label: "Editor" },
  { id: "pdf", label: "PDF" },
  { id: "zotero", label: "Zotero" },
  { id: "vault", label: "Vault" },
  { id: "provider", label: "Provider" },
  { id: "updates", label: "Updates" },
];

/** Steps through the PDF pane's tabs (preview, papers, a widened panel). */
export function cyclePdfTab(step: 1 | -1) {
  const reading = useReadingStore.getState();
  const tabs = [
    "preview",
    ...reading.papers.map((p) => p.id),
    ...(useDockStore.getState().wide ? ["wide"] : []),
  ];
  if (tabs.length < 2) return;
  const at = Math.max(0, tabs.indexOf(reading.active));
  reading.activate(tabs[(at + step + tabs.length) % tabs.length]);
}

/**
 * Shortcuts for the workspace: ⌘K the palette, ⌘⌥1–3 the side panels,
 * ⌘⇧] / ⌘⇧[ the PDF pane's tabs.
 */
export function useWorkspaceShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (!e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const palette = useCommandPalette.getState();
        palette.setOpen(!palette.open);
        return;
      }
      if (e.altKey && !e.shiftKey) {
        // e.code: Option changes e.key on macOS (⌥1 is "¡").
        const panel = PANELS.find((p) => e.code === `Digit${p.key}`);
        if (panel) {
          e.preventDefault();
          useDockStore.getState().toggle(panel.panel);
        }
        return;
      }
      if (
        e.shiftKey &&
        !e.altKey &&
        (e.code === "BracketRight" || e.code === "BracketLeft")
      ) {
        e.preventDefault();
        cyclePdfTab(e.code === "BracketRight" ? 1 : -1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function Item({
  icon: Icon,
  label,
  hint,
  value,
  onSelect,
}: {
  icon: typeof FileIcon;
  label: ReactNode;
  hint?: string;
  value: string;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <kbd className="text-muted-foreground text-xs">{hint}</kbd>}
    </Command.Item>
  );
}

const groupClass =
  "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:text-xs";

/** ⌘K: jump to a file, a note or a PDF tab, or run a command, by typing. */
export function CommandPalette() {
  const open = useCommandPalette((s) => s.open);
  const setOpen = useCommandPalette((s) => s.setOpen);
  const files = useDocumentStore((s) => s.files);
  const projectRoot = useDocumentStore((s) => s.projectRoot);
  const notes = useVaultStore((s) => s.index?.list);
  const papers = useReadingStore((s) => s.papers);
  const projectLinked = useVaultStore((s) =>
    projectRoot ? Boolean(s.linkedProjects[projectRoot]) : false,
  );
  const { setTheme } = useTheme();
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open) {
      setQuery("");
      useVaultStore.getState().ensureVault();
    }
  }, [open]);

  const run = (action: () => void) => {
    setOpen(false);
    action();
  };
  const openNote = (name: string) => {
    useDockStore.getState().setOpen("vault", true);
    useVaultStore.getState().open(name);
  };
  // Long lists only show once there's something typed to narrow them.
  const noteList = useMemo(() => (query ? (notes ?? []) : []), [notes, query]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="top-[20%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-lg"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Command loop className="flex flex-col">
          <Command.Input
            value={query}
            onValueChange={setQuery}
            placeholder="Files, notes, papers, commands…"
            className="border-border border-b bg-transparent px-3 py-3 text-sm outline-none placeholder:text-muted-foreground"
          />
          <Command.List className="max-h-[50vh] overflow-y-auto p-1.5">
            <Command.Empty className="px-3 py-6 text-center text-muted-foreground text-sm">
              Nothing matches.
            </Command.Empty>

            {papers.length > 0 && (
              <Command.Group heading="PDF tabs" className={groupClass}>
                <Item
                  icon={FileTextIcon}
                  label="Preview"
                  value="Preview tab compiled pdf"
                  onSelect={() =>
                    run(() => useReadingStore.getState().activate("preview"))
                  }
                />
                {papers.map((p) => (
                  <Item
                    key={p.id}
                    icon={FileTextIcon}
                    label={p.label}
                    value={`${p.label} tab pdf`}
                    onSelect={() =>
                      run(() => useReadingStore.getState().activate(p.id))
                    }
                  />
                ))}
              </Command.Group>
            )}

            <Command.Group heading="Commands" className={groupClass}>
              {PANELS.map(({ panel, label, key }) => (
                <Item
                  key={panel}
                  icon={
                    panel === "reference"
                      ? LibraryIcon
                      : panel === "vault"
                        ? NotebookTextIcon
                        : MessageSquareIcon
                  }
                  label={`${isDockPanelOpen(panel) ? "Hide" : "Show"} ${label}`}
                  hint={`⌘⌥${key}`}
                  value={`${isDockPanelOpen(panel) ? "Hide" : "Show"} ${label} panel toggle`}
                  onSelect={() =>
                    run(() => useDockStore.getState().toggle(panel))
                  }
                />
              ))}
              {projectRoot && (
                <Item
                  icon={QuoteIcon}
                  label="Check citations"
                  value="Check citations bibliography bib missing unused"
                  onSelect={() => run(() => useCitationCheck.getState().show())}
                />
              )}
              {projectRoot && (
                <Item
                  icon={BrainIcon}
                  label="Project memory"
                  value="Project memory AGENTS.md notes assistants AI shared"
                  onSelect={() => run(() => useMemoryDialog.getState().show())}
                />
              )}
              {projectLinked && (
                <Item
                  icon={RefreshCwIcon}
                  label="Update project note in the vault"
                  value="Update project note in the vault"
                  onSelect={() => run(() => void syncProjectNote())}
                />
              )}
              <Item
                icon={BugIcon}
                label="Report a bug"
                value="Report a bug problem issue feedback"
                onSelect={() => run(() => useBugReport.getState().show())}
              />
              {SETTINGS.map((s) => (
                <Item
                  key={s.id}
                  icon={SettingsIcon}
                  label={`Settings: ${s.label}`}
                  value={`Settings: ${s.label}`}
                  onSelect={() =>
                    run(() => useSettingsWindow.getState().show(s.id))
                  }
                />
              ))}
            </Command.Group>

            {query && (
              <Command.Group heading="Themes" className={groupClass}>
                {APP_THEMES.map((t) => (
                  <Item
                    key={t.id}
                    icon={PaletteIcon}
                    label={`Theme: ${t.label}`}
                    value={`Theme: ${t.label} ${t.group}`}
                    onSelect={() => run(() => setTheme(t.id))}
                  />
                ))}
              </Command.Group>
            )}

            {files.length > 0 && (
              <Command.Group heading="Files" className={groupClass}>
                {files.map((f) => (
                  <Item
                    key={f.id}
                    icon={FileIcon}
                    label={f.relativePath}
                    value={`${f.relativePath} file`}
                    onSelect={() =>
                      run(() => useDocumentStore.getState().setActiveFile(f.id))
                    }
                  />
                ))}
              </Command.Group>
            )}

            {noteList.length > 0 && (
              <Command.Group heading="Vault notes" className={groupClass}>
                {noteList.map((n) => (
                  <Item
                    key={n.path}
                    icon={NotebookTextIcon}
                    label={
                      n.title === n.name ? n.name : `${n.name} — ${n.title}`
                    }
                    value={`${n.name} ${n.title} note`}
                    onSelect={() => run(() => openNote(n.name))}
                  />
                ))}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
