import { create } from "zustand";
import { switchIfOut } from "@/lib/ai-continuity";
import { readLog, readMemory, sharedContext } from "@/lib/ai-memory";
import {
  ENGINE_LABELS,
  engineOfProvider,
  engineOfProviderKey,
} from "@/lib/agent-events";
import { useAgentAccounts } from "@/lib/agent-accounts";
import {
  type Billing,
  type ResultUsage,
  usageEntry,
  useAiUsage,
} from "@/lib/ai-usage";
import { invoke } from "@tauri-apps/api/core";
import { useDocumentStore } from "./document-store";
import { useHistoryStore } from "./history-store";
import { useClaudeSetupStore } from "./claude-setup-store";
import { createLogger } from "@/lib/debug/logger";

const log = createLogger("claude");
export const CLAUDE_CODE_PROVIDER_ID = "__claude-code__";
export const SELECTED_PROVIDER_CREDENTIAL_STORAGE_KEY =
  "latex4all:selected-provider-credential-id";

function providerSelectionStorage(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function loadSelectedProviderCredentialId(): string | null {
  const value = providerSelectionStorage()?.getItem(
    SELECTED_PROVIDER_CREDENTIAL_STORAGE_KEY,
  );
  const trimmed = value?.trim();
  return trimmed || null;
}

function persistSelectedProviderCredentialId(credentialId: string | null) {
  const storage = providerSelectionStorage();
  if (!storage) return;
  if (credentialId?.trim()) {
    storage.setItem(
      SELECTED_PROVIDER_CREDENTIAL_STORAGE_KEY,
      credentialId.trim(),
    );
  } else {
    storage.removeItem(SELECTED_PROVIDER_CREDENTIAL_STORAGE_KEY);
  }
}

/** Convert a character offset to 1-based line:col */
export function offsetToLineCol(
  content: string,
  offset: number,
): { line: number; col: number } {
  const before = content.slice(0, offset);
  const lines = before.split("\n");
  return { line: lines.length, col: lines[lines.length - 1].length + 1 };
}

// ─── Types ───

export interface ContentBlock {
  type: "text" | "tool_use" | "tool_result" | "thinking";
  // text block
  text?: string;
  // tool_use block
  id?: string;
  name?: string;
  input?: any;
  // tool_result block
  tool_use_id?: string;
  content?: any;
  is_error?: boolean;
  // thinking block
  thinking?: string;
  signature?: string;
}

export interface ClaudeStreamMessage {
  type: "system" | "assistant" | "user" | "result";
  subtype?: string;
  session_id?: string;
  model?: string;
  cwd?: string;
  tools?: string[];
  message?: {
    content?: ContentBlock[];
    usage?: { input_tokens: number; output_tokens: number };
  };
  usage?: { input_tokens: number; output_tokens: number };
  cost_usd?: number;
  /** How the request was paid, added when it's recorded. */
  billing?: Billing;
  /** Share of the plan window it used, measured once it ended. */
  windowDelta?: number;
  window?: string;
  duration_ms?: number;
  duration_api_ms?: number;
  result?: string;
  is_error?: boolean;
  num_turns?: number;
}

// ─── Tab Types ───

export interface TabDraft {
  input: string;
  pinnedContexts: {
    label: string;
    filePath: string;
    selectedText: string;
    imageDataUrl?: string;
    isTemporary?: boolean;
  }[];
}

export interface PromptContextOverride {
  label: string;
  filePath: string;
  selectedText: string;
  temporaryFilePaths?: string[];
}

export interface QueuedGuidance {
  id: string;
  prompt: string;
  contextOverride?: PromptContextOverride;
  createdAt: number;
  displayedInChat?: boolean;
}

export interface TabState {
  id: string;
  title: string;
  /** Named by the user: no generated title replaces it. */
  titleLocked?: boolean;
  projectPath: string | null;
  sessionId: string | null;
  /** Provider currently selected in the tab UI. */
  providerKey: string | null;
  /** Provider that last executed this session, used for safe resume/switching. */
  sessionProviderKey: string | null;
  messages: ClaudeStreamMessage[];
  isStreaming: boolean;
  streamingStartedAt: number | null;
  error: string | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  draft: TabDraft;
  queuedGuidance?: QueuedGuidance[];
  forceQueuedGuidanceOnComplete?: boolean;
  forcedQueuedGuidanceId?: string | null;
  pendingTemporaryFilePaths?: string[];
  /** When this chat last sent a request: what others did since is news. */
  lastRequestAt?: number;
  /** Waiting for this chat (by title) to stop editing the same project. */
  waitingFor?: string | null;
  /** The request that's waiting, as typed. */
  waitingText?: string | null;
  /** Its current request only answers (changes no files). */
  answerOnly?: boolean;
  /** How Claude Code said its session is paid ("none": a plan sign-in). */
  apiKeySource?: string | null;
  /** Its request ran into the service's usage limit. */
  limitHit?: boolean;
  /** Carrying on with another service while the one in use is out. */
  handoff?: {
    fromId: string;
    from: string;
    to: string;
    /** When the first one is back, if known. */
    backAt: number | null;
    /** "auto": switched; "offer": waiting for a click. */
    mode: "auto" | "offer";
    toId: string;
    /** What to carry on with (an interrupted request). */
    resume?: string;
  } | null;
  /** The plan window's use when the request went out, to measure its share. */
  windowBefore?: {
    service: "claude" | "codex";
    used: number;
    resetsAt: number;
  } | null;
  /** What the last reply changed, to take back in one go. */
  lastTurn?: { changeIds: string[]; files: string[] } | null;
  /** Keys the last reply cites that the bibliography doesn't have. */
  citationWarning?: string[] | null;
}

/** Fields that are projected from the active tab to top-level state */
const TAB_FIELDS = [
  "sessionId",
  "messages",
  "isStreaming",
  "streamingStartedAt",
  "error",
  "totalInputTokens",
  "totalOutputTokens",
] as const;

function makeDefaultTab(
  id: string,
  projectPath: string | null = null,
): TabState {
  const selectedCredentialId =
    loadSelectedProviderCredentialId() ?? CLAUDE_CODE_PROVIDER_ID;
  return {
    id,
    title: "New Chat",
    projectPath,
    sessionId: null,
    providerKey: providerKeyForSelectedCredential(selectedCredentialId),
    sessionProviderKey: null,
    messages: [],
    isStreaming: false,
    streamingStartedAt: null,
    error: null,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    draft: { input: "", pinnedContexts: [] },
    queuedGuidance: [],
    forceQueuedGuidanceOnComplete: false,
    forcedQueuedGuidanceId: null,
    pendingTemporaryFilePaths: [],
  };
}

function providerSessionKey(providerCredentialId: string | null): string {
  return providerCredentialId
    ? `openai-compatible:${providerCredentialId}`
    : CLAUDE_CODE_PROVIDER_ID;
}

export function providerKeyForSelectedCredential(
  credentialId: string | null,
): string {
  return credentialId && credentialId !== CLAUDE_CODE_PROVIDER_ID
    ? providerSessionKey(credentialId)
    : CLAUDE_CODE_PROVIDER_ID;
}

function providerCredentialIdFromSessionKey(
  providerKey: string | null,
): string | null | undefined {
  if (!providerKey) return undefined;
  if (providerKey === CLAUDE_CODE_PROVIDER_ID) return CLAUDE_CODE_PROVIDER_ID;
  const prefix = "openai-compatible:";
  return providerKey.startsWith(prefix)
    ? providerKey.slice(prefix.length)
    : undefined;
}

function selectedCredentialForProviderKey(providerKey: string | null) {
  const credentialId = providerCredentialIdFromSessionKey(providerKey);
  return credentialId === undefined ? null : credentialId;
}

function inferProviderKeyFromHistory(history: any[]): string | null {
  const init = history.find(
    (entry) => entry?.type === "system" && entry?.subtype === "init",
  );
  if (!init) return null;

  if (
    init.provider === "openai-compatible" &&
    typeof init.provider_credential_id === "string" &&
    init.provider_credential_id.trim()
  ) {
    return providerSessionKey(init.provider_credential_id.trim());
  }

  const model = typeof init.model === "string" ? init.model : "";
  if (model.toLowerCase().startsWith("claude")) {
    return CLAUDE_CODE_PROVIDER_ID;
  }

  const matchingCredential = useClaudeSetupStore
    .getState()
    .openAiCredentials.find((credential) => credential.model === model);
  return matchingCredential ? providerSessionKey(matchingCredential.id) : null;
}

function usageFromMessage(msg: ClaudeStreamMessage): {
  input_tokens: number;
  output_tokens: number;
} {
  const usage = msg.usage || msg.message?.usage;
  return {
    input_tokens: usage?.input_tokens || 0,
    output_tokens: usage?.output_tokens || 0,
  };
}

function usageTotalsForMessages(messages: ClaudeStreamMessage[]): {
  inputTokens: number;
  outputTokens: number;
} {
  return messages.reduce(
    (totals, msg) => {
      const usage = usageFromMessage(msg);
      totals.inputTokens += usage.input_tokens;
      totals.outputTokens += usage.output_tokens;
      return totals;
    },
    { inputTokens: 0, outputTokens: 0 },
  );
}

function stringifyBlockContent(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function messageContentText(message: ClaudeStreamMessage): string {
  const rawContent = (message.message as any)?.content;
  if (typeof rawContent === "string") return rawContent.trim();

  const blocks = rawContent ?? [];
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === "text" && block.text?.trim()) {
      parts.push(block.text.trim());
    } else if (block.type === "tool_use") {
      const input = block.input ? stringifyBlockContent(block.input) : "";
      parts.push(
        `[tool_use: ${block.name ?? "unknown"}${input ? ` ${input}` : ""}]`,
      );
    } else if (block.type === "tool_result") {
      const content = stringifyBlockContent(block.content ?? "");
      parts.push(`[tool_result${block.is_error ? " error" : ""}: ${content}]`);
    }
  }
  return parts.join("\n").trim();
}

function displayTextForStoredUserPrompt(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!/^\[(?:Currently open file|File): [^\]\n]*\]/.test(normalized)) {
    return text;
  }

  const contextEnd = normalized.lastIndexOf("]\n\n");
  if (contextEnd < 0) return text;

  const contextText = normalized.slice(0, contextEnd + 1);
  const body = normalized.slice(contextEnd + 3);
  const selectionMatch = contextText.match(/(?:^|\n)\[Selection: ([^\]\n]+)\]/);
  const contextLabel = selectionMatch?.[1]?.trim();

  if (!contextLabel) return body;
  return body.trim() ? `${contextLabel}\n${body}` : contextLabel;
}

function sanitizeStoredUserMessageForDisplay(
  message: ClaudeStreamMessage,
): ClaudeStreamMessage {
  if (message.type !== "user") return message;

  const rawContent = (message.message as any)?.content;
  if (typeof rawContent === "string") {
    const displayText = displayTextForStoredUserPrompt(rawContent);
    return displayText === rawContent
      ? message
      : {
          ...message,
          message: { ...message.message, content: displayText as any },
        };
  }

  if (!Array.isArray(rawContent)) return message;

  let changed = false;
  const content = rawContent.map((block) => {
    if (block.type !== "text" || typeof block.text !== "string") {
      return block;
    }

    const displayText = displayTextForStoredUserPrompt(block.text);
    if (displayText === block.text) return block;

    changed = true;
    return { ...block, text: displayText };
  });

  return changed
    ? { ...message, message: { ...message.message, content } }
    : message;
}

function buildProviderSwitchContext(
  messages: ClaudeStreamMessage[],
  maxChars = 10000,
): string | null {
  const entries = messages
    .filter((msg) => msg.type === "user" || msg.type === "assistant")
    .map((msg) => {
      // The words only: tool calls and their output are noise here.
      const text = (msg.message?.content ?? [])
        .filter((b) => b.type === "text" && b.text)
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (!text) return null;
      return `${msg.type === "user" ? "User" : "Assistant"}:\n${text}`;
    })
    .filter((entry): entry is string => !!entry);

  if (entries.length === 0) return null;

  const selected: string[] = [];
  let total = 0;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const next = entries[i];
    if (selected.length > 0 && total + next.length > maxChars) break;
    selected.unshift(next);
    total += next.length;
  }

  return [
    "[Handoff: this chat continues with you, after another assistant]",
    ...handoffBrief(messages),
    "The conversation so far (latest part) follows. Do not repeat it; answer only the user's latest request after this block.",
    "",
    selected.join("\n\n"),
    "[End of handoff]",
  ].join("\n");
}

/** What a new assistant needs first: the files changed and what's left. */
export function handoffBrief(messages: ClaudeStreamMessage[]): string[] {
  const files = new Set<string>();
  let todos: { content?: string; status?: string }[] = [];
  for (const m of messages) {
    for (const b of m.message?.content ?? []) {
      if (b.type !== "tool_use") continue;
      if (/^(Write|Edit|MultiEdit)$/i.test(b.name ?? "")) {
        const path = b.input?.file_path;
        if (typeof path === "string")
          files.add(path.split(/[\\/]/).pop() ?? path);
      }
      if (b.name === "TodoWrite" && Array.isArray(b.input?.todos)) {
        todos = b.input.todos;
      }
    }
  }
  const open = todos.filter((t) => t.status !== "completed" && t.content);
  return [
    files.size ? `Files changed in this chat: ${[...files].join(", ")}.` : null,
    open.length
      ? `Still to do: ${open.map((t) => t.content).join("; ")}.`
      : null,
  ].filter((l): l is string => Boolean(l));
}

let tabCounter = 0;
function nextTabId(): string {
  return `tab-${++tabCounter}`;
}

function nextGuidanceId(): string {
  return `guidance-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function truncateChatTitle(text: string, maxChars = 80): string {
  return text.length > maxChars
    ? `${text.slice(0, Math.max(0, maxChars - 3))}...`
    : text;
}

function normalizeChatTitleWhitespace(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function isNoiseChatTitleLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase();
  return (
    lower.startsWith("template:") ||
    lower.startsWith("file:") ||
    lower.startsWith("reference files") ||
    lower === "what i want to create" ||
    lower.startsWith("(extracted text") ||
    lower.startsWith("attachments/") ||
    lower.startsWith("the file currently contains") ||
    (lower.startsWith("new ") && lower.includes(" project"))
  );
}

function extractMarkedRequestBody(text: string): string | null {
  const lines = text.split(/\r?\n/);
  const markerIndex = lines.findIndex(
    (line) => line.trim().toLowerCase() === "what i want to create",
  );
  if (markerIndex < 0) return null;

  const selected: string[] = [];
  for (const line of lines.slice(markerIndex + 1)) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase() === "reference files") break;
    if (isNoiseChatTitleLine(trimmed)) continue;
    selected.push(trimmed);
    if (selected.join(" ").length >= 120) break;
  }

  const body = normalizeChatTitleWhitespace(selected.join(" "));
  return body || null;
}

function firstMeaningfulTitleLine(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    if (!isNoiseChatTitleLine(line)) {
      const normalized = normalizeChatTitleWhitespace(line);
      if (normalized) return normalized;
    }
  }
  return null;
}

function summarizeChatTitle(prompt: string): string | undefined {
  const clean = prompt.includes("]\n\n")
    ? prompt.slice(prompt.lastIndexOf("]\n\n") + 3)
    : prompt;
  if (
    clean.startsWith("<ide_") ||
    clean.startsWith("<system-reminder>") ||
    clean.startsWith("<command-name>") ||
    clean.startsWith("<local-command-stdout>")
  ) {
    return undefined;
  }

  const source =
    extractMarkedRequestBody(clean) ?? firstMeaningfulTitleLine(clean);
  if (!source) return undefined;

  const normalized = normalizeChatTitleWhitespace(source);
  const lower = normalized.toLowerCase();
  const researchPrefix = [
    "a research paper for ",
    "research paper for ",
    "a research paper on ",
    "research paper on ",
    "a research paper about ",
    "research paper about ",
  ].find((prefix) => lower.startsWith(prefix));

  if (researchPrefix) {
    const topic = normalized.slice(researchPrefix.length).trim();
    return topic
      ? `Research Paper: ${truncateChatTitle(topic, 56)}`
      : "Research Paper";
  }

  return truncateChatTitle(normalized);
}

function titleForMessages(messages: ClaudeStreamMessage[]): string | undefined {
  const firstUser = messages.find((message) => message.type === "user");
  if (!firstUser) return undefined;
  return summarizeChatTitle(messageContentText(firstUser));
}

/**
 * Update a specific tab in `tabs[]` and, if that tab is the active tab,
 * also project the changed fields to top-level state for consumer compatibility.
 */
function applyTabUpdate(
  state: ClaudeChatState,
  tabId: string,
  updates: Partial<TabState>,
): Partial<ClaudeChatState> {
  const newTabs = state.tabs.map((t) =>
    t.id === tabId ? { ...t, ...updates } : t,
  );
  const result: Partial<ClaudeChatState> = { tabs: newTabs };
  if (tabId === state.activeTabId) {
    for (const key of TAB_FIELDS) {
      if (key in updates) {
        (result as any)[key] = (updates as any)[key];
      }
    }
  }
  return result;
}

// ─── State Interface ───

function mergeStreamingContent(
  existing: ContentBlock[],
  incoming: ContentBlock[],
): ContentBlock[] {
  let merged = [...existing];
  for (const block of incoming) {
    if (block.type === "text" && block.text) {
      const idx = merged.findIndex((item) => item.type === "text");
      if (idx >= 0) {
        merged = merged.map((item, itemIdx) =>
          itemIdx === idx
            ? { ...item, text: `${item.text ?? ""}${block.text}` }
            : item,
        );
      } else {
        merged.push(block);
      }
    } else if (block.type === "thinking" && block.thinking) {
      const idx = merged.findIndex((item) => item.type === "thinking");
      if (idx >= 0) {
        merged = merged.map((item, itemIdx) =>
          itemIdx === idx
            ? { ...item, thinking: `${item.thinking ?? ""}${block.thinking}` }
            : item,
        );
      } else {
        merged.unshift(block);
      }
    } else {
      merged.push(block);
    }
  }
  return merged;
}

const DEFAULT_TAB_ID = nextTabId();

interface ClaudeChatState {
  // ── Projected fields (from active tab — read by consumers) ──
  messages: ClaudeStreamMessage[];
  sessionId: string | null;
  isStreaming: boolean;
  streamingStartedAt: number | null;
  error: string | null;
  totalInputTokens: number;
  totalOutputTokens: number;

  // ── Tab state ──
  tabs: TabState[];
  activeTabId: string;
  activeProjectPath: string | null;

  /** Deferred prompt to send once the workspace is ready (set by project wizard) */
  pendingInitialPrompt: string | null;
  setPendingInitialPrompt: (prompt: string | null) => void;
  consumePendingInitialPrompt: () => string | null;

  /** Pending attachments from external sources (e.g. PDF capture) */
  pendingAttachments: {
    label: string;
    filePath: string;
    selectedText: string;
    imageDataUrl?: string;
  }[];
  addPendingAttachment: (attachment: {
    label: string;
    filePath: string;
    selectedText: string;
    imageDataUrl?: string;
  }) => void;
  consumePendingAttachments: () => {
    label: string;
    filePath: string;
    selectedText: string;
    imageDataUrl?: string;
  }[];
  pendingPinnedContextRemovalLabels: string[];
  requestPinnedContextRemoval: (labels: string[]) => void;
  consumePendingPinnedContextRemovals: () => string[];

  /** Currently selected model (passed per-prompt to Claude CLI) */
  /** "auto": Haiku for quick actions and small edits, Sonnet otherwise. */
  selectedModel: ClaudeModelChoice;
  setSelectedModel: (model: ClaudeModelChoice) => void;
  selectedProviderCredentialId: string | null;
  /** `transient`: a switch made for you (a limit reached), not a choice
   *  to remember for the project or the next launch. */
  setSelectedProviderCredentialId: (
    credentialId: string | null,
    transient?: boolean,
  ) => void;
  selectedProviderModels: Record<string, string>;
  setSelectedProviderModel: (credentialId: string, model: string) => void;

  /** Effort level for Opus 4.6 adaptive reasoning */
  effortLevel: "low" | "medium" | "high";
  setEffortLevel: (level: "low" | "medium" | "high") => void;

  // Actions
  sendPrompt: (
    userPrompt: string,
    contextOverride?: PromptContextOverride,
    options?: {
      tabId?: string;
      preserveTabProvider?: boolean;
      evenIfBusy?: boolean;
      quick?: boolean;
      answerOnly?: boolean;
    },
  ) => Promise<void>;
  queueGuidance: (
    tabId: string,
    prompt: string,
    contextOverride?: PromptContextOverride,
  ) => void;
  consumeQueuedGuidance: (
    tabId: string,
    guidanceId?: string | null,
  ) => QueuedGuidance | null;
  displayQueuedGuidanceInChat: (
    tabId: string,
    guidanceId?: string | null,
  ) => string | null;
  removeQueuedGuidance: (tabId: string, guidanceId: string) => void;
  clearQueuedGuidance: (tabId: string) => void;
  consumeTemporaryFilePaths: (tabId: string) => string[];
  forceQueuedGuidanceNow: (tabId: string, guidanceId?: string) => Promise<void>;
  cancelExecution: (tabId?: string) => Promise<void>;
  clearMessages: () => void;
  newSession: () => void;
  resetForProject: (projectPath: string | null) => void;
  resumeSession: (sessionId: string, title?: string) => Promise<void>;

  // Tab actions
  createTab: () => string;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  saveDraft: (tabId: string, draft: TabDraft) => void;

  /** True when any tab is streaming */
  anyStreaming: () => boolean;

  // Internal actions (called by event hook, routed by tabId)
  _appendMessage: (tabId: string, msg: ClaudeStreamMessage) => void;
  _setSessionId: (tabId: string, id: string) => void;
  _setSessionTitle: (sessionId: string, title: string) => void;
  /** The user's name for a chat, kept with its history. */
  renameTab: (tabId: string, title: string) => void;
  _setStreaming: (tabId: string, streaming: boolean) => void;
  /** A waiting request: sent now anyway, or given back to the composer. */
  sendWaitingNow: (tabId: string) => void;
  /** Updates one chat's state (from the event stream). */
  _patchTab: (tabId: string, patch: Partial<TabState>) => void;
  /** Adds what a chat's last reply measured to its result message. */
  _annotateLastResult: (
    tabId: string,
    patch: Partial<ClaudeStreamMessage>,
  ) => void;
  cancelWaiting: (tabId: string) => void;
  /** Text for a chat's message box to take back (a cancelled request). */
  restoreInput: { tabId: string; text: string } | null;
  _setError: (tabId: string, error: string | null) => void;
  _cancelledByUser: boolean;
}

// ─── Store ───

/** Requests waiting for another chat to finish with the same project. */
const waitingRequests = new Map<
  string,
  {
    userPrompt: string;
    contextOverride?: PromptContextOverride;
    options?: { tabId?: string; preserveTabProvider?: boolean };
  }
>();

export type ClaudeModelChoice =
  | "auto"
  | "sonnet"
  | "opus"
  | "haiku"
  | "opusplan";

/**
 * The model for a request when "auto" is chosen: Haiku for a quick action
 * or a short request about a selection, Sonnet for anything bigger. Opus is
 * never picked for you.
 */
export function resolveClaudeModel(
  choice: ClaudeModelChoice,
  prompt: string,
  context?: PromptContextOverride,
  quick?: boolean,
): Exclude<ClaudeModelChoice, "auto"> {
  if (choice !== "auto") return choice;
  if (quick) return "haiku";
  const small =
    prompt.length < 300 &&
    (context?.selectedText.length ?? Number.POSITIVE_INFINITY) < 3000 &&
    !/\b(whole|entire|all|every|chapter|restructure|rewrite|draft|write)\b/i.test(
      prompt,
    );
  return small ? "haiku" : "sonnet";
}

/** What ChatGPT and Gemini are told first, as Claude is by its own prompt. */
const ENGINE_INSTRUCTIONS = [
  "You are an assistant inside Latex4All, a LaTeX editor; you are working in the user's project folder.",
  "Make small, targeted edits to the existing files; never rewrite a whole file. Keep the preamble, packages and structure.",
  "For small changes just make them; plan only for bigger tasks. Read only the part of a file you will change.",
  "Use proper LaTeX: \\section and friends, \\cite with the project's .bib keys, \\label and \\ref.",
  "If agent skills are installed (folders with a SKILL.md), follow the ones that fit the task.",
].join("\n");

/** How full the plan window that a request to this service counts against
 *  is now: Claude's 5 hours, or ChatGPT's main window. */
export function planWindowNow(
  providerCredentialId: string | null,
): TabState["windowBefore"] {
  const engine = engineOfProvider(providerCredentialId);
  const usage = useAiUsage.getState();
  if (engine === "codex") {
    const w = usage.codexLimits?.primary;
    return w
      ? { service: "codex", used: w.usedPercent, resetsAt: w.resetsAt }
      : null;
  }
  if (
    engine ||
    (providerCredentialId && providerCredentialId !== CLAUDE_CODE_PROVIDER_ID)
  ) {
    return null;
  }
  const w = usage.claudeLimits?.fiveHour;
  return w
    ? { service: "claude", used: w.utilization * 100, resetsAt: w.resetsAt }
    : null;
}

/**
 * How a chat's requests are paid. Claude Code tells (apiKeySource "none" is
 * a Pro/Max sign-in; past the plan, Claude says it's on extra usage); a
 * ChatGPT account and a Google account are plans; anything with a key, API.
 */
export function billingOf(tab: TabState | undefined): Billing {
  const id = providerCredentialIdFromSessionKey(
    tab?.sessionProviderKey ?? tab?.providerKey ?? null,
  );
  const engine = engineOfProvider(id);
  if (engine === "gemini" || engine === "copilot") return "plan";
  if (engine === "codex") {
    const account = useAgentAccounts.getState().status.codex?.account ?? "";
    return /chatgpt/i.test(account) || !account ? "plan" : "api";
  }
  if (id && id !== CLAUDE_CODE_PROVIDER_ID) return "api";
  const source = tab?.apiKeySource;
  const onPlan =
    source != null
      ? source === "none"
      : Boolean(useClaudeSetupStore.getState().accountEmail);
  if (!onPlan) return "api";
  return useAiUsage.getState().claudeLimits?.usingOverage ? "extra" : "plan";
}

/** The service a chat talks to, by the name it was given. */
export function providerLabel(providerKey: string | null): string {
  const id = providerCredentialIdFromSessionKey(providerKey);
  if (!id || id === CLAUDE_CODE_PROVIDER_ID) return "Claude";
  const engine = engineOfProvider(id);
  if (engine) return ENGINE_LABELS[engine];
  return (
    useClaudeSetupStore.getState().openAiCredentials.find((c) => c.id === id)
      ?.label ?? "Other"
  );
}

/** Each project's assistant: service, model and effort, as last used there. */
interface ProjectAi {
  provider?: string | null;
  model?: string;
  effort?: string;
}
const PROJECT_AI_KEY = "latex4all-project-ai";

function readProjectAi(): Record<string, ProjectAi> {
  try {
    return JSON.parse(localStorage.getItem(PROJECT_AI_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function rememberForProject(patch: ProjectAi) {
  const root = useDocumentStore.getState().projectRoot;
  if (!root) return;
  try {
    const all = readProjectAi();
    all[root] = { ...all[root], ...patch };
    localStorage.setItem(PROJECT_AI_KEY, JSON.stringify(all));
  } catch {}
}

/** What a project used last, to pick up where it left off. */
export function projectAiDefaults(root: string): ProjectAi | undefined {
  return readProjectAi()[root];
}

/** A chat setting kept between launches (an unknown value: the default). */
function remembered<T extends string>(
  name: string,
  allowed: T[],
  fallback: T,
): T {
  try {
    const value = localStorage.getItem(`latex4all-chat-${name}`);
    if (value && (allowed as string[]).includes(value)) return value as T;
  } catch {}
  return fallback;
}

function remember(name: string, value: string) {
  try {
    localStorage.setItem(`latex4all-chat-${name}`, value);
  } catch {}
}

export const useClaudeChatStore = create<ClaudeChatState>()((set, get) => ({
  // Projected fields (initialized from default tab)
  messages: [],
  sessionId: null,
  isStreaming: false,
  streamingStartedAt: null,
  error: null,
  _cancelledByUser: false,
  totalInputTokens: 0,
  totalOutputTokens: 0,

  // Tab state
  tabs: [makeDefaultTab(DEFAULT_TAB_ID)],
  activeTabId: DEFAULT_TAB_ID,
  activeProjectPath: null,

  // Remembered between launches; Sonnet unless you pick another, as it
  // does most writing as well as Opus for a fraction of the usage.
  selectedModel: remembered(
    "model",
    ["auto", "sonnet", "opus", "haiku", "opusplan"],
    "sonnet",
  ),
  setSelectedModel: (model) => {
    remember("model", model);
    rememberForProject({ model });
    set({ selectedModel: model });
  },
  selectedProviderCredentialId:
    loadSelectedProviderCredentialId() ?? CLAUDE_CODE_PROVIDER_ID,
  setSelectedProviderCredentialId: (credentialId, transient) => {
    if (!transient) {
      persistSelectedProviderCredentialId(credentialId);
      rememberForProject({ provider: credentialId });
    }
    const providerKey = providerKeyForSelectedCredential(
      credentialId ?? CLAUDE_CODE_PROVIDER_ID,
    );
    set((state) => ({
      selectedProviderCredentialId: credentialId,
      tabs: state.tabs.map((tab) =>
        tab.id === state.activeTabId ? { ...tab, providerKey } : tab,
      ),
    }));
  },
  selectedProviderModels: {},
  setSelectedProviderModel: (credentialId, model) =>
    set((state) => ({
      selectedProviderModels: {
        ...state.selectedProviderModels,
        [credentialId]: model,
      },
    })),

  effortLevel: remembered("effort", ["low", "medium", "high"], "medium"),
  setEffortLevel: (level) => {
    remember("effort", level);
    rememberForProject({ effort: level });
    set({ effortLevel: level });
  },

  pendingInitialPrompt: null,
  setPendingInitialPrompt: (prompt) => set({ pendingInitialPrompt: prompt }),
  consumePendingInitialPrompt: () => {
    const { pendingInitialPrompt } = get();
    if (pendingInitialPrompt) {
      set({ pendingInitialPrompt: null });
    }
    return pendingInitialPrompt;
  },

  pendingAttachments: [],
  addPendingAttachment: (attachment) => {
    set((state) => ({
      pendingAttachments: [...state.pendingAttachments, attachment],
    }));
  },
  consumePendingAttachments: () => {
    const { pendingAttachments } = get();
    if (pendingAttachments.length > 0) {
      set({ pendingAttachments: [] });
    }
    return pendingAttachments;
  },
  pendingPinnedContextRemovalLabels: [],
  requestPinnedContextRemoval: (labels) => {
    if (labels.length === 0) return;
    set((state) => ({
      pendingPinnedContextRemovalLabels: [
        ...state.pendingPinnedContextRemovalLabels,
        ...labels,
      ],
    }));
  },
  consumePendingPinnedContextRemovals: () => {
    const { pendingPinnedContextRemovalLabels } = get();
    if (pendingPinnedContextRemovalLabels.length > 0) {
      set({ pendingPinnedContextRemovalLabels: [] });
    }
    return pendingPinnedContextRemovalLabels;
  },

  anyStreaming: () => get().tabs.some((t) => t.isStreaming),

  sendPrompt: async (
    userPrompt: string,
    contextOverride?: PromptContextOverride,
    options?: {
      tabId?: string;
      preserveTabProvider?: boolean;
      /** Send even while another chat edits the project. */
      evenIfBusy?: boolean;
      /** A quick action on a selection: light work. */
      quick?: boolean;
      /** Only answers; changes no files. */
      answerOnly?: boolean;
    },
  ) => {
    let state = get();
    let activeTabId = options?.tabId ?? state.activeTabId;
    let activeTab = state.tabs.find((t) => t.id === activeTabId);
    if (!activeTab || activeTab.isStreaming) return;

    const docState = useDocumentStore.getState();
    const projectPath = docState.projectRoot;
    if (!projectPath) {
      set((s) => applyTabUpdate(s, activeTabId, { error: "No project open" }));
      return;
    }

    if (activeTab.projectPath && activeTab.projectPath !== projectPath) {
      get().resetForProject(projectPath);
      state = get();
      activeTabId = state.activeTabId;
      activeTab = state.tabs.find((t) => t.id === activeTabId);
      if (!activeTab || activeTab.isStreaming) return;
    }

    // Its service is known to be out: carry on with the next one rather than
    // send a request that would fail (see ai-continuity.ts).
    if (switchIfOut(activeTabId)) {
      state = get();
      activeTab = state.tabs.find((t) => t.id === activeTabId);
      if (!activeTab) return;
    }

    // Another chat is editing this project: wait for it, rather than have
    // two assistants change the same files at once.
    // Requests that only answer neither wait nor make others wait.
    const busy = state.tabs.find(
      (t) =>
        t.id !== activeTabId &&
        t.isStreaming &&
        !t.answerOnly &&
        t.projectPath === projectPath,
    );
    if (busy && !options?.evenIfBusy && !options?.answerOnly) {
      waitingRequests.set(activeTabId, {
        userPrompt,
        contextOverride,
        options,
      });
      set((s) =>
        applyTabUpdate(s, activeTabId, {
          waitingFor: busy.title || "another chat",
          waitingText: userPrompt,
        }),
      );
      return;
    }

    const { selectedModel, effortLevel, selectedProviderModels } = state;
    const sessionId = activeTab.sessionId;
    const tabSelectedProviderCredentialId =
      selectedCredentialForProviderKey(activeTab.providerKey) ??
      state.selectedProviderCredentialId;
    let providerCredentialId =
      tabSelectedProviderCredentialId &&
      tabSelectedProviderCredentialId !== CLAUDE_CODE_PROVIDER_ID
        ? tabSelectedProviderCredentialId
        : null;

    if (options?.preserveTabProvider && activeTab.providerKey) {
      const tabProviderCredentialId = providerCredentialIdFromSessionKey(
        activeTab.providerKey,
      );
      if (tabProviderCredentialId === CLAUDE_CODE_PROVIDER_ID) {
        providerCredentialId = null;
      } else if (tabProviderCredentialId !== undefined) {
        providerCredentialId = tabProviderCredentialId;
      }
    }

    const providerModelOverride = providerCredentialId
      ? selectedProviderModels[providerCredentialId] || null
      : null;
    const requestProviderKey = providerSessionKey(providerCredentialId);
    const previousProviderKey = activeTab?.sessionProviderKey ?? null;
    const providerChanged =
      !!sessionId &&
      !!previousProviderKey &&
      previousProviderKey !== requestProviderKey;
    // A session belongs to what ran it: Claude Code (Claude, and services
    // with a key), or an account's own tool (Codex, Gemini CLI). One can't
    // resume another's (Claude Code: "No conversation found"), so moving
    // between them starts afresh, with the conversation handed over.
    const crossRunner =
      providerChanged &&
      engineOfProviderKey(previousProviderKey) !==
        engineOfProvider(providerCredentialId);
    const switchingDirectProviderToClaudeCode =
      !engineOfProvider(providerCredentialId) &&
      (crossRunner ||
        (providerChanged &&
          requestProviderKey === CLAUDE_CODE_PROVIDER_ID &&
          previousProviderKey !== CLAUDE_CODE_PROVIDER_ID));
    const resumeSessionId =
      switchingDirectProviderToClaudeCode || crossRunner
        ? null
        : (sessionId ?? null);

    const sendStart = performance.now();
    const streamingStartedAt = Date.now();
    log.info("sendPrompt start", {
      sessionId: !!sessionId,
      providerChanged,
      hasContext: !!contextOverride,
      tab: activeTabId,
    });

    // Compute context label for display in chat history
    const activeFile = docState.files.find(
      (f) => f.id === docState.activeFileId,
    );
    let contextLabel: string | null = null;

    if (contextOverride) {
      contextLabel = contextOverride.label;
    } else if (activeFile) {
      const selRange = docState.selectionRange;
      if (selRange && activeFile.content) {
        const content = activeFile.content;
        const startLC = offsetToLineCol(content, selRange.start);
        const endLC = offsetToLineCol(content, selRange.end);
        contextLabel = `@${activeFile.relativePath}:${startLC.line}:${startLC.col}-${endLC.line}:${endLC.col}`;
      }
    }

    // Add user message to the list for display (with context label visible)
    const displayText = contextLabel
      ? `${contextLabel}\n${userPrompt}`
      : userPrompt;
    const userMessage: ClaudeStreamMessage = {
      type: "user",
      message: {
        content: [{ type: "text", text: displayText }],
      },
    };

    // Auto-set tab title from first prompt
    const isFirstMessage = activeTab && activeTab.messages.length === 0;
    const tabTitle = isFirstMessage
      ? summarizeChatTitle(userPrompt)
      : undefined;

    set((s) => {
      const currentTab = s.tabs.find((t) => t.id === activeTabId);
      const temporaryFilePaths = Array.from(
        new Set([
          ...(currentTab?.pendingTemporaryFilePaths ?? []),
          ...(contextOverride?.temporaryFilePaths ?? []),
        ]),
      );
      const tabUpdates: Partial<TabState> = {
        messages: [...(currentTab?.messages ?? []), userMessage],
        projectPath,
        sessionId: resumeSessionId,
        providerKey: requestProviderKey,
        sessionProviderKey: requestProviderKey,
        isStreaming: true,
        streamingStartedAt,
        error: null,
        pendingTemporaryFilePaths: temporaryFilePaths,
      };
      if (tabTitle) tabUpdates.title = tabTitle;
      return {
        ...applyTabUpdate(s, activeTabId, tabUpdates),
        activeProjectPath: projectPath,
        _cancelledByUser: false,
      };
    });

    // Flush unsaved edits to disk so Claude reads the latest content
    if (docState.files.some((f) => f.isDirty)) {
      log.debug("saving dirty files...");
      await docState.saveAllFiles();
      log.debug("saveAllFiles done");
    }

    // Snapshot before Claude edit
    if (projectPath) {
      try {
        log.debug("creating snapshot...");
        await useHistoryStore
          .getState()
          .createSnapshot(projectPath, "[claude] Before Claude edit");
        log.debug("snapshot done");
      } catch {
        /* snapshot failure should not block Claude */
      }
    }

    // Build prompt with full context for Claude
    let prompt = userPrompt;
    if (activeFile) {
      const selRange = docState.selectionRange;
      const selectedText =
        selRange && activeFile.content
          ? activeFile.content.slice(selRange.start, selRange.end)
          : null;
      let ctx = `[Currently open file: ${activeFile.relativePath}]`;
      if (contextOverride) {
        ctx += `\n[Selection: ${contextOverride.label}]`;
        ctx += `\n[Selected text:\n${contextOverride.selectedText}\n]`;
      } else if (selectedText && selRange) {
        const content = activeFile.content ?? "";
        const startLC = offsetToLineCol(content, selRange.start);
        const endLC = offsetToLineCol(content, selRange.end);
        ctx += `\n[Selection: @${activeFile.relativePath}:${startLC.line}:${startLC.col}-${endLC.line}:${endLC.col}]`;
        ctx += `\n[Selected text:\n${selectedText}\n]`;
      }
      prompt = `${ctx}\n\n${userPrompt}`;
    }
    // The project's shared memory when a chat starts, and what its other
    // assistants did since this chat's last turn (see ai-memory.ts).
    {
      const startingChat = !sessionId || providerChanged;
      const since = startingChat
        ? Date.now() - 24 * 3600e3
        : (activeTab.lastRequestAt ?? Date.now());
      try {
        const [memory, log] = await Promise.all([
          readMemory(projectPath),
          readLog(projectPath),
        ]);
        const shared = sharedContext({
          memory,
          log,
          tab: activeTabId,
          since,
          startingChat,
          // Codex and Copilot read AGENTS.md by themselves.
          readsMemoryItself: ["codex", "copilot"].includes(
            engineOfProvider(providerCredentialId) ?? "",
          ),
        });
        if (shared) prompt = `${shared}\n\n${prompt}`;
        // Another provider's model, through Claude Code's tools: it isn't
        // Claude, whatever Claude Code's own instructions say.
        if (
          startingChat &&
          providerCredentialId &&
          !engineOfProvider(providerCredentialId)
        ) {
          const credential = useClaudeSetupStore
            .getState()
            .openAiCredentials.find((c) => c.id === providerCredentialId);
          const name = providerModelOverride || credential?.model || "";
          prompt = `[You are ${name || "a model"} from ${credential?.label ?? "another provider"}, not Claude; Latex4All runs you with Claude Code's tools. If asked, say which model you are.]\n\n${prompt}`;
        }
      } catch {
        // No memory to share: the request goes as it is.
      }
      const sentAt = Date.now();
      // A new turn: the last one's undo and warnings no longer apply.
      set((s) =>
        applyTabUpdate(s, activeTabId, {
          lastRequestAt: sentAt,
          limitHit: false,
          windowBefore: planWindowNow(providerCredentialId),
          answerOnly: Boolean(options?.answerOnly),
          lastTurn: null,
          citationWarning: null,
        }),
      );
    }
    if (switchingDirectProviderToClaudeCode) {
      const priorContext = buildProviderSwitchContext(
        activeTab?.messages ?? [],
      );
      if (priorContext) {
        prompt = `${priorContext}\n\n${prompt}`;
      }
    }
    const requestModel = resolveClaudeModel(
      selectedModel,
      userPrompt,
      contextOverride,
      options?.quick,
    );
    log.info("invoking CLI", {
      promptLength: prompt.length,
      mode: resumeSessionId ? "resume" : "new",
    });

    // ChatGPT (Codex) or Gemini, signed in with the user's account.
    const engine = engineOfProvider(providerCredentialId);
    if (engine) {
      const sameEngine = !providerChanged && Boolean(sessionId);
      let enginePrompt = prompt;
      if (!sameEngine) {
        const prior = buildProviderSwitchContext(activeTab?.messages ?? []);
        enginePrompt = [ENGINE_INSTRUCTIONS, prior, prompt]
          .filter(Boolean)
          .join("\n\n");
      }
      try {
        await invoke("execute_agent", {
          engine,
          projectPath,
          prompt: enginePrompt,
          tabId: activeTabId,
          model: useAgentAccounts.getState().models[engine] || null,
          sessionId: sameEngine ? sessionId : null,
          effortLevel,
        });
      } catch (err: any) {
        set((s) =>
          applyTabUpdate(s, activeTabId, {
            isStreaming: false,
            streamingStartedAt: null,
            error: String(err),
          }),
        );
      }
      return;
    }

    try {
      if (resumeSessionId) {
        // Resume existing session
        await invoke("resume_claude_code", {
          projectPath,
          sessionId: resumeSessionId,
          prompt,
          tabId: activeTabId,
          model: requestModel,
          effortLevel,
          providerCredentialId,
          providerModelOverride,
        });
      } else {
        // New session
        await invoke("execute_claude_code", {
          projectPath,
          prompt,
          tabId: activeTabId,
          model: requestModel,
          effortLevel,
          providerCredentialId,
          providerModelOverride,
        });
      }
      log.info(
        `sendPrompt complete in ${(performance.now() - sendStart).toFixed(0)}ms`,
      );
    } catch (err: any) {
      log.error(
        `sendPrompt failed after ${(performance.now() - sendStart).toFixed(0)}ms`,
        { error: String(err) },
      );
      set((s) =>
        applyTabUpdate(s, activeTabId, {
          isStreaming: false,
          streamingStartedAt: null,
          error: err?.message || String(err),
        }),
      );
    }
  },

  queueGuidance: (tabId, prompt, contextOverride) => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    set((state) => {
      const tab = state.tabs.find((t) => t.id === tabId);
      if (!tab) return {};
      const queuedGuidance = [
        ...(tab.queuedGuidance ?? []),
        {
          id: nextGuidanceId(),
          prompt: trimmed,
          contextOverride,
          createdAt: Date.now(),
        },
      ];
      return applyTabUpdate(state, tabId, { queuedGuidance });
    });
  },

  consumeQueuedGuidance: (tabId, guidanceId) => {
    const state = get();
    const tab = state.tabs.find((t) => t.id === tabId);
    const queue = tab?.queuedGuidance ?? [];
    const displayedIndex = queue.findIndex(
      (guidance) => guidance.displayedInChat,
    );
    const targetIndex = guidanceId
      ? queue.findIndex((guidance) => guidance.id === guidanceId)
      : displayedIndex >= 0
        ? displayedIndex
        : 0;
    const next = targetIndex >= 0 ? queue[targetIndex] : null;
    if (!next) {
      if (tab?.forceQueuedGuidanceOnComplete) {
        set((s) =>
          applyTabUpdate(s, tabId, {
            forceQueuedGuidanceOnComplete: false,
            forcedQueuedGuidanceId: null,
          }),
        );
      }
      return null;
    }
    const rest = queue.filter((_, index) => index !== targetIndex);
    set((s) =>
      applyTabUpdate(s, tabId, {
        queuedGuidance: rest,
        forceQueuedGuidanceOnComplete: false,
        forcedQueuedGuidanceId: null,
      }),
    );
    return next;
  },

  displayQueuedGuidanceInChat: (tabId, guidanceId) => {
    let displayedId: string | null = null;
    set((state) => {
      const tab = state.tabs.find((t) => t.id === tabId);
      const queue = tab?.queuedGuidance ?? [];
      const targetId = guidanceId ?? queue[0]?.id;
      if (!tab || !targetId || queue.length === 0) return {};
      displayedId = targetId;
      return applyTabUpdate(state, tabId, {
        queuedGuidance: queue.map((guidance) => ({
          ...guidance,
          displayedInChat: guidance.displayedInChat || guidance.id === targetId,
        })),
      });
    });
    return displayedId;
  },

  removeQueuedGuidance: (tabId, guidanceId) => {
    set((state) => {
      const tab = state.tabs.find((t) => t.id === tabId);
      if (!tab) return {};
      const queuedGuidance = (tab.queuedGuidance ?? []).filter(
        (guidance) => guidance.id !== guidanceId,
      );
      const nextForcedGuidanceId =
        tab.forcedQueuedGuidanceId === guidanceId
          ? (queuedGuidance.find((guidance) => guidance.displayedInChat)?.id ??
            null)
          : tab.forcedQueuedGuidanceId;
      return applyTabUpdate(state, tabId, {
        queuedGuidance,
        ...(tab.forcedQueuedGuidanceId === guidanceId
          ? {
              forceQueuedGuidanceOnComplete: nextForcedGuidanceId !== null,
              forcedQueuedGuidanceId: nextForcedGuidanceId,
            }
          : {}),
      });
    });
  },

  clearQueuedGuidance: (tabId) => {
    set((state) =>
      applyTabUpdate(state, tabId, {
        queuedGuidance: [],
        forceQueuedGuidanceOnComplete: false,
        forcedQueuedGuidanceId: null,
      }),
    );
  },

  consumeTemporaryFilePaths: (tabId) => {
    const paths =
      get().tabs.find((tab) => tab.id === tabId)?.pendingTemporaryFilePaths ??
      [];
    if (paths.length > 0) {
      set((state) =>
        applyTabUpdate(state, tabId, { pendingTemporaryFilePaths: [] }),
      );
    }
    return paths;
  },

  forceQueuedGuidanceNow: async (tabId, guidanceId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab?.isStreaming || !(tab.queuedGuidance?.length ?? 0)) return;
    const targetId = get().displayQueuedGuidanceInChat(tabId, guidanceId);
    if (!targetId) return;

    set((state) => {
      const currentTab = state.tabs.find((t) => t.id === tabId);
      const existingForcedId = currentTab?.forcedQueuedGuidanceId ?? null;
      const existingForcedStillQueued = (currentTab?.queuedGuidance ?? []).some(
        (guidance) => guidance.id === existingForcedId,
      );
      return applyTabUpdate(state, tabId, {
        forceQueuedGuidanceOnComplete: true,
        forcedQueuedGuidanceId: existingForcedStillQueued
          ? existingForcedId
          : targetId,
      });
    });

    try {
      const interrupted = await invoke<boolean>("interrupt_claude_execution", {
        tabId,
      });
      if (interrupted) {
        set({ _cancelledByUser: true });
      }
    } catch (err: any) {
      set((state) => {
        const currentTab = state.tabs.find((t) => t.id === tabId);
        const existingForcedId = currentTab?.forcedQueuedGuidanceId ?? null;
        const nextForcedId =
          existingForcedId && existingForcedId !== targetId
            ? existingForcedId
            : null;
        return applyTabUpdate(state, tabId, {
          queuedGuidance: (currentTab?.queuedGuidance ?? []).map((guidance) =>
            guidance.id === targetId
              ? { ...guidance, displayedInChat: false }
              : guidance,
          ),
          forceQueuedGuidanceOnComplete: nextForcedId !== null,
          forcedQueuedGuidanceId: nextForcedId,
          error: err?.message || String(err),
        });
      });
    }
  },

  cancelExecution: async (tabId) => {
    const activeTabId = tabId ?? get().activeTabId;
    const tab = get().tabs.find((t) => t.id === activeTabId);
    if (!tab?.isStreaming) return;
    set({ _cancelledByUser: true });
    set((s) =>
      applyTabUpdate(s, activeTabId, {
        isStreaming: false,
        streamingStartedAt: null,
        queuedGuidance: [],
        forceQueuedGuidanceOnComplete: false,
        forcedQueuedGuidanceId: null,
      }),
    );
    try {
      await invoke("cancel_claude_execution", { tabId: activeTabId });
    } catch {
      // The UI has already moved to a stopped state; stale output is ignored.
    }
  },

  clearMessages: () => {
    const { activeTabId } = get();
    set((s) =>
      applyTabUpdate(s, activeTabId, {
        messages: [],
        error: null,
        streamingStartedAt: null,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        queuedGuidance: [],
        forceQueuedGuidanceOnComplete: false,
        forcedQueuedGuidanceId: null,
      }),
    );
  },

  resetForProject: (projectPath) => {
    const state = get();
    const tabsAlreadyScoped =
      state.activeProjectPath === projectPath &&
      state.tabs.every((tab) => tab.projectPath === projectPath);
    if (tabsAlreadyScoped) return;

    const id = nextTabId();
    const tab = makeDefaultTab(id, projectPath);
    const nextSelectedProviderCredentialId =
      selectedCredentialForProviderKey(tab.providerKey) ??
      CLAUDE_CODE_PROVIDER_ID;
    persistSelectedProviderCredentialId(nextSelectedProviderCredentialId);

    set({
      tabs: [tab],
      activeTabId: id,
      activeProjectPath: projectPath,
      messages: tab.messages,
      sessionId: tab.sessionId,
      isStreaming: tab.isStreaming,
      streamingStartedAt: tab.streamingStartedAt,
      error: tab.error,
      totalInputTokens: tab.totalInputTokens,
      totalOutputTokens: tab.totalOutputTokens,
      pendingAttachments: [],
      pendingPinnedContextRemovalLabels: [],
      selectedProviderCredentialId: nextSelectedProviderCredentialId,
      _cancelledByUser: false,
    });
  },

  newSession: () => {
    log.info("Starting new session");
    const { activeTabId, tabs } = get();
    const activeTab = tabs.find((t) => t.id === activeTabId);
    const projectPath =
      get().activeProjectPath ??
      useDocumentStore.getState().projectRoot ??
      null;
    if (activeTab?.isStreaming) {
      const id = nextTabId();
      const newTab = {
        ...makeDefaultTab(id, projectPath),
        providerKey:
          activeTab.providerKey ??
          providerKeyForSelectedCredential(get().selectedProviderCredentialId),
      };
      set({
        tabs: [...tabs, newTab],
        activeTabId: id,
        activeProjectPath: projectPath,
        messages: newTab.messages,
        sessionId: newTab.sessionId,
        isStreaming: newTab.isStreaming,
        streamingStartedAt: newTab.streamingStartedAt,
        error: newTab.error,
        totalInputTokens: newTab.totalInputTokens,
        totalOutputTokens: newTab.totalOutputTokens,
        selectedProviderCredentialId: selectedCredentialForProviderKey(
          newTab.providerKey,
        ),
      });
      return;
    }

    set((s) => ({
      ...applyTabUpdate(s, activeTabId, {
        messages: [],
        sessionId: null,
        projectPath,
        providerKey:
          activeTab?.providerKey ??
          providerKeyForSelectedCredential(s.selectedProviderCredentialId),
        sessionProviderKey: null,
        error: null,
        isStreaming: false,
        streamingStartedAt: null,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        title: "New Chat",
        queuedGuidance: [],
        forceQueuedGuidanceOnComplete: false,
        forcedQueuedGuidanceId: null,
      }),
      activeProjectPath: projectPath,
    }));
  },

  resumeSession: async (sessionId: string, title?: string) => {
    log.info(`Resuming session: ${sessionId.slice(0, 8)}`);
    const sessionTitle = title?.trim() || undefined;
    const projectPath = useDocumentStore.getState().projectRoot;
    const state = get();
    let { activeTabId } = state;
    let { tabs } = state;
    const existingTab = tabs.find(
      (tab) => tab.sessionId === sessionId && tab.projectPath === projectPath,
    );

    if (existingTab) {
      const nextTitle = sessionTitle ?? existingTab.title;
      activeTabId = existingTab.id;
      const nextTabs = tabs.map((tab) =>
        tab.id === existingTab.id ? { ...tab, title: nextTitle } : tab,
      );
      const nextSelectedProviderCredentialId =
        selectedCredentialForProviderKey(existingTab.providerKey) ??
        CLAUDE_CODE_PROVIDER_ID;
      persistSelectedProviderCredentialId(nextSelectedProviderCredentialId);
      set({
        tabs: nextTabs,
        activeTabId: existingTab.id,
        activeProjectPath: projectPath ?? existingTab.projectPath,
        messages: existingTab.messages,
        sessionId: existingTab.sessionId,
        isStreaming: existingTab.isStreaming,
        streamingStartedAt: existingTab.streamingStartedAt,
        error: existingTab.error,
        totalInputTokens: existingTab.totalInputTokens,
        totalOutputTokens: existingTab.totalOutputTokens,
        selectedProviderCredentialId: nextSelectedProviderCredentialId,
      });
      if (existingTab.isStreaming) return;
    } else {
      const activeTab = tabs.find((tab) => tab.id === activeTabId);
      if (activeTab?.isStreaming) {
        const id = nextTabId();
        const newTab = {
          ...makeDefaultTab(id, projectPath ?? state.activeProjectPath),
          providerKey:
            activeTab.providerKey ??
            providerKeyForSelectedCredential(
              get().selectedProviderCredentialId,
            ),
        };
        tabs = [...tabs, newTab];
        activeTabId = id;
        set({
          tabs,
          activeTabId,
          activeProjectPath: projectPath ?? newTab.projectPath,
          messages: newTab.messages,
          sessionId: newTab.sessionId,
          isStreaming: newTab.isStreaming,
          streamingStartedAt: newTab.streamingStartedAt,
          error: newTab.error,
          totalInputTokens: newTab.totalInputTokens,
          totalOutputTokens: newTab.totalOutputTokens,
          selectedProviderCredentialId: selectedCredentialForProviderKey(
            newTab.providerKey,
          ),
        });
      }
    }

    // Reset state with new session ID
    set((s) => ({
      ...applyTabUpdate(s, activeTabId, {
        messages: [],
        projectPath: projectPath ?? null,
        sessionId,
        providerKey: null,
        sessionProviderKey: null,
        error: null,
        isStreaming: false,
        streamingStartedAt: null,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        title: sessionTitle ?? "New Chat",
        queuedGuidance: [],
        forceQueuedGuidanceOnComplete: false,
        forcedQueuedGuidanceId: null,
      }),
      activeProjectPath: projectPath ?? null,
    }));

    // Load session history from JSONL file
    if (projectPath) {
      try {
        const history = await invoke<any[]>("load_session_history", {
          projectPath,
          sessionId,
        });

        // Filter to displayable message types and map to ClaudeStreamMessage
        const rawMessages: ClaudeStreamMessage[] = [];
        for (const entry of history) {
          const type = entry.type;
          if (type === "user" || type === "assistant" || type === "result") {
            rawMessages.push(entry as ClaudeStreamMessage);
          }
        }

        const messages = rawMessages.map(sanitizeStoredUserMessageForDisplay);
        const totals = usageTotalsForMessages(messages);
        const providerKey = inferProviderKeyFromHistory(history);
        const selectedProviderCredentialId =
          providerCredentialIdFromSessionKey(providerKey);
        const nextSelectedProviderCredentialId =
          selectedProviderCredentialId === undefined
            ? CLAUDE_CODE_PROVIDER_ID
            : selectedProviderCredentialId;
        persistSelectedProviderCredentialId(nextSelectedProviderCredentialId);
        set((s) => ({
          ...applyTabUpdate(s, activeTabId, {
            messages,
            providerKey:
              providerKey ??
              providerKeyForSelectedCredential(
                nextSelectedProviderCredentialId,
              ),
            sessionProviderKey:
              providerKey ??
              providerKeyForSelectedCredential(
                nextSelectedProviderCredentialId,
              ),
            title: sessionTitle ?? titleForMessages(rawMessages) ?? "New Chat",
            totalInputTokens: totals.inputTokens,
            totalOutputTokens: totals.outputTokens,
          }),
          selectedProviderCredentialId: nextSelectedProviderCredentialId,
        }));
      } catch (err) {
        log.error("Failed to load session history", { error: String(err) });
      }
    }
  },

  // ─── Tab Actions ───

  createTab: () => {
    log.debug("Creating new tab");
    const id = nextTabId();
    const state = get();
    const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
    const projectPath =
      state.activeProjectPath ??
      useDocumentStore.getState().projectRoot ??
      null;
    const newTab = {
      ...makeDefaultTab(id, projectPath),
      providerKey:
        activeTab?.providerKey ??
        providerKeyForSelectedCredential(state.selectedProviderCredentialId),
    };
    set((s) => ({
      tabs: [...s.tabs, newTab],
      activeTabId: id,
      activeProjectPath: projectPath,
      // Project new tab fields to top-level
      messages: newTab.messages,
      sessionId: newTab.sessionId,
      isStreaming: newTab.isStreaming,
      streamingStartedAt: newTab.streamingStartedAt,
      error: newTab.error,
      totalInputTokens: newTab.totalInputTokens,
      totalOutputTokens: newTab.totalOutputTokens,
      selectedProviderCredentialId: selectedCredentialForProviderKey(
        newTab.providerKey,
      ),
    }));
    return id;
  },

  closeTab: (tabId: string) => {
    // A request it had waiting goes with it.
    waitingRequests.delete(tabId);
    const state = get();
    const tab = state.tabs.find((t) => t.id === tabId);
    // Prevent closing a streaming tab
    if (tab?.isStreaming) return;
    // The last one: an empty chat takes its place (one is always there),
    // and the closed one stays in the history.
    if (state.tabs.length <= 1) {
      if (!tab || (tab.messages.length === 0 && !tab.sessionId)) return;
      get().createTab();
      get().closeTab(tabId);
      return;
    }

    const idx = state.tabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return;

    const newTabs = state.tabs.filter((t) => t.id !== tabId);

    if (tabId === state.activeTabId) {
      // Switch to adjacent tab
      const newIdx = Math.min(idx, newTabs.length - 1);
      const newActive = newTabs[newIdx];
      const nextSelectedProviderCredentialId =
        selectedCredentialForProviderKey(newActive.providerKey) ??
        CLAUDE_CODE_PROVIDER_ID;
      persistSelectedProviderCredentialId(nextSelectedProviderCredentialId);
      set({
        tabs: newTabs,
        activeTabId: newActive.id,
        activeProjectPath: newActive.projectPath,
        // Project new active tab
        messages: newActive.messages,
        sessionId: newActive.sessionId,
        isStreaming: newActive.isStreaming,
        streamingStartedAt: newActive.streamingStartedAt,
        error: newActive.error,
        totalInputTokens: newActive.totalInputTokens,
        totalOutputTokens: newActive.totalOutputTokens,
        selectedProviderCredentialId: nextSelectedProviderCredentialId,
      });
    } else {
      set({ tabs: newTabs });
    }
  },

  setActiveTab: (tabId: string) => {
    const state = get();
    if (tabId === state.activeTabId) return;
    const targetTab = state.tabs.find((t) => t.id === tabId);
    if (!targetTab) return;
    const nextSelectedProviderCredentialId =
      selectedCredentialForProviderKey(targetTab.providerKey) ??
      CLAUDE_CODE_PROVIDER_ID;
    persistSelectedProviderCredentialId(nextSelectedProviderCredentialId);

    // Project the target tab's fields to top-level
    set({
      activeTabId: tabId,
      activeProjectPath: targetTab.projectPath,
      messages: targetTab.messages,
      sessionId: targetTab.sessionId,
      isStreaming: targetTab.isStreaming,
      streamingStartedAt: targetTab.streamingStartedAt,
      error: targetTab.error,
      totalInputTokens: targetTab.totalInputTokens,
      totalOutputTokens: targetTab.totalOutputTokens,
      selectedProviderCredentialId: nextSelectedProviderCredentialId,
    });
  },

  saveDraft: (tabId: string, draft: TabDraft) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, draft } : t)),
    }));
  },

  // ─── Internal Actions (routed by explicit tabId) ───

  _appendMessage: (tabId: string, msg: ClaudeStreamMessage) => {
    if (msg.type === "result") {
      // What the request took, for Settings → AI usage, and how it's paid.
      const { tabs, selectedModel } = get();
      const tab = tabs.find((t) => t.id === tabId);
      const billing = billingOf(tab);
      msg = { ...msg, billing };
      // A provider's model through Claude Code: Claude Code names and prices
      // the reply as the Claude model it asked for ("sonnet"), though the
      // provider's model answered. Its real name; its price is the user's.
      const credentialId = providerCredentialIdFromSessionKey(
        tab?.sessionProviderKey ?? tab?.providerKey ?? null,
      );
      if (
        credentialId &&
        credentialId !== CLAUDE_CODE_PROVIDER_ID &&
        !engineOfProvider(credentialId)
      ) {
        const credential = useClaudeSetupStore
          .getState()
          .openAiCredentials.find((c) => c.id === credentialId);
        const real =
          get().selectedProviderModels[credentialId] ||
          credential?.model ||
          credential?.label ||
          "model";
        msg = {
          ...msg,
          model: real,
          modelUsage: { [real]: {} },
          total_cost_usd: undefined,
          cost_usd: undefined,
        } as ClaudeStreamMessage;
      }
      useAiUsage
        .getState()
        .record(
          usageEntry(
            msg as ResultUsage,
            tab?.projectPath ?? null,
            engineOfProviderKey(tab?.sessionProviderKey ?? tab?.providerKey)
              ? `${providerLabel(tab?.sessionProviderKey ?? tab?.providerKey ?? null)} default`
              : selectedModel,
            Date.now(),
            providerLabel(tab?.providerKey ?? null),
            billing,
          ),
          tabId,
        );
    }
    set((state) => {
      const { input_tokens: inputDelta, output_tokens: outputDelta } =
        usageFromMessage(msg);

      const tab = state.tabs.find((t) => t.id === tabId);
      if (!tab) return {};

      if (msg.type === "assistant" && msg.subtype === "streaming_delta") {
        const last = tab.messages[tab.messages.length - 1];
        if (last?.type === "assistant" && last.subtype === "streaming_delta") {
          const existing = last.message?.content ?? [];
          const incoming = msg.message?.content ?? [];
          if (incoming.length > 0) {
            const merged: ClaudeStreamMessage = {
              ...last,
              message: {
                ...last.message,
                content: mergeStreamingContent(existing, incoming),
              },
            };
            return applyTabUpdate(state, tabId, {
              messages: [...tab.messages.slice(0, -1), merged],
              totalInputTokens: tab.totalInputTokens + inputDelta,
              totalOutputTokens: tab.totalOutputTokens + outputDelta,
            });
          }
        }
      }

      if (msg.type === "assistant" && msg.subtype === "streaming_final") {
        const last = tab.messages[tab.messages.length - 1];
        if (last?.type === "assistant" && last.subtype === "streaming_delta") {
          return applyTabUpdate(state, tabId, {
            messages: [...tab.messages.slice(0, -1), msg],
            totalInputTokens: tab.totalInputTokens + inputDelta,
            totalOutputTokens: tab.totalOutputTokens + outputDelta,
          });
        }
      }

      return applyTabUpdate(state, tabId, {
        messages: [...tab.messages, msg],
        totalInputTokens: tab.totalInputTokens + inputDelta,
        totalOutputTokens: tab.totalOutputTokens + outputDelta,
      });
    });
  },

  _setSessionId: (tabId: string, id: string) => {
    set((state) => applyTabUpdate(state, tabId, { sessionId: id }));
  },

  renameTab: (tabId, title) => {
    const clean = title.trim().replace(/\s+/g, " ").slice(0, 72);
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || !clean || clean === tab.title) return;
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, title: clean, titleLocked: true } : t,
      ),
    }));
    if (tab.sessionId && tab.projectPath) {
      void invoke("rename_claude_session", {
        projectPath: tab.projectPath,
        sessionId: tab.sessionId,
        title: clean,
      }).catch(() => {});
    }
  },

  _setSessionTitle: (sessionId: string, title: string) => {
    const cleanTitle = title.trim();
    if (!cleanTitle) return;
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.sessionId === sessionId &&
        tab.projectPath === state.activeProjectPath &&
        !tab.titleLocked
          ? { ...tab, title: cleanTitle }
          : tab,
      ),
    }));
  },

  _setStreaming: (tabId: string, streaming: boolean) => {
    set((state) => {
      const tab = state.tabs.find((t) => t.id === tabId);
      return applyTabUpdate(state, tabId, {
        isStreaming: streaming,
        streamingStartedAt: streaming
          ? (tab?.streamingStartedAt ?? Date.now())
          : null,
      });
    });
    if (streaming) return;
    // The project is free: the next chat waiting for it goes.
    const { tabs } = get();
    const project = tabs.find((t) => t.id === tabId)?.projectPath;
    if (
      tabs.some(
        (t) => t.isStreaming && !t.answerOnly && t.projectPath === project,
      )
    ) {
      return;
    }
    const next = [...waitingRequests.keys()].find(
      (id) => tabs.find((t) => t.id === id)?.projectPath === project,
    );
    if (next) get().sendWaitingNow(next);
  },

  restoreInput: null,

  _patchTab: (tabId, patch) => {
    set((s) => applyTabUpdate(s, tabId, patch));
  },

  _annotateLastResult: (tabId, patch) => {
    set((s) => {
      const tab = s.tabs.find((t) => t.id === tabId);
      if (!tab) return {};
      const i = tab.messages.map((m) => m.type).lastIndexOf("result");
      if (i < 0) return {};
      const messages = [...tab.messages];
      messages[i] = { ...messages[i], ...patch };
      return applyTabUpdate(s, tabId, { messages });
    });
  },

  sendWaitingNow: (tabId) => {
    const request = waitingRequests.get(tabId);
    waitingRequests.delete(tabId);
    set((s) =>
      applyTabUpdate(s, tabId, { waitingFor: null, waitingText: null }),
    );
    if (!request) return;
    void get().sendPrompt(request.userPrompt, request.contextOverride, {
      ...request.options,
      tabId,
      evenIfBusy: true,
    });
  },

  cancelWaiting: (tabId) => {
    const request = waitingRequests.get(tabId);
    waitingRequests.delete(tabId);
    set((s) => ({
      ...applyTabUpdate(s, tabId, { waitingFor: null, waitingText: null }),
      restoreInput: request ? { tabId, text: request.userPrompt } : null,
    }));
  },

  _setError: (tabId: string, error: string | null) => {
    set((state) => applyTabUpdate(state, tabId, { error }));
  },
}));
