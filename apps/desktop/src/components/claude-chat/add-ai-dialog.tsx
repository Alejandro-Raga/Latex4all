import { Loader2Icon } from "lucide-react";
import { ClaudeSetup } from "@/components/claude-setup";
import { EngineRow } from "@/components/settings/agent-accounts";
import { Button } from "@/components/ui/button";
import {
  CLAUDE_CODE_PROVIDER_ID,
  useClaudeChatStore,
} from "@/stores/claude-chat-store";
import { useClaudeSetupStore } from "@/stores/claude-setup-store";

/** Claude through Claude Code, signed in with a Claude plan. */
function ClaudeRow({ onUse }: { onUse: () => void }) {
  const status = useClaudeSetupStore((s) => s.status);
  const email = useClaudeSetupStore((s) => s.accountEmail);
  const configured = useClaudeSetupStore((s) => s.claudeProviderConfigured);
  const installing = useClaudeSetupStore((s) => s.isInstalling);
  const loggingIn = useClaudeSetupStore((s) => s.isLoggingIn);
  const { install, login } = useClaudeSetupStore.getState();

  let detail = "Your Claude plan (Pro or Max).";
  let action: React.ReactNode = null;
  if (installing || loggingIn || status === "checking") {
    detail = loggingIn
      ? "Finish signing in in your browser…"
      : "Getting ready…";
    action = (
      <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
    );
  } else if (status === "not-installed") {
    action = (
      <Button size="sm" variant="outline" onClick={() => install()}>
        Install
      </Button>
    );
  } else if (status === "not-authenticated" || !configured) {
    action = (
      <Button size="sm" onClick={() => login()}>
        Sign in
      </Button>
    );
  } else if (status === "ready") {
    detail = email ?? "Ready";
    action = (
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          useClaudeChatStore
            .getState()
            .setSelectedProviderCredentialId(CLAUDE_CODE_PROVIDER_ID);
          onUse();
        }}
      >
        Use in chat
      </Button>
    );
  }
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3">
      <div className="min-w-0">
        <div className="text-sm">Claude</div>
        <div className="truncate text-muted-foreground text-xs">{detail}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">{action}</div>
    </div>
  );
}

const heading =
  "px-5 pt-3 pb-1 font-medium text-muted-foreground text-xs uppercase tracking-wide";

/**
 * Adding an AI to the chat: signed in with an account you already have
 * (no key, your plan's limits), or with an API key (paid by use; some have
 * a free tier).
 */
export function AddAiContent({
  onUse,
  onSaved,
  onCancel,
}: {
  onUse: () => void;
  onSaved: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="-mx-6 min-w-0">
      <div className={heading}>Sign in with your account</div>
      <ClaudeRow onUse={onUse} />
      <EngineRow engine="codex" onUse={onUse} />
      <EngineRow engine="gemini" onUse={onUse} />

      <div className="mt-2 border-border border-t">
        <div className={heading}>Or use an API key</div>
        <p className="px-5 pb-2 text-muted-foreground text-xs">
          Paid by use. Free options: a Gemini key from Google AI Studio, or
          Ollama running models on your computer.
        </p>
        <div className="px-5">
          <ClaudeSetup
            variant="provider-dialog"
            onCancel={onCancel}
            onSaved={onSaved}
          />
        </div>
      </div>
    </div>
  );
}
