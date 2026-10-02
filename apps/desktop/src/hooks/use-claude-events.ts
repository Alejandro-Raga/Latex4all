import { useEffect, useRef } from "react";
import { isLimitText, onLimitHit } from "@/lib/ai-continuity";
import { useAgentAccounts } from "@/lib/agent-accounts";
import { missingCitations } from "@/lib/citations";
import { appendLog, shortAsk } from "@/lib/ai-memory";
import {
  engineErrorMessage,
  engineOfProviderKey,
  isEngineErrorLine,
  newTranslateState,
  type TranslateState,
  translateAgentLine,
} from "@/lib/agent-events";
import {
  codexLimitsFrom,
  type RateLimitInfo,
  useAiUsage,
  windowName,
} from "@/lib/ai-usage";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { remove } from "@tauri-apps/plugin-fs";
import {
  CLAUDE_CODE_PROVIDER_ID,
  useClaudeChatStore,
  type ClaudeStreamMessage,
  providerLabel,
} from "@/stores/claude-chat-store";
import { useDocumentStore, withDiskContent } from "@/stores/document-store";
import { useHistoryStore } from "@/stores/history-store";
import { useProposedChangesStore } from "@/stores/proposed-changes-store";
import { useSettingsStore } from "@/stores/settings-store";
import { readTexFileContent } from "@/lib/tauri/fs";
import {
  compileLatex,
  resolveCompileTarget,
  formatCompileError,
} from "@/lib/latex-compiler";
import { createLogger } from "@/lib/debug/logger";

const log = createLogger("claude-event");

async function cleanupTemporaryFiles(paths: string[]) {
  await Promise.all(
    paths.map(async (path) => {
      try {
        await remove(path);
      } catch (err) {
        log.warn("failed to remove temporary chat file", {
          path,
          error: String(err),
        });
      }
    }),
  );
}

/** Backend event payload shapes (include tab_id for routing) */
interface ClaudeOutputPayload {
  tab_id: string;
  data: string;
}

interface ClaudeCompletePayload {
  tab_id: string;
  success: boolean;
}

interface ClaudeErrorPayload {
  tab_id: string;
  data: string;
}

/**
 * Hook that manages Tauri event listeners for Claude CLI streaming output.
 *
 * Listeners are kept alive at all times (no race condition with invoke).
 * Per-tab mutable state (pendingToolUses, hasTexChanges) is stored in Maps
 * keyed by tab_id so multiple tabs can stream concurrently.
 */
export function useClaudeEvents() {
  // Per-tab mutable state stored in refs so the long-lived listeners
  // always read the latest values without needing to be re-created.
  const pendingToolUsesRef = useRef(
    new Map<string, Map<string, { name: string; input: any }>>(),
  );
  const hasTexChangesRef = useRef(new Map<string, boolean>());
  const cancelledForAskRef = useRef(new Map<string, boolean>());
  const lastErrorRef = useRef(new Map<string, string>());
  const directProviderTabRef = useRef(new Map<string, boolean>());
  const listenersRef = useRef<UnlistenFn[]>([]);
  const msgCountRef = useRef(new Map<string, number>());
  // Per request (tab and start time), for ChatGPT and Gemini translation.
  const translateStatesRef = useRef(new Map<string, TranslateState>());
  // ChatGPT's and Gemini's last error line, for when they stop silently.
  const engineErrorRef = useRef(new Map<string, string>());
  const streamStartTimeRef = useRef(new Map<string, number>());
  const lastMsgTimeRef = useRef(new Map<string, number>());

  // Reset per-tab state whenever any tab starts streaming
  const tabs = useClaudeChatStore((s) => s.tabs);
  useEffect(() => {
    for (const tab of tabs) {
      if (tab.isStreaming && !msgCountRef.current.has(tab.id)) {
        // New stream detected for this tab — initialize state
        pendingToolUsesRef.current.set(tab.id, new Map());
        hasTexChangesRef.current.set(tab.id, false);
        cancelledForAskRef.current.set(tab.id, false);
        lastErrorRef.current.delete(tab.id);
        const providerKey = tab.sessionProviderKey ?? tab.providerKey;
        directProviderTabRef.current.set(
          tab.id,
          !!providerKey && providerKey !== CLAUDE_CODE_PROVIDER_ID,
        );
        msgCountRef.current.set(tab.id, 0);
        streamStartTimeRef.current.delete(tab.id);
        lastMsgTimeRef.current.delete(tab.id);
      } else if (!tab.isStreaming) {
        // Clean up finished tab state
        msgCountRef.current.delete(tab.id);
        streamStartTimeRef.current.delete(tab.id);
        lastMsgTimeRef.current.delete(tab.id);
      }
    }
  }, [tabs]);

  // ── One-time listener setup (mount only) ──
  useEffect(() => {
    function setUserVisibleError(tabId: string, message: string) {
      lastErrorRef.current.set(tabId, message);
      useClaudeChatStore.getState()._setError(tabId, message);
    }

    function providerErrorMessage(payload: string): string | null {
      const trimmed = payload.trim();
      if (!trimmed) return null;
      const lower = trimmed.toLowerCase();
      const looksProviderRelated =
        lower.includes("provider") ||
        lower.includes("openai") ||
        lower.includes("api key") ||
        lower.includes("unauthorized") ||
        lower.includes("401") ||
        lower.includes("403") ||
        lower.includes("404") ||
        lower.includes("429") ||
        lower.includes("too many requests") ||
        lower.includes("rate limit") ||
        lower.includes("invalid model") ||
        lower.includes("model access") ||
        lower.includes("tool_calls") ||
        lower.includes("unsupported parameter") ||
        lower.includes("does not support") ||
        lower.includes("base url");
      if (!looksProviderRelated) return null;
      return trimmed.length > 800 ? `${trimmed.slice(0, 800)}...` : trimmed;
    }

    async function registerProposedChange(
      filePath: string,
      toolUseId: string,
      toolName: string,
      tabId?: string,
    ) {
      const docState = useDocumentStore.getState();
      const projectRoot = docState.projectRoot;
      let relativePath = filePath;
      if (projectRoot && filePath.startsWith(projectRoot)) {
        relativePath = filePath.slice(projectRoot.length).replace(/^\//, "");
      }
      const file = docState.files.find(
        (f) => f.relativePath === relativePath || f.absolutePath === filePath,
      );
      if (!file) return;

      const oldContent = file.content ?? "";
      try {
        // Claude's edit on top of what's here now, which may include unsaved
        // edits (or a collaborator's) that Claude's copy on disk lacks.
        const disk = await readTexFileContent(file.absolutePath);
        const newContent = withDiskContent(file, disk).content ?? disk;
        if (oldContent !== newContent) {
          useProposedChangesStore.getState().addChange({
            id: toolUseId,
            filePath: file.relativePath,
            absolutePath: file.absolutePath,
            oldContent,
            newContent,
            toolName,
          });
          // Part of this reply's work, to take back in one go.
          if (tabId) {
            const chat = useClaudeChatStore.getState();
            const turn = chat.tabs.find((t) => t.id === tabId)?.lastTurn;
            chat._patchTab(tabId, {
              lastTurn: {
                changeIds: [...(turn?.changeIds ?? []), toolUseId],
                files: [
                  ...new Set([...(turn?.files ?? []), file.relativePath]),
                ],
              },
            });
          }
        }
      } catch {
        // readTexFileContent failed — not critical
      }
    }

    function elapsed(tabId: string) {
      const start = streamStartTimeRef.current.get(tabId);
      if (!start) return "";
      return `+${((performance.now() - start) / 1000).toFixed(1)}s`;
    }

    function handleStreamMessage(payload: ClaudeOutputPayload) {
      const { tab_id: tabId, data } = payload;

      // ChatGPT and Gemini speak their own formats: translated first.
      const tab = useClaudeChatStore
        .getState()
        .tabs.find((t) => t.id === tabId);
      const engine = engineOfProviderKey(
        tab?.sessionProviderKey ?? tab?.providerKey,
      );
      if (engine) {
        const key = `${tabId}:${tab?.streamingStartedAt ?? 0}`;
        let st = translateStatesRef.current.get(key);
        if (!st) {
          // The model asked for, so the reply and usage name it (Codex's
          // events don't; Gemini's do, and override it).
          st = newTranslateState(
            useAgentAccounts.getState().models[engine] || "",
          );
          translateStatesRef.current.set(key, st);
        }
        for (const msg of translateAgentLine(engine, data, st)) {
          handleParsed(tabId, msg);
        }
        return;
      }

      let msg: ClaudeStreamMessage;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      handleParsed(tabId, msg);
    }

    function handleParsed(tabId: string, msg: ClaudeStreamMessage) {
      const chatStore = useClaudeChatStore.getState();

      // Only process messages if this tab is still streaming
      const tab = chatStore.tabs.find((t) => t.id === tabId);
      if (!tab?.isStreaming) return;

      const count = (msgCountRef.current.get(tabId) ?? 0) + 1;
      msgCountRef.current.set(tabId, count);
      const now = performance.now();
      if (count === 1) streamStartTimeRef.current.set(tabId, now);
      const lastTime = lastMsgTimeRef.current.get(tabId);
      const gap = lastTime ? ((now - lastTime) / 1000).toFixed(1) : "0";
      lastMsgTimeRef.current.set(tabId, now);

      // Log ALL message types with gap detection
      const contentTypes =
        msg.message?.content?.map((b: any) => b.type).join(",") ?? "";
      const gapWarning = Number(gap) > 10 ? ` GAP ${gap}s` : "";
      log.debug(
        `[${tabId}] ${elapsed(tabId)} #${count} type=${msg.type} sub=${msg.subtype ?? ""} content=[${contentTypes}] gap=${gap}s${gapWarning}`,
      );

      if (msg.type === "assistant") {
        const thinkingBlock = msg.message?.content?.find(
          (b: any) => b.type === "thinking",
        );
        if (thinkingBlock) {
          log.debug(
            `[${tabId}] ${elapsed(tabId)} thinking: ${(thinkingBlock.thinking || "").slice(0, 100)}`,
          );
        }
        const textBlock = msg.message?.content?.find(
          (b: any) => b.type === "text",
        );
        if (textBlock?.text) {
          log.debug(
            `[${tabId}] ${elapsed(tabId)} text: ${textBlock.text.slice(0, 100)}`,
          );
        }
        const toolBlock = msg.message?.content?.find(
          (b: any) => b.type === "tool_use",
        );
        if (toolBlock) {
          log.debug(
            `[${tabId}] ${elapsed(tabId)} tool_use: ${toolBlock.name} ${toolBlock.input?.file_path ?? ""}`,
          );
        }
      }
      if (msg.type === "user" && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === "tool_result") {
            const preview =
              typeof block.content === "string"
                ? block.content.slice(0, 80)
                : JSON.stringify(block.content)?.slice(0, 80);
            log.debug(
              `[${tabId}] ${elapsed(tabId)} tool_result: id=${block.tool_use_id} err=${block.is_error ?? false} len=${preview?.length ?? 0}`,
            );
          }
        }
      }
      if (msg.type === "result") {
        log.info(
          `[${tabId}] ${elapsed(tabId)} result cost=$${msg.cost_usd} api=${msg.duration_api_ms}ms total=${msg.duration_ms}ms`,
        );
        if (
          msg.is_error &&
          msg.subtype !== "cancelled" &&
          typeof msg.result === "string" &&
          msg.result.trim()
        ) {
          setUserVisibleError(tabId, msg.result.trim());
        }
      }

      // A request stopped by a usage limit (429, quota, balance…).
      if (msg.type === "result" && msg.is_error && isLimitText(msg.result)) {
        chatStore._patchTab(tabId, { limitHit: true });
      }

      // Extract session_id from system:init
      if (msg.type === "system" && msg.subtype === "init" && msg.session_id) {
        chatStore._setSessionId(tabId, msg.session_id);
      }
      // How this session is paid: "none" is a Claude plan sign-in.
      if (msg.type === "system" && msg.subtype === "init") {
        const source = (msg as { apiKeySource?: string }).apiKeySource;
        if (source) chatStore._patchTab(tabId, { apiKeySource: source });
      }

      // Claude's plan limits: kept for the usage meter (and a switch to
      // another service when one is reached), never shown as chat.
      if ((msg as any).type === "rate_limit_event") {
        const info = (msg as any).rate_limit_info as RateLimitInfo | undefined;
        if (info) {
          const resetsAt = info.resetsAt
            ? new Date(info.resetsAt * 1000).toLocaleTimeString()
            : "unknown";
          log.warn(
            `[${tabId}] rate_limit: status=${info.status} type=${info.rateLimitType} resets=${resetsAt}`,
          );
          useAiUsage.getState().recordLimits(info);
          if (info.status === "rejected") {
            // This request ran out: when it ends, the chat carries on.
            chatStore._patchTab(tabId, { limitHit: true });
            chatStore._setError(
              tabId,
              `Claude's ${info.rateLimitType === "seven_day" ? "weekly" : "5-hour"} limit is reached. It resets at ${resetsAt}.`,
            );
          }
        }
        return;
      }

      // Track tool_use blocks for file change detection
      const tabToolUses = pendingToolUsesRef.current.get(tabId) ?? new Map();
      if (msg.type === "assistant" && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === "tool_use" && block.id && block.name) {
            tabToolUses.set(block.id, {
              name: block.name,
              input: block.input,
            });
          }
        }
        pendingToolUsesRef.current.set(tabId, tabToolUses);
      }

      // Detect file modifications from tool_results → register as proposed changes
      if (msg.type === "user" && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === "tool_result" && block.tool_use_id) {
            const toolUse = tabToolUses.get(block.tool_use_id);
            if (
              toolUse &&
              !block.is_error &&
              /^(Write|write|Edit|edit|MultiEdit|multiedit)$/.test(toolUse.name)
            ) {
              const fp = toolUse.input?.file_path || toolUse.input?.path;
              if (fp) {
                registerProposedChange(
                  fp,
                  block.tool_use_id!,
                  toolUse.name,
                  tabId,
                );
                if (/\.(tex|bib|sty|cls|dtx)$/i.test(fp)) {
                  hasTexChangesRef.current.set(tabId, true);
                }
              }
            }
          }
        }
      }

      // Skip duplicate user messages we already added locally
      if (
        msg.type === "user" &&
        msg.message?.content?.length === 1 &&
        msg.message.content[0].type === "text"
      ) {
        return;
      }

      chatStore._appendMessage(tabId, msg);

      // When a UI-pause tool is detected, cancel the process so the user
      // can interact with the widget before Claude continues.
      if (msg.type === "assistant" && msg.message?.content) {
        const hasUiPauseTool = msg.message.content.some(
          (b: any) =>
            b.type === "tool_use" &&
            (b.name === "AskUserQuestion" || b.name === "ExitPlanMode"),
        );
        if (hasUiPauseTool) {
          log.info(
            `[${tabId}] ${elapsed(tabId)} UI-pause tool detected - cancelling process for user input`,
          );
          cancelledForAskRef.current.set(tabId, true);
          invoke("cancel_claude_execution", { tabId }).catch(() => {});
        }
      }
    }

    async function handleComplete(payload: ClaudeCompletePayload) {
      const { tab_id: tabId, success } = payload;
      const count = msgCountRef.current.get(tabId) ?? 0;

      log.info(
        `[${tabId}] complete success=${success} (${count} messages) cancelledForAsk=${cancelledForAskRef.current.get(tabId) ?? false}`,
      );
      const chatStore = useClaudeChatStore.getState();

      // Guard against duplicate complete events
      const tab = chatStore.tabs.find((t) => t.id === tabId);
      if (!tab?.isStreaming) {
        log.warn(
          `[${tabId}] ignoring duplicate complete event (not streaming)`,
        );
        return;
      }

      const engine = engineOfProviderKey(
        tab.sessionProviderKey ?? tab.providerKey,
      );
      const engineError = engineErrorRef.current.get(tabId) ?? null;
      engineErrorRef.current.delete(tabId);
      // Out of usage: carry on with the next AI (once the state's settled).
      const ranOut =
        !chatStore._cancelledByUser &&
        (useClaudeChatStore.getState().tabs.find((t) => t.id === tabId)
          ?.limitHit ||
          isLimitText(engineError));
      if (ranOut) {
        const lastUser = [...tab.messages]
          .reverse()
          .find((m) => m.type === "user" && m.message?.content?.[0]?.text);
        const request = (lastUser?.message?.content?.[0]?.text ?? "")
          .split("\n")
          .filter((l) => !/^(@|~@|\[)/.test(l.trim()))
          .join("\n")
          .trim();
        setTimeout(() => onLimitHit(tabId, request || null), 0);
      }
      if (engine && !success && !tab.error && !chatStore._cancelledByUser) {
        chatStore._setError(tabId, engineErrorMessage(engine, engineError));
      } else if (
        !success &&
        !tab.error &&
        !lastErrorRef.current.get(tabId) &&
        !cancelledForAskRef.current.get(tabId) &&
        !chatStore._cancelledByUser
      ) {
        const isDirectProvider = directProviderTabRef.current.get(tabId);
        if (count === 0) {
          const isWindows = navigator.userAgent.includes("Windows");
          chatStore._setError(
            tabId,
            isDirectProvider
              ? "AI provider request failed to start. Check the provider API key, Base URL, model name, and model access."
              : isWindows
                ? "Claude process failed to start. Check that Claude Code CLI is installed and git-bash is available."
                : "Claude process failed to start. Check that Claude Code CLI is installed.",
          );
        } else {
          chatStore._setError(
            tabId,
            isDirectProvider
              ? "AI provider request stopped unexpectedly. Check the provider API key, model access, Base URL, tool-call support, or rate limits."
              : "Claude process exited unexpectedly. This may be due to rate limiting or an API error.",
          );
        }
      }

      // For the project's other assistants: who did what, to which files.
      if (tab.projectPath && !chatStore._cancelledByUser) {
        const root = tab.projectPath;
        const files = new Set<string>();
        for (const use of pendingToolUsesRef.current.get(tabId)?.values() ??
          []) {
          const path = use.input?.file_path ?? use.input?.path;
          if (
            typeof path === "string" &&
            /^(Write|Edit|MultiEdit)$/i.test(use.name)
          ) {
            files.add(
              path.startsWith(root)
                ? path.slice(root.length).replace(/^[\\/]/, "")
                : path,
            );
          }
        }
        const lastUser = [...tab.messages]
          .reverse()
          .find((m) => m.type === "user" && m.message?.content?.[0]?.text);
        const ask = shortAsk(lastUser?.message?.content?.[0]?.text ?? "");
        // Citations the reply added that the bibliography lacks. Only with a
        // .bib to check against (not \\begin{thebibliography}), and only
        // keys it newly cited, not ones already missing before.
        const texChanged = [...files].filter((f) => f.endsWith(".tex"));
        const bibFiles = useDocumentStore
          .getState()
          .files.filter((f) => f.name.toLowerCase().endsWith(".bib"));
        if (success && texChanged.length && bibFiles.length) {
          const before = useProposedChangesStore
            .getState()
            .changes.filter((c) => c.filePath.endsWith(".tex"))
            .map((c) => c.oldContent);
          void (async () => {
            const tex = await Promise.all(
              texChanged.map((f) =>
                readTexFileContent(
                  /^([A-Za-z]:)?[\\/]/.test(f) ? f : `${root}/${f}`,
                ).catch(() => ""),
              ),
            );
            const bibs = await Promise.all(
              bibFiles.map((f) =>
                readTexFileContent(f.absolutePath).catch(() => f.content ?? ""),
              ),
            );
            const already = new Set(missingCitations(before, bibs));
            const missing = missingCitations(tex, bibs).filter(
              (k) => !already.has(k),
            );
            useClaudeChatStore.getState()._patchTab(tabId, {
              citationWarning: missing.length ? missing : null,
            });
          })();
        }
        // What share of the plan window this request used, measured: the
        // window's use now against when it went out (same window only).
        const before = tab.windowBefore;
        if (success && before) {
          const threadId = tab.sessionId;
          void (async () => {
            let used: number | undefined;
            let resetsAt: number | undefined;
            let name = "5h";
            if (before.service === "codex") {
              const raw = await invoke("codex_rate_limits", {
                threadId: threadId ?? null,
              }).catch(() => null);
              const limits = codexLimitsFrom(raw);
              if (limits) useAiUsage.getState().setCodexLimits(limits);
              const w = limits?.primary;
              if (w) {
                used = w.usedPercent;
                resetsAt = w.resetsAt;
                name = windowName(w.minutes);
              }
            } else {
              const w = useAiUsage.getState().claudeLimits?.fiveHour;
              if (w) {
                used = w.utilization * 100;
                resetsAt = w.resetsAt;
              }
            }
            if (used === undefined || resetsAt !== before.resetsAt) return;
            const delta = Math.max(0, used - before.used);
            useAiUsage.getState().setWindowDelta(tabId, delta, name);
            useClaudeChatStore
              .getState()
              ._annotateLastResult(tabId, { windowDelta: delta, window: name });
          })();
        }
        if (success || files.size) {
          void appendLog(root, {
            at: Date.now(),
            who: providerLabel(tab.sessionProviderKey ?? tab.providerKey),
            tab: tabId,
            ask,
            files: [...files],
          });
        }
      }

      // Clean up per-tab state
      for (const key of translateStatesRef.current.keys()) {
        if (key.startsWith(`${tabId}:`)) translateStatesRef.current.delete(key);
      }
      pendingToolUsesRef.current.delete(tabId);
      hasTexChangesRef.current.delete(tabId);
      cancelledForAskRef.current.delete(tabId);
      lastErrorRef.current.delete(tabId);
      directProviderTabRef.current.delete(tabId);

      const completedSessionId = tab.sessionId;
      chatStore._setStreaming(tabId, false);
      void cleanupTemporaryFiles(chatStore.consumeTemporaryFilePaths(tabId));

      const forceQueuedGuidance = tab.forceQueuedGuidanceOnComplete === true;
      if (forceQueuedGuidance) {
        const queuedGuidance = useClaudeChatStore
          .getState()
          .consumeQueuedGuidance(tabId, tab.forcedQueuedGuidanceId);
        if (queuedGuidance) {
          log.info(`[${tabId}] interrupting current run with queued guidance`);
          void useClaudeChatStore
            .getState()
            .sendPrompt(queuedGuidance.prompt, queuedGuidance.contextOverride, {
              tabId,
              preserveTabProvider: true,
            });
          return;
        }
      }

      // Snapshot after Claude edit
      const projectPath = useDocumentStore.getState().projectRoot;
      if (projectPath && completedSessionId) {
        void (async () => {
          try {
            const title = await invoke<string | null>(
              "generate_claude_session_title",
              {
                projectPath,
                sessionId: completedSessionId,
              },
            );
            if (title) {
              useClaudeChatStore
                .getState()
                ._setSessionTitle(completedSessionId, title);
            }
          } catch (err) {
            log.warn("failed to refresh completed session title", {
              error: String(err),
            });
          }
        })();
      }

      if (projectPath) {
        try {
          await useHistoryStore
            .getState()
            .createSnapshot(projectPath, "[claude] After Claude edit");
        } catch {
          // snapshot failure should not break the flow
        }
      }

      const docStore = useDocumentStore.getState();
      await docStore.refreshFiles();

      const queuedGuidance = success
        ? useClaudeChatStore.getState().consumeQueuedGuidance(tabId)
        : null;
      if (queuedGuidance) {
        log.info(`[${tabId}] continuing with queued guidance`);
        void useClaudeChatStore
          .getState()
          .sendPrompt(queuedGuidance.prompt, queuedGuidance.contextOverride, {
            tabId,
            preserveTabProvider: true,
          });
        return;
      }

      // Auto-recompile after Claude finishes
      const {
        projectRoot,
        files,
        activeFileId,
        isCompiling: alreadyCompiling,
      } = useDocumentStore.getState();
      if (projectRoot && !alreadyCompiling) {
        const resolved = resolveCompileTarget(activeFileId, files);
        if (resolved) {
          const { rootId, targetPath } = resolved;
          useDocumentStore.getState().setIsCompiling(true);
          useDocumentStore.getState().setPendingRecompile(false);
          try {
            await useDocumentStore.getState().saveAllFiles();
            const texlive =
              useSettingsStore.getState().compilerBackend === "texlive";
            const pdfData = await compileLatex(
              projectRoot,
              targetPath,
              texlive,
            );
            useDocumentStore.getState().setPdfData(pdfData, rootId);
          } catch (err) {
            useDocumentStore
              .getState()
              .setCompileError(formatCompileError(err), rootId);
          } finally {
            useDocumentStore.getState().setIsCompiling(false);
          }
        }
      } else if (alreadyCompiling) {
        // Queue recompile — it will run when the current compile finishes
        useDocumentStore.getState().setPendingRecompile(true);
        log.info("queued post-Claude recompile — already compiling");
      }
    }

    // Set up listeners once and keep them alive for the component lifetime.
    // Each listener is added to listenersRef immediately after registration
    // to avoid a race condition where unmount happens mid-setup.
    let cancelled = false;
    (async () => {
      const unlistenOutput = await listen<ClaudeOutputPayload>(
        "claude-output",
        (event) => {
          if (!cancelled) handleStreamMessage(event.payload);
        },
      );
      if (cancelled) {
        unlistenOutput();
        return;
      }
      listenersRef.current.push(unlistenOutput);

      const unlistenComplete = await listen<ClaudeCompletePayload>(
        "claude-complete",
        (event) => {
          if (!cancelled) handleComplete(event.payload);
        },
      );
      if (cancelled) {
        unlistenComplete();
        return;
      }
      listenersRef.current.push(unlistenComplete);

      const unlistenError = await listen<ClaudeErrorPayload>(
        "claude-error",
        (event) => {
          if (!cancelled) {
            const { tab_id: tabId, data: payload } = event.payload;
            log.warn(`[${tabId}] stderr: ${payload}`);
            const errTab = useClaudeChatStore
              .getState()
              .tabs.find((t) => t.id === tabId);
            // ChatGPT and Gemini: only real errors, kept for when they stop;
            // their other chatter (colour support, YOLO mode…) isn't news.
            if (
              engineOfProviderKey(
                errTab?.sessionProviderKey ?? errTab?.providerKey,
              )
            ) {
              if (isEngineErrorLine(payload)) {
                engineErrorRef.current.set(tabId, payload.trim());
              }
              return;
            }
            if (
              payload.includes("Error") ||
              payload.includes("error") ||
              payload.includes("ECONNREFUSED") ||
              payload.includes("timeout")
            ) {
              log.error(`[${tabId}] CRITICAL: ${payload}`);
            }
            const isDirectProvider = directProviderTabRef.current.get(tabId);
            const providerMessage =
              isDirectProvider || providerErrorMessage(payload)
                ? providerErrorMessage(payload) || payload.trim()
                : null;
            if (providerMessage) {
              setUserVisibleError(tabId, providerMessage);
            }
            // Surface critical stderr messages to the user UI (only if no error is already set)
            if (
              (payload.includes("git-bash") ||
                payload.includes("git bash") ||
                payload.includes("bash.exe")) &&
              !useClaudeChatStore.getState().tabs.find((t) => t.id === tabId)
                ?.error
            ) {
              useClaudeChatStore
                .getState()
                ._setError(
                  tabId,
                  "Claude Code requires git-bash on Windows. Please install Git for Windows or set the CLAUDE_CODE_GIT_BASH_PATH environment variable.",
                );
            }
          }
        },
      );
      if (cancelled) {
        unlistenError();
        return;
      }
      listenersRef.current.push(unlistenError);
    })();

    return () => {
      cancelled = true;
      for (const unlisten of listenersRef.current) {
        unlisten();
      }
      listenersRef.current = [];
    };
  }, []); // mount-only
}
