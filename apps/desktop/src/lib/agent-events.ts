/**
 * Codex (ChatGPT) and Gemini CLI report what they do in their own formats;
 * the chat speaks Claude Code's. These turn each of their events into the
 * messages the chat already shows: text, thinking, tool calls and their
 * results (which also feed file-change review), and a final result with
 * the tokens used.
 */
import type {
  ClaudeStreamMessage,
  ContentBlock,
} from "@/stores/claude-chat-store";

export type AgentEngine = "codex" | "gemini";

/** Provider ids for the account-login engines, beside Claude Code's. */
export const CODEX_PROVIDER_ID = "__codex__";
export const GEMINI_PROVIDER_ID = "__gemini__";

export const ENGINE_LABELS: Record<AgentEngine, string> = {
  codex: "ChatGPT",
  gemini: "Gemini",
};

export function engineOfProvider(
  id: string | null | undefined,
): AgentEngine | null {
  if (id === CODEX_PROVIDER_ID) return "codex";
  if (id === GEMINI_PROVIDER_ID) return "gemini";
  return null;
}

/** The engine behind a chat's provider key ("openai-compatible:__codex__"). */
export function engineOfProviderKey(
  key: string | null | undefined,
): AgentEngine | null {
  return engineOfProvider(key?.replace(/^openai-compatible:/, ""));
}

export const providerOfEngine = (engine: AgentEngine) =>
  engine === "codex" ? CODEX_PROVIDER_ID : GEMINI_PROVIDER_ID;

/** What a translation remembers between events of one request. */
export interface TranslateState {
  model: string;
  /** The reply's last stretch of text, for the result. */
  lastText: string;
  /** Text since the last tool call (Gemini streams it in pieces). */
  segment: string;
  /** Tool call id → the chat's name for it. */
  tools: Map<string, string>;
}

export const newTranslateState = (model = ""): TranslateState => ({
  model,
  lastText: "",
  segment: "",
  tools: new Map(),
});

const assistant = (content: ContentBlock[]): ClaudeStreamMessage => ({
  type: "assistant",
  message: { content },
});

const toolUse = (
  st: TranslateState,
  id: string,
  name: string,
  input: Record<string, unknown>,
): ClaudeStreamMessage => {
  st.tools.set(id, name);
  return assistant([{ type: "tool_use", id, name, input }]);
};

const toolResult = (
  id: string,
  content: string,
  isError: boolean,
): ClaudeStreamMessage => ({
  type: "user",
  message: {
    content: [
      { type: "tool_result", tool_use_id: id, content, is_error: isError },
    ],
  },
});

const result = (
  st: TranslateState,
  usage: { input: number; cached: number; output: number } | null,
  error: string | null,
): ClaudeStreamMessage =>
  ({
    type: "result",
    subtype: error ? "error" : "success",
    is_error: Boolean(error),
    result: error ?? st.lastText,
    num_turns: 1,
    ...(usage
      ? {
          usage: {
            input_tokens: Math.max(0, usage.input - usage.cached),
            cache_read_input_tokens: usage.cached,
            output_tokens: usage.output,
          },
        }
      : {}),
    ...(st.model ? { modelUsage: { [st.model]: {} } } : {}),
  }) as ClaudeStreamMessage;

// ─── Codex (`codex exec --json`) ───

interface CodexItem {
  id: string;
  type: string;
  text?: string;
  command?: string;
  aggregated_output?: string;
  exit_code?: number;
  status?: string;
  changes?: { path: string; kind: "add" | "delete" | "update" }[];
  server?: string;
  tool?: string;
  arguments?: unknown;
  error?: { message: string };
  query?: string;
  message?: string;
  items?: { text: string; completed: boolean }[];
}

interface CodexEvent {
  type: string;
  thread_id?: string;
  item?: CodexItem;
  usage?: {
    input_tokens?: number;
    cached_input_tokens?: number;
    output_tokens?: number;
  };
  error?: { message: string };
  message?: string;
}

export function translateCodex(
  ev: CodexEvent,
  st: TranslateState,
): ClaudeStreamMessage[] {
  const item = ev.item;
  switch (ev.type) {
    case "thread.started":
      return [
        {
          type: "system",
          subtype: "init",
          session_id: ev.thread_id,
          model: st.model || undefined,
        },
      ];
    case "item.started":
      if (item?.type === "command_execution") {
        return [toolUse(st, item.id, "Bash", { command: item.command ?? "" })];
      }
      if (item?.type === "mcp_tool_call") {
        return [
          toolUse(st, item.id, `${item.server}.${item.tool}`, {
            ...((item.arguments as object) ?? {}),
          }),
        ];
      }
      if (item?.type === "web_search") {
        return [toolUse(st, item.id, "WebSearch", { query: item.query })];
      }
      return [];
    case "item.completed": {
      if (!item) return [];
      switch (item.type) {
        case "agent_message":
          st.lastText = item.text ?? "";
          return [assistant([{ type: "text", text: item.text ?? "" }])];
        case "reasoning":
          return item.text
            ? [assistant([{ type: "thinking", thinking: item.text }])]
            : [];
        case "command_execution":
          return [
            ...(st.tools.has(item.id)
              ? []
              : [
                  toolUse(st, item.id, "Bash", { command: item.command ?? "" }),
                ]),
            toolResult(
              item.id,
              item.aggregated_output ?? "",
              item.status === "failed" ||
                (item.exit_code !== undefined && item.exit_code !== 0),
            ),
          ];
        case "file_change":
          return (item.changes ?? []).flatMap((change, i) => {
            const id = `${item.id}:${i}`;
            return [
              toolUse(st, id, change.kind === "add" ? "Write" : "Edit", {
                file_path: change.path,
              }),
              toolResult(id, change.kind, item.status === "failed"),
            ];
          });
        case "mcp_tool_call":
          return [
            toolResult(
              item.id,
              item.error?.message ?? "",
              item.status === "failed",
            ),
          ];
        case "web_search":
          return [toolResult(item.id, "", false)];
        case "todo_list":
          return [
            toolUse(st, item.id, "TodoWrite", {
              todos: (item.items ?? []).map((t) => ({
                content: t.text,
                activeForm: t.text,
                status: t.completed ? "completed" : "pending",
              })),
            }),
          ];
        case "error":
          return [assistant([{ type: "text", text: `⚠ ${item.message}` }])];
        default:
          return [];
      }
    }
    case "turn.completed":
      return [
        result(
          st,
          {
            input: ev.usage?.input_tokens ?? 0,
            cached: ev.usage?.cached_input_tokens ?? 0,
            output: ev.usage?.output_tokens ?? 0,
          },
          null,
        ),
      ];
    case "turn.failed":
      return [result(st, null, ev.error?.message ?? "ChatGPT stopped.")];
    case "error":
      return [result(st, null, ev.message ?? "ChatGPT stopped.")];
    default:
      return [];
  }
}

// ─── Gemini (`gemini -o stream-json`) ───

interface GeminiEvent {
  type: string;
  session_id?: string;
  model?: string;
  role?: string;
  content?: string;
  delta?: boolean;
  tool_name?: string;
  tool_id?: string;
  parameters?: Record<string, unknown>;
  status?: string;
  output?: string;
  error?: { message?: string };
  message?: string;
  severity?: string;
  stats?: {
    input_tokens?: number;
    output_tokens?: number;
    cached?: number;
    models?: Record<string, unknown>;
  };
}

/** Gemini's tools by the chat's names, so their widgets and review work. */
function geminiTool(
  name: string,
  p: Record<string, unknown>,
): { name: string; input: Record<string, unknown> } {
  const path = p.file_path ?? p.absolute_path ?? p.path;
  switch (name) {
    case "write_file":
      return { name: "Write", input: { file_path: path, content: p.content } };
    case "replace":
      return {
        name: "Edit",
        input: {
          file_path: path,
          old_string: p.old_string,
          new_string: p.new_string,
        },
      };
    case "read_file":
    case "read_many_files":
      return { name: "Read", input: { ...p, file_path: path } };
    case "run_shell_command":
      return { name: "Bash", input: p };
    case "glob":
      return { name: "Glob", input: p };
    case "search_file_content":
    case "grep_search":
      return { name: "Grep", input: p };
    case "list_directory":
      return { name: "LS", input: { ...p, path } };
    case "google_web_search":
      return { name: "WebSearch", input: p };
    case "web_fetch":
      return { name: "WebFetch", input: p };
    case "write_todos":
      return {
        name: "TodoWrite",
        input: {
          todos: (
            (p.todos as { description?: string; status?: string }[]) ?? []
          ).map((t) => ({
            content: t.description ?? "",
            activeForm: t.description ?? "",
            status:
              t.status === "completed"
                ? "completed"
                : t.status === "in_progress"
                  ? "in_progress"
                  : "pending",
          })),
        },
      };
    default:
      return { name, input: p };
  }
}

export function translateGemini(
  ev: GeminiEvent,
  st: TranslateState,
): ClaudeStreamMessage[] {
  switch (ev.type) {
    case "init":
      if (ev.model) st.model = ev.model;
      return [
        {
          type: "system",
          subtype: "init",
          session_id: ev.session_id,
          model: ev.model,
        },
      ];
    case "message": {
      if (ev.role !== "assistant" || !ev.content) return [];
      st.segment = ev.delta ? st.segment + ev.content : ev.content;
      st.lastText = st.segment;
      return [
        {
          type: "assistant",
          ...(ev.delta ? { subtype: "streaming_delta" } : {}),
          message: { content: [{ type: "text", text: ev.content }] },
        },
      ];
    }
    case "tool_use": {
      st.segment = "";
      const tool = geminiTool(ev.tool_name ?? "tool", ev.parameters ?? {});
      return [
        toolUse(
          st,
          ev.tool_id ?? ev.tool_name ?? "tool",
          tool.name,
          tool.input,
        ),
      ];
    }
    case "tool_result":
      return [
        toolResult(
          ev.tool_id ?? "tool",
          ev.output ?? ev.error?.message ?? "",
          ev.status === "error",
        ),
      ];
    case "error":
      return ev.message
        ? [assistant([{ type: "text", text: `⚠ ${ev.message}` }])]
        : [];
    case "result": {
      const s = ev.stats ?? {};
      const model = Object.keys(s.models ?? {})[0];
      if (model) st.model = model;
      return [
        result(
          st,
          {
            input: s.input_tokens ?? 0,
            cached: s.cached ?? 0,
            output: s.output_tokens ?? 0,
          },
          ev.status === "success"
            ? null
            : (ev.error?.message ?? "Gemini stopped."),
        ),
      ];
    }
    default:
      return [];
  }
}

/** Turns one line of an engine's output into chat messages. */
export function translateAgentLine(
  engine: AgentEngine,
  line: string,
  st: TranslateState,
): ClaudeStreamMessage[] {
  let ev: unknown;
  try {
    ev = JSON.parse(line);
  } catch {
    return [];
  }
  if (!ev || typeof ev !== "object") return [];
  return engine === "codex"
    ? translateCodex(ev as CodexEvent, st)
    : translateGemini(ev as GeminiEvent, st);
}

/** Whether a line on an engine's error output says something went wrong. */
export function isEngineErrorLine(line: string): boolean {
  const l = line.trim();
  if (!l || /^(YOLO mode|Ripgrep|Loaded cached|Warning|at )/.test(l)) {
    return false;
  }
  return /error|failed|not supported|unauthori[sz]ed|limit|denied|invalid/i.test(
    l,
  );
}

/** What to tell the user when ChatGPT or Gemini stops without answering. */
export function engineErrorMessage(
  engine: AgentEngine,
  lastError: string | null,
): string {
  const label = ENGINE_LABELS[engine];
  const raw = lastError?.trim() ?? "";
  if (/IneligibleTier|no longer supported for Gemini Code Assist/i.test(raw)) {
    return "Google no longer lets Gemini CLI sign in with a free personal account. Use a Gemini API key instead (free from Google AI Studio): Settings → Provider → Gemini.";
  }
  if (/not logged in|login|auth|unauthori[sz]ed|401/i.test(raw)) {
    return `${label} isn't signed in. Sign in again in Settings → Provider.`;
  }
  if (/usage limit|rate limit|quota|429/i.test(raw)) {
    return `${label}'s usage limit is reached. ${raw}`;
  }
  return raw
    ? `${label} stopped: ${raw.replace(/^.*?Error:\s*/, "")}`
    : `${label} stopped without answering.`;
}
