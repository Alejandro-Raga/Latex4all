import { type ReactNode, useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  BookOpenIcon,
  CheckCircle2Icon,
  DownloadIcon,
  FileTextIcon,
  FolderOpenIcon,
  KeyRoundIcon,
  LanguagesIcon,
  NotebookTextIcon,
  PenLineIcon,
  ServerIcon,
  UnplugIcon,
} from "lucide-react";
import { ClaudeSetup } from "@/components/claude-setup";
import { LanguagePacksSettings } from "@/components/settings/language-packs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { UpdateSettings } from "@/components/updater/update-settings";
import { ServerDialog } from "@/components/workspace/vault-panel";
import { ZoteroApiKeyDialog } from "@/components/workspace/zotero-api-key-dialog";
import { PDF_THEMES, type PdfTheme } from "@/lib/pdf-themes";
import { findObsidianVaults, type KnownVault } from "@/lib/vault/load";
import { useClaudeSetupStore } from "@/stores/claude-setup-store";
import { useLanguagePacksStore } from "@/stores/language-packs-store";
import { useSettingsStore } from "@/stores/settings-store";
import {
  type SettingsSection,
  useSettingsWindow,
} from "@/stores/settings-window-store";
import { useVaultStore } from "@/stores/vault-store";
import { useZoteroStore } from "@/stores/zotero-store";
import {
  EnvironmentStatus,
  SettingsDetailButton,
  SettingsPanel,
} from "./settings-parts";

export type { SettingsSection };

/** A labelled setting: name and one line of context on the left, control on the right. */
function SettingRow({
  label,
  detail,
  children,
}: {
  label: string;
  detail?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3">
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        {detail && (
          <div className="truncate text-muted-foreground text-xs">{detail}</div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 rounded-full transition-colors ${checked ? "bg-primary" : "bg-muted-foreground/30"}`}
    >
      <span
        className={`absolute top-0.5 size-4 rounded-full bg-background shadow transition-all ${checked ? "left-[18px]" : "left-0.5"}`}
      />
    </button>
  );
}

function EditorSettings() {
  const vimMode = useSettingsStore((s) => s.vimMode);
  const setVimMode = useSettingsStore((s) => s.setVimMode);
  const grammar = useSettingsStore((s) => s.grammarCheckEnabled);
  const setGrammar = useSettingsStore((s) => s.setGrammarCheckEnabled);
  const serverUrl = useSettingsStore((s) => s.grammarCheckServerUrl);
  const setServerUrl = useSettingsStore((s) => s.setGrammarCheckServerUrl);
  const showAnnotations = useSettingsStore((s) => s.showAnnotations);
  const setShowAnnotations = useSettingsStore((s) => s.setShowAnnotations);
  return (
    <div className="divide-y divide-border/60">
      <SettingRow label="Vim keys">
        <Toggle checked={vimMode} onChange={setVimMode} label="Vim keys" />
      </SettingRow>
      <SettingRow label="Show highlights and notes">
        <Toggle
          checked={showAnnotations}
          onChange={setShowAnnotations}
          label="Show highlights and notes"
        />
      </SettingRow>
      <SettingRow
        label="Grammar checking"
        detail="LanguageTool, running on this computer"
      >
        <Toggle
          checked={grammar}
          onChange={setGrammar}
          label="Grammar checking"
        />
      </SettingRow>
      {grammar && (
        <SettingRow label="LanguageTool address">
          <Input
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            className="h-7 w-56 text-xs"
            aria-label="LanguageTool address"
          />
        </SettingRow>
      )}
    </div>
  );
}

function ThemeSelect({
  value,
  onChange,
  label,
}: {
  value: PdfTheme;
  onChange: (theme: PdfTheme) => void;
  label: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as PdfTheme)}
      aria-label={label}
      className="h-7 rounded-md border border-input bg-background px-2 text-xs"
    >
      {PDF_THEMES.map((t) => (
        <option key={t.id} value={t.id}>
          {t.label}
        </option>
      ))}
    </select>
  );
}

function PdfSettings() {
  const s = useSettingsStore();
  return (
    <div className="divide-y divide-border/60">
      <SettingRow label="Compiled document">
        <ThemeSelect
          value={s.pdfThemeMain}
          onChange={s.setPdfThemeMain}
          label="Page colors of the compiled document"
        />
      </SettingRow>
      <SettingRow label="PDFs opened in the editor">
        <ThemeSelect
          value={s.pdfThemeInline}
          onChange={s.setPdfThemeInline}
          label="Page colors of PDFs in the editor"
        />
      </SettingRow>
      <SettingRow label="Reference panel">
        <ThemeSelect
          value={s.pdfThemeReference}
          onChange={s.setPdfThemeReference}
          label="Page colors in the Reference panel"
        />
      </SettingRow>
    </div>
  );
}

function ZoteroSettings() {
  const authenticated = useZoteroStore((s) => s.isAuthenticated);
  const username = useZoteroStore((s) => s.username);
  const userID = useZoteroStore((s) => s.userID);
  const connectWithOAuth = useZoteroStore((s) => s.connectWithOAuth);
  const disconnect = useZoteroStore((s) => s.disconnect);
  const validating = useZoteroStore((s) => s.isValidating);
  const [keyDialog, setKeyDialog] = useState(false);

  return (
    <div className="divide-y divide-border/60">
      {authenticated ? (
        <SettingRow
          label={username ? `Connected as ${username}` : "Connected"}
          detail={userID ? `User ID ${userID}` : undefined}
        >
          <Button
            variant="outline"
            size="sm"
            onClick={() => setKeyDialog(true)}
          >
            <KeyRoundIcon className="size-3.5" />
            Change key
          </Button>
          <Button variant="ghost" size="sm" onClick={disconnect}>
            <UnplugIcon className="size-3.5" />
            Disconnect
          </Button>
        </SettingRow>
      ) : (
        <SettingRow label="Not connected">
          <Button size="sm" onClick={connectWithOAuth} disabled={validating}>
            Connect Zotero
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setKeyDialog(true)}
          >
            <KeyRoundIcon className="size-3.5" />
            Use an API key
          </Button>
        </SettingRow>
      )}
      <ZoteroApiKeyDialog open={keyDialog} onOpenChange={setKeyDialog} />
    </div>
  );
}

function VaultSettings() {
  const source = useVaultStore((s) => s.source);
  const server = useVaultStore((s) => s.server);
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const ensureVault = useVaultStore((s) => s.ensureVault);
  const useLocalFolder = useVaultStore((s) => s.useLocalFolder);
  const useServer = useVaultStore((s) => s.useServer);
  const disconnectServer = useVaultStore((s) => s.disconnectServer);
  const [vaults, setVaults] = useState<KnownVault[]>([]);
  const [serverDialog, setServerDialog] = useState(false);

  useEffect(() => {
    ensureVault();
    findObsidianVaults().then(setVaults);
  }, [ensureVault]);

  const chooseFolder = async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected === "string") useLocalFolder(selected);
  };

  return (
    <div className="divide-y divide-border/60">
      <SettingRow
        label="Reading from"
        detail={
          source?.kind === "server" && server
            ? `${server.url} · ${server.username}`
            : (vaultPath ?? "No vault chosen yet")
        }
      >
        <span className="rounded bg-muted px-2 py-0.5 text-xs">
          {source?.kind === "server" ? "Server" : "This computer"}
        </span>
      </SettingRow>

      <SettingRow
        label="A folder on this computer"
        detail="Obsidian Sync, iCloud, Dropbox, Syncthing, Git…"
      >
        {vaults.length > 0 && (
          <select
            value={source?.kind === "local" ? (vaultPath ?? "") : ""}
            onChange={(e) => e.target.value && useLocalFolder(e.target.value)}
            aria-label="Obsidian vaults on this computer"
            className="h-7 max-w-44 rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="">Obsidian's vaults…</option>
            {vaults.map((v) => (
              <option key={v.path} value={v.path}>
                {v.name}
              </option>
            ))}
          </select>
        )}
        <Button variant="outline" size="sm" onClick={chooseFolder}>
          <FolderOpenIcon className="size-3.5" />
          Choose…
        </Button>
      </SettingRow>

      <SettingRow
        label="A WebDAV server"
        detail="Remotely Save, Nextcloud, Seafile, a NAS…"
      >
        {server ? (
          <>
            {source?.kind !== "server" && (
              <Button variant="outline" size="sm" onClick={useServer}>
                Use it
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={disconnectServer}>
              <UnplugIcon className="size-3.5" />
              Disconnect
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setServerDialog(true)}
          >
            <ServerIcon className="size-3.5" />
            Connect…
          </Button>
        )}
      </SettingRow>
      <ServerDialog open={serverDialog} onOpenChange={setServerDialog} />
    </div>
  );
}

/** Settings: the sections down the side, the chosen one beside them. */
export function SettingsView({
  section,
  onSectionChange,
  compact = false,
}: {
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  /** Tighter spacing, for the window over a project. */
  compact?: boolean;
}) {
  const [appVersion, setAppVersion] = useState("");
  const isClaudeReady = useClaudeSetupStore((s) => s.status === "ready");
  const updateChannel = useSettingsStore((s) => s.updateChannel);
  const vim = useSettingsStore((s) => s.vimMode);
  const pdfTheme = useSettingsStore((s) => s.pdfThemeMain);
  const zoteroUser = useZoteroStore((s) =>
    s.isAuthenticated ? s.username : null,
  );
  const vaultKind = useVaultStore((s) => s.source?.kind ?? null);
  const languagePacks = useLanguagePacksStore((s) => s.packs);
  const refreshLanguagePacks = useLanguagePacksStore((s) => s.refresh);

  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => {});
    refreshLanguagePacks();
  }, [refreshLanguagePacks]);

  const sections: {
    id: SettingsSection;
    label: string;
    meta: string;
    icon: typeof KeyRoundIcon;
    body: ReactNode;
    flush?: boolean;
  }[] = [
    {
      id: "provider",
      label: "Provider",
      meta: isClaudeReady ? "Ready" : "Setup",
      icon: KeyRoundIcon,
      body: <ClaudeSetup variant="embedded" />,
      flush: true,
    },
    {
      id: "editor",
      label: "Editor",
      meta: vim ? "Vim keys" : "Standard keys",
      icon: PenLineIcon,
      body: <EditorSettings />,
      flush: true,
    },
    {
      id: "pdf",
      label: "PDF",
      meta: PDF_THEMES.find((t) => t.id === pdfTheme)?.label ?? "Light",
      icon: FileTextIcon,
      body: <PdfSettings />,
      flush: true,
    },
    {
      id: "zotero",
      label: "Zotero",
      meta: zoteroUser ?? "Not connected",
      icon: BookOpenIcon,
      body: <ZoteroSettings />,
      flush: true,
    },
    {
      id: "vault",
      label: "Vault",
      meta:
        vaultKind === "server"
          ? "Server"
          : vaultKind
            ? "This computer"
            : "Not set",
      icon: NotebookTextIcon,
      body: <VaultSettings />,
      flush: true,
    },
    {
      id: "environment",
      label: "Environment",
      meta: "Python / Skills",
      icon: CheckCircle2Icon,
      body: <EnvironmentStatus appVersion={appVersion} />,
      flush: true,
    },
    {
      id: "languages",
      label: "Languages",
      meta: languagePacks.length
        ? `${languagePacks.filter((p) => p.installed || p.systemSupported).length} of ${languagePacks.length}`
        : "Spelling",
      icon: LanguagesIcon,
      body: <LanguagePacksSettings />,
      flush: true,
    },
    {
      id: "updates",
      label: "Updates",
      meta: updateChannel === "test" ? "Test" : "Release",
      icon: DownloadIcon,
      body: <UpdateSettings appVersion={appVersion} />,
      flush: true,
    },
  ];
  const current = sections.find((s) => s.id === section) ?? sections[0];

  return (
    <div
      className={
        compact
          ? "grid h-full min-h-0 grid-cols-[12rem_minmax(0,1fr)] gap-5"
          : "mx-auto grid w-full max-w-6xl grid-cols-1 gap-6 px-8 py-7 lg:grid-cols-[13rem_minmax(0,1fr)]"
      }
    >
      <aside className="space-y-1 overflow-y-auto border-border/60 border-r pr-4">
        {sections.map((s) => (
          <SettingsDetailButton
            key={s.id}
            active={s.id === current.id}
            icon={s.icon}
            label={s.label}
            meta={s.meta}
            onClick={() => onSectionChange(s.id)}
          />
        ))}
      </aside>
      <div className="min-h-0 min-w-0 overflow-y-auto">
        <SettingsPanel
          title={current.label}
          icon={current.icon}
          contentClassName={current.flush ? "p-0" : undefined}
        >
          {current.body}
        </SettingsPanel>
      </div>
    </div>
  );
}

/** Settings over an open project: ⌘, or the gear in the sidebar. */
export function SettingsWindow() {
  const open = useSettingsWindow((s) => s.open);
  const section = useSettingsWindow((s) => s.section);
  const show = useSettingsWindow((s) => s.show);
  const close = useSettingsWindow((s) => s.close);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        show();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show]);

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? show() : close())}>
      <DialogContent
        className="flex h-[min(80vh,720px)] w-[min(92vw,960px)] max-w-none flex-col gap-3 sm:max-w-none"
        // Focusing the first section would ring it while another is shown.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogTitle>Settings</DialogTitle>
        <div className="min-h-0 flex-1">
          <SettingsView
            section={section}
            onSectionChange={(s) => show(s)}
            compact
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
