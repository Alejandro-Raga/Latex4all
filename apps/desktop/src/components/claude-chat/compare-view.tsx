import { useEffect, useState } from "react";
import { Loader2Icon, XIcon } from "lucide-react";
import { create } from "zustand";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFallbackChoices } from "@/lib/fallback-choices";
import {
  CLAUDE_CODE_PROVIDER_ID,
  type ClaudeStreamMessage,
  providerKeyForSelectedCredential,
  providerLabel,
  useClaudeChatStore,
} from "@/stores/claude-chat-store";
import { MarkdownRenderer } from "./markdown-renderer";

/** Both answer; neither edits, so they can run side by side. */
const ANSWER_ONLY =
  "Answer only: do not change any files. Another assistant is answering the same question, for comparison.";

export const useCompare = create<{
  /** Asking the question. */
  asking: boolean;
  /** The two chats answering, once sent. */
  tabs: [string, string] | null;
  ask: () => void;
  close: () => void;
  start: (question: string, other: string) => void;
}>((set) => ({
  asking: false,
  tabs: null,
  ask: () => set({ asking: true }),
  close: () => set({ asking: false, tabs: null }),
  start: (question, other) => {
    const chat = useClaudeChatStore.getState();
    const a = chat.createTab();
    const b = chat.createTab();
    chat._patchTab(b, { providerKey: providerKeyForSelectedCredential(other) });
    chat.setActiveTab(a);
    for (const id of [a, b]) {
      void chat.sendPrompt(`${ANSWER_ONLY}\n\n${question}`, undefined, {
        tabId: id,
        evenIfBusy: true,
      });
    }
    set({ asking: false, tabs: [a, b] });
  },
}));

/** The question, and which service answers beside the current one. */
export function CompareDialog() {
  const asking = useCompare((s) => s.asking);
  const choices = useFallbackChoices();
  const current = useClaudeChatStore((s) => s.selectedProviderCredentialId);
  const currentId = current ?? CLAUDE_CODE_PROVIDER_ID;
  const options = [
    { id: CLAUDE_CODE_PROVIDER_ID, label: "Claude" },
    ...choices,
  ].filter((o) => o.id !== currentId);
  const [question, setQuestion] = useState("");
  const [other, setOther] = useState("");
  useEffect(() => {
    if (asking) setOther((o) => o || options[0]?.id || "");
  }, [asking, options]);

  return (
    <Dialog
      open={asking}
      onOpenChange={(o) => !o && useCompare.getState().close()}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ask two AIs</DialogTitle>
          <DialogDescription>
            {providerLabel(providerKeyForSelectedCredential(currentId))} and
            another answer side by side. Neither changes your files.
          </DialogDescription>
        </DialogHeader>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Is the argument in section 2 convincing?"
          className="h-28 w-full resize-y rounded-md border border-border bg-background p-2 text-sm"
          aria-label="Question"
        />
        {options.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            Add another AI first (the model menu → Add an AI).
          </p>
        ) : (
          <Select value={other} onValueChange={setOther}>
            <SelectTrigger className="w-full" aria-label="Second AI">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => useCompare.getState().close()}>
            Cancel
          </Button>
          <Button
            disabled={!question.trim() || !other}
            onClick={() => {
              useCompare.getState().start(question.trim(), other);
              setQuestion("");
            }}
          >
            Ask both
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A chat's answer so far: its replies' text after the question. */
function answerOf(messages: ClaudeStreamMessage[]): string {
  const result = [...messages].reverse().find((m) => m.type === "result");
  if (result?.result && !result.is_error) return result.result;
  return messages
    .filter((m) => m.type === "assistant")
    .flatMap((m) => m.message?.content ?? [])
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text)
    .join("");
}

/** The two answers side by side, each a click from carrying on. */
export function CompareView() {
  const ids = useCompare((s) => s.tabs);
  const tabs = useClaudeChatStore((s) => s.tabs);
  if (!ids) return null;
  const pair = ids.map((id) => tabs.find((t) => t.id === id));
  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-background">
      <div className="flex items-center gap-2 border-border border-b px-3 py-2">
        <span className="flex-1 font-medium text-sm">Two answers</span>
        <button
          type="button"
          onClick={() => useCompare.getState().close()}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Close comparison"
        >
          <XIcon className="size-4" />
        </button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 divide-x divide-border">
        {pair.map((tab, i) =>
          tab ? (
            <div key={tab.id} className="flex min-h-0 flex-col">
              <div className="flex items-center gap-2 px-3 py-1.5">
                <span className="flex-1 font-medium text-xs">
                  {providerLabel(tab.providerKey)}
                </span>
                {tab.isStreaming ? (
                  <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-xs"
                    onClick={() => {
                      useClaudeChatStore.getState().setActiveTab(tab.id);
                      useCompare.getState().close();
                    }}
                  >
                    Continue with this one
                  </Button>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
                {tab.error ? (
                  <p className="text-destructive text-xs">{tab.error}</p>
                ) : (
                  <MarkdownRenderer
                    content={answerOf(tab.messages) || "…"}
                    className="prose prose-sm dark:prose-invert max-w-none"
                  />
                )}
              </div>
            </div>
          ) : (
            <div key={ids[i]} />
          ),
        )}
      </div>
    </div>
  );
}
