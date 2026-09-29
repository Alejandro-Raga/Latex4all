import {
  type ComponentType,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  CheckCircle2Icon,
  CircleIcon,
  DownloadIcon,
  KeyRoundIcon,
  Loader2Icon,
  type LucideIcon,
  PlayIcon,
  RefreshCwIcon,
  SettingsIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDictionaryStore } from "@/stores/dictionary-store";
import { useLanguageToolStore } from "@/stores/language-tool-store";
import { useUvSetupStore } from "@/stores/uv-setup-store";

interface SkillsStatus {
  installed: boolean;
  skill_count: number;
  location: string;
}

export function SettingsDetailButton({
  active,
  icon: Icon,
  label,
  meta,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      <div
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-md border",
          active
            ? "border-border/70 bg-background/70"
            : "border-border/60 bg-muted/20",
        )}
      >
        <Icon className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-sm">{label}</div>
        <div className="truncate text-muted-foreground text-xs">{meta}</div>
      </div>
    </button>
  );
}

export function SettingsPanel({
  title,
  icon: Icon,
  contentClassName,
  children,
}: {
  title: string;
  icon: LucideIcon;
  contentClassName?: string;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border/60 bg-muted/10">
      <div className="flex items-center gap-3 border-border/60 border-b px-5 py-4">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/30 text-muted-foreground">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <h2 className="truncate font-semibold text-sm">{title}</h2>
        </div>
      </div>
      <div className={cn("p-4", contentClassName)}>{children}</div>
    </section>
  );
}

export function EnvironmentStatus({ appVersion }: { appVersion: string }) {
  const uvStatus = useUvSetupStore((s) => s.status);
  const uvVersion = useUvSetupStore((s) => s.version);
  const uvInstalling = useUvSetupStore((s) => s.isInstalling);
  const checkUv = useUvSetupStore((s) => s.checkStatus);
  const installUv = useUvSetupStore((s) => s.install);
  const _finishUvInstall = useUvSetupStore((s) => s._finishInstall);

  const [skillsStatus, setSkillsStatus] = useState<SkillsStatus | null>(null);
  const [skillsInstalling, _setSkillsInstalling] = useState(false);
  const [showSkillsOnboarding, setShowSkillsOnboarding] = useState(false);

  // ── Dictionary (WordNet) ──
  const dictionaryStatus = useDictionaryStore((s) => s.status);
  const dictionarySource = useDictionaryStore((s) => s.source);
  const dictionaryVersion = useDictionaryStore((s) => s.version);
  const dictionaryProgress = useDictionaryStore((s) => s.progress);
  const dictionaryInstalling = useDictionaryStore((s) => s.isInstalling);
  const dictionaryHasSystem = useDictionaryStore((s) => s.hasSystemDictionary);
  const checkDictionary = useDictionaryStore((s) => s.checkStatus);
  const installDictionary = useDictionaryStore((s) => s.install);

  // ── Grammar checker (LanguageTool) ──
  const grammarStatus = useLanguageToolStore((s) => s.status);
  const grammarVersion = useLanguageToolStore((s) => s.version);
  const grammarProgress = useLanguageToolStore((s) => s.progress);
  const grammarInstalling = useLanguageToolStore((s) => s.isInstalling);
  const grammarStarting = useLanguageToolStore((s) => s.isStarting);
  const grammarExternal = useLanguageToolStore((s) => s.externallyManaged);
  const checkGrammar = useLanguageToolStore((s) => s.checkStatus);
  const installGrammar = useLanguageToolStore((s) => s.install);
  const startGrammar = useLanguageToolStore((s) => s.start);

  const runDictionaryInstall = useCallback(() => {
    toast.promise(installDictionary(), {
      loading: "Downloading the dictionary database...",
      success: "Dictionary installed.",
      error: (err) => `Could not install the dictionary: ${err}`,
    });
  }, [installDictionary]);

  const runGrammarInstall = useCallback(() => {
    toast.promise(installGrammar(), {
      loading: "Downloading LanguageTool...",
      success: "Grammar checking is ready.",
      error: (err) => `Setup failed: ${err}`,
    });
  }, [installGrammar]);

  const checkSkills = useCallback(async () => {
    try {
      const gs = await invoke<SkillsStatus>("check_skills_installed", {
        projectPath: null,
      });
      setSkillsStatus(gs);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    checkUv();
    checkSkills();
    checkDictionary();
    checkGrammar();
  }, [checkUv, checkSkills, checkDictionary, checkGrammar]);

  // Listen for uv install completion
  useEffect(() => {
    const unlisten = listen<boolean>("uv-install-complete", (event) => {
      _finishUvInstall(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [_finishUvInstall]);

  // Lazy load skills onboarding
  const [OnboardingComponent, setOnboardingComponent] = useState<ComponentType<{
    onClose: () => void;
  }> | null>(null);

  useEffect(() => {
    if (showSkillsOnboarding && !OnboardingComponent) {
      import(
        "@/components/scientific-skills/scientific-skills-onboarding"
      ).then((mod) =>
        setOnboardingComponent(() => mod.ScientificSkillsOnboarding),
      );
    }
  }, [showSkillsOnboarding, OnboardingComponent]);

  return (
    <>
      <div className="divide-y divide-border/60">
        {/* Python (uv) */}
        <StatusRow
          ok={uvStatus === "ready"}
          label="Python (uv)"
          detail={
            uvInstalling
              ? "Installing..."
              : uvStatus === "ready"
                ? (uvVersion ?? "Installed")
                : uvStatus === "checking"
                  ? "Checking..."
                  : "Not installed"
          }
          action={
            uvStatus === "not-installed" && !uvInstalling
              ? { label: "Install", onClick: installUv }
              : uvInstalling
                ? { label: "Installing...", loading: true }
                : undefined
          }
        />

        {/* Scientific Skills */}
        <StatusRow
          ok={!!skillsStatus?.installed}
          label="Scientific skills"
          detail={
            skillsInstalling
              ? "Installing..."
              : skillsStatus?.installed
                ? `${skillsStatus.skill_count} skills`
                : "Not installed"
          }
          secondaryAction={
            skillsStatus?.installed && !skillsInstalling
              ? {
                  label: "Reinstall",
                  icon: "refresh",
                  onClick: () => setShowSkillsOnboarding(true),
                }
              : undefined
          }
          action={
            skillsInstalling
              ? { label: "Installing...", loading: true }
              : {
                  label: skillsStatus?.installed ? "Manage" : "Install",
                  onClick: () => setShowSkillsOnboarding(true),
                  icon: skillsStatus?.installed ? "settings" : "download",
                }
          }
        />

        {/* Dictionary (WordNet) */}
        <StatusRow
          ok={dictionaryStatus === "ready"}
          label="Dictionary"
          detail={
            dictionaryInstalling
              ? (dictionaryProgress?.message ?? "Downloading...")
              : dictionaryStatus === "checking"
                ? "Checking..."
                : dictionaryStatus === "ready"
                  ? dictionarySource === "user"
                    ? `WordNet ${dictionaryVersion ?? ""} (downloaded)`.trim()
                    : dictionaryHasSystem
                      ? "System dictionary + bundled thesaurus"
                      : "Bundled with the app"
                  : "Not installed - right-click lookups have no entries"
          }
          secondaryAction={
            dictionaryStatus === "ready" && !dictionaryInstalling
              ? {
                  label: "Reinstall",
                  icon: "refresh",
                  onClick: runDictionaryInstall,
                }
              : undefined
          }
          action={
            dictionaryInstalling
              ? { label: "Installing...", loading: true }
              : dictionaryStatus === "ready"
                ? { label: "Check", icon: "refresh", onClick: checkDictionary }
                : { label: "Install", onClick: runDictionaryInstall }
          }
        />

        {/* Grammar checker (LanguageTool) */}
        <StatusRow
          ok={grammarStatus === "ready"}
          label="Grammar checker"
          detail={
            grammarInstalling
              ? (grammarProgress?.message ?? "Downloading...")
              : grammarStarting
                ? "Starting server..."
                : grammarStatus === "checking"
                  ? "Checking..."
                  : grammarStatus === "ready"
                    ? grammarExternal
                      ? "Running (started outside Latex4All)"
                      : `LanguageTool ${grammarVersion ?? ""} running`.trim()
                    : grammarStatus === "stopped"
                      ? "Installed - server not running"
                      : "Not installed (~300 MB)"
          }
          secondaryAction={
            grammarStatus === "stopped" && !grammarInstalling
              ? {
                  label: "Reinstall",
                  icon: "refresh",
                  onClick: runGrammarInstall,
                }
              : undefined
          }
          action={
            grammarInstalling
              ? { label: "Installing...", loading: true }
              : grammarStarting
                ? { label: "Starting...", loading: true }
                : grammarStatus === "ready"
                  ? { label: "Check", icon: "refresh", onClick: checkGrammar }
                  : grammarStatus === "stopped"
                    ? { label: "Start", icon: "play", onClick: startGrammar }
                    : { label: "Install", onClick: runGrammarInstall }
          }
        />

        <StatusRow
          ok={true}
          label="Latex4All"
          detail={appVersion ? `v${appVersion}` : "Checking..."}
        />
      </div>

      {showSkillsOnboarding && OnboardingComponent && (
        <OnboardingComponent
          onClose={() => {
            setShowSkillsOnboarding(false);
            checkSkills();
          }}
        />
      )}
    </>
  );
}

function StatusRow({
  ok,
  label,
  detail,
  action,
  secondaryAction,
}: {
  ok: boolean;
  label: string;
  detail: string;
  action?: StatusRowAction;
  /** Shown to the left of `action` — the maintenance option ("Reinstall",
   * "Start") that sits alongside the primary one. */
  secondaryAction?: StatusRowAction;
}) {
  return (
    <div className="flex min-h-12 min-w-0 items-center gap-3 px-4 py-3">
      <div
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-md border",
          ok
            ? "border-green-500/20 bg-green-500/10 text-green-600"
            : "border-border/70 bg-muted/30 text-muted-foreground",
        )}
      >
        {ok ? (
          <CheckCircle2Icon className="size-3.5" />
        ) : (
          <CircleIcon className="size-3.5" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 items-baseline gap-3">
        <span
          className={cn(
            "w-32 shrink-0 truncate font-medium text-sm",
            ok ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {label}
        </span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
          {detail}
        </span>
      </div>
      {secondaryAction && <StatusRowButton action={secondaryAction} />}
      {action && <StatusRowButton action={action} />}
    </div>
  );
}

interface StatusRowAction {
  label: string;
  onClick?: () => void;
  loading?: boolean;
  disabled?: boolean;
  icon?: "download" | "key" | "settings" | "refresh" | "play";
}

function StatusRowButton({ action }: { action: StatusRowAction }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 shrink-0 rounded-md px-2.5 text-xs"
      onClick={action.onClick}
      disabled={action.loading || action.disabled}
    >
      {action.loading ? (
        <Loader2Icon className="mr-1 size-3 animate-spin" />
      ) : action.icon === "key" ? (
        <KeyRoundIcon className="mr-1 size-3" />
      ) : action.icon === "settings" ? (
        <SettingsIcon className="mr-1 size-3" />
      ) : action.icon === "refresh" ? (
        <RefreshCwIcon className="mr-1 size-3" />
      ) : action.icon === "play" ? (
        <PlayIcon className="mr-1 size-3" />
      ) : (
        <DownloadIcon className="mr-1 size-3" />
      )}
      {action.label}
    </Button>
  );
}
