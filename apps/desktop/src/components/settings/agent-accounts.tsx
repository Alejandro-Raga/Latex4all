import { useEffect } from "react";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAgentAccounts } from "@/lib/agent-accounts";
import {
  type AgentEngine,
  ENGINE_LABELS,
  providerOfEngine,
} from "@/lib/agent-events";
import { useClaudeChatStore } from "@/stores/claude-chat-store";

const ABOUT: Record<AgentEngine, string> = {
  codex: "Your ChatGPT account, free or paid (paid plans get more use).",
  gemini:
    "Paid Gemini Code Assist plans only: Google no longer accepts free accounts here. For free use, add a Gemini API key above.",
};

function EngineRow({ engine }: { engine: AgentEngine }) {
  const status = useAgentAccounts((s) => s.status[engine]);
  const busy = useAgentAccounts((s) => s.busy[engine]);
  const { install, login, logout } = useAgentAccounts.getState();
  const useIt = () =>
    useClaudeChatStore
      .getState()
      .setSelectedProviderCredentialId(providerOfEngine(engine));

  let detail: string = ABOUT[engine];
  let action: React.ReactNode = null;
  if (busy) {
    detail =
      busy === "install"
        ? "Installing…"
        : busy === "login"
          ? "Finish signing in in your browser…"
          : "Signing out…";
    action = (
      <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
    );
  } else if (!status) {
    action = null;
  } else if (!status.installed) {
    action = status.can_install ? (
      <Button size="sm" variant="outline" onClick={() => install(engine)}>
        Install
      </Button>
    ) : (
      <button
        type="button"
        onClick={() => void shellOpen("https://nodejs.org")}
        className="text-primary text-xs hover:underline"
      >
        Needs Node.js
      </button>
    );
  } else if (!status.signed_in) {
    action = (
      <Button size="sm" onClick={() => login(engine)}>
        Sign in
      </Button>
    );
  } else {
    detail = status.account ?? "Signed in";
    action = (
      <>
        <Button size="sm" variant="outline" onClick={useIt}>
          Use in chat
        </Button>
        <Button size="sm" variant="ghost" onClick={() => logout(engine)}>
          Sign out
        </Button>
      </>
    );
  }

  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3">
      <div className="min-w-0">
        <div className="text-sm">{ENGINE_LABELS[engine]}</div>
        <div className="truncate text-muted-foreground text-xs">{detail}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">{action}</div>
    </div>
  );
}

/** ChatGPT and Gemini, signed in with your own account instead of a key. */
export function AgentAccounts() {
  useEffect(() => {
    const { refresh } = useAgentAccounts.getState();
    void refresh("codex");
    void refresh("gemini");
  }, []);
  return (
    <div className="border-border border-t py-2">
      <div className="px-5 pt-2 pb-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
        Sign in with an account
      </div>
      <EngineRow engine="codex" />
      <EngineRow engine="gemini" />
    </div>
  );
}
