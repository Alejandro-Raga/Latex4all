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
        detail="Open on Home, with the Library and vault at their start, after every restart."
      >
        <Toggle
          label="Start fresh every time"
          checked={fresh}
          onChange={(on) => setMemory(on ? FRESH : DEFAULT_MEMORY)}
        />
      </SettingRow>
      <SettingRow label="On launch" detail="Where the app opens.">
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
        detail="After a restart: the paper and project you had open, or the start."
      >
        <Choice
          label="Library after a restart"
          value={memory.library}
          options={[
            { value: "last", label: "Last paper" },
            { value: "home", label: "Start" },
          ]}
          onChange={(library) => setMemory({ library })}
        />
      </SettingRow>
      <SettingRow
        label="Vault in the Library"
        detail="After a restart. While the app is open it stays where you left it."
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
        detail="On opening a project. Its note, or the whole vault if it has none."
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
