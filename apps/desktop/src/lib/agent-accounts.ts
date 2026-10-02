import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { type AgentEngine, ENGINE_LABELS, ENGINES } from "@/lib/agent-events";

export interface AgentStatus {
  installed: boolean;
  signed_in: boolean;
  account: string | null;
  can_install: boolean;
}

export interface AgentModel {
  id: string;
  name: string;
  description: string;
  /** Copilot: "light", "versatile" or "powerful". */
  category?: string;
  /** Copilot: "available", "enable" (off in GitHub's settings) or
   *  "upgrade" (not in the plan). */
  status?: string;
}

interface AgentAccountsState {
  /** The models each engine offers, once asked. */
  modelLists: Partial<Record<AgentEngine, AgentModel[]>>;
  loadModels: (engine: AgentEngine) => Promise<void>;
  status: Partial<Record<AgentEngine, AgentStatus>>;
  /** Installing or signing in right now. */
  busy: Partial<Record<AgentEngine, "install" | "login" | "logout">>;
  /** A model to ask for; empty: the engine's default. */
  models: Partial<Record<AgentEngine, string>>;
  refresh: (engine: AgentEngine) => Promise<void>;
  install: (engine: AgentEngine) => Promise<void>;
  login: (engine: AgentEngine) => Promise<void>;
  logout: (engine: AgentEngine) => Promise<void>;
  setModel: (engine: AgentEngine, model: string) => void;
}

/** ChatGPT (Codex) and Gemini, signed in with the user's own account. */
export const useAgentAccounts = create<AgentAccountsState>()(
  persist(
    (set, get) => {
      const busy = (
        engine: AgentEngine,
        what?: "install" | "login" | "logout",
      ) => set((s) => ({ busy: { ...s.busy, [engine]: what } }));
      return {
        status: {},
        busy: {},
        modelLists: {},
        loadModels: async (engine) => {
          if (get().modelLists[engine]?.length) return;
          try {
            const list = await invoke<AgentModel[]>("agent_models", {
              engine,
            });
            set((s) => ({ modelLists: { ...s.modelLists, [engine]: list } }));
          } catch {
            // Not installed yet, or offline: the menu offers the default.
          }
        },
        models: {},
        refresh: async (engine) => {
          try {
            const status = await invoke<AgentStatus>("agent_status", {
              engine,
            });
            set((s) => ({ status: { ...s.status, [engine]: status } }));
          } catch {
            // Not in the desktop app (tests, previews): nothing to show.
          }
        },
        install: async (engine) => {
          busy(engine, "install");
          try {
            await invoke("agent_install", { engine });
            toast.success(`${ENGINE_LABELS[engine]} is installed`);
          } catch (err) {
            toast.error(String(err));
          } finally {
            busy(engine);
            await get().refresh(engine);
          }
        },
        login: async (engine) => {
          busy(engine, "login");
          try {
            const ok = await invoke<boolean>("agent_login", { engine });
            if (ok) toast.success(`Signed in to ${ENGINE_LABELS[engine]}`);
            else
              toast.error(
                `Signing in to ${ENGINE_LABELS[engine]} didn't finish`,
              );
          } catch (err) {
            toast.error(String(err));
          } finally {
            busy(engine);
            await get().refresh(engine);
          }
        },
        logout: async (engine) => {
          busy(engine, "logout");
          try {
            await invoke("agent_logout", { engine });
          } catch (err) {
            toast.error(String(err));
          } finally {
            busy(engine);
            await get().refresh(engine);
          }
        },
        setModel: (engine, model) =>
          set((s) => ({ models: { ...s.models, [engine]: model.trim() } })),
      };
    },
    {
      name: "latex4all-agent-accounts",
      // Status is asked afresh; only the chosen models are kept.
      partialize: (s) => ({ models: s.models }),
    },
  ),
);

/** The engines signed in and ready to chat with. */
export function readyEngines(
  status: Partial<Record<AgentEngine, AgentStatus>>,
): AgentEngine[] {
  return ENGINES.filter((e) => status[e]?.installed && status[e]?.signed_in);
}
