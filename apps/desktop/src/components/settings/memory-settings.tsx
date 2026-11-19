import { cn } from "@/lib/utils";
import {
  DEFAULT_MEMORY,
  type MemorySettings as Memory,
  useSettingsStore,
} from "@/stores/settings-store";
import { SettingRow, Toggle } from "./settings-parts";

/** A few choices side by side. */
function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex rounded-md border border-border p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded px-2 py-0.5 text-xs",
            value === o.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const FRESH: Memory = {
  start: "home",
  library: "home",
  vaultLibrary: "home",
  vaultProject: "project",
};

/** Settings → Where things open. */
export function MemorySettings() {
  const memory = { ...DEFAULT_MEMORY, ...useSettingsStore((s) => s.memory) };
  const setMemory = useSettingsStore((s) => s.setMemory);
  const fresh =
    memory.start === "home" &&
    memory.library === "home" &&
    memory.vaultLibrary === "home";
  return (
    <div className="divide-y divide-border/60">
      <SettingRow
        label="Start fresh every time"
        detail="After a restart, open Home, and the Library and vault at their start pages."
      >
        <Toggle
          label="Start fresh every time"
          checked={fresh}
          onChange={(on) => setMemory(on ? FRESH : DEFAULT_MEMORY)}
        />
      </SettingRow>
      <SettingRow label="On launch" detail="What the app shows when it starts.">
        <Choice
          label="On launch"
          value={memory.start}
          options={[
            { value: "last", label: "Where I left off" },
            { value: "home", label: "Home" },
          ]}
          onChange={(start) => setMemory({ start })}
        />
      </SettingRow>
      <SettingRow
        label="Library"
        detail="What the Library shows after a restart."
      >
        <Choice
          label="Library after a restart"
          value={memory.library}
          options={[
            { value: "last", label: "Last paper" },
            { value: "home", label: "Start page" },
          ]}
          onChange={(library) => setMemory({ library })}
        />
      </SettingRow>
      <SettingRow
        label="Vault in the Library"
        detail="What the vault shows after a restart. While the app is open, it stays on the last note."
      >
        <Choice
          label="Vault in the Library after a restart"
          value={memory.vaultLibrary}
          options={[
            { value: "home", label: "Main page" },
            { value: "last", label: "Last note" },
          ]}
          onChange={(vaultLibrary) => setMemory({ vaultLibrary })}
        />
      </SettingRow>
      <SettingRow
        label="Vault in a project"
        detail="What the vault shows when you open a project. Without a project note, it shows the whole vault."
      >
        <Choice
          label="Vault in a project"
          value={memory.vaultProject}
          options={[
            { value: "project", label: "Project's note" },
            { value: "last", label: "Last note" },
            { value: "home", label: "Main page" },
          ]}
          onChange={(vaultProject) => setMemory({ vaultProject })}
        />
      </SettingRow>
    </div>
  );
}
