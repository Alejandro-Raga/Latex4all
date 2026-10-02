import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronDownIcon, ChevronRightIcon, SearchIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const AIS = [
  {
    id: "claude",
    label: "Claude Code",
    hint: "Claude, and services added with an API key",
  },
  { id: "codex", label: "ChatGPT", hint: "Signed in with your account" },
  { id: "gemini", label: "Gemini", hint: "Signed in with your account" },
  { id: "copilot", label: "Copilot", hint: "Signed in with your account" },
] as const;
type Ai = (typeof AIS)[number]["id"];

interface LibrarySkill {
  folder: string;
  name: string;
  description: string;
  group: string | null;
  tokens: number;
  enabled: Record<Ai, boolean>;
}

interface Category {
  id: string;
  name: string;
  skills: { folder: string }[];
}

const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** On, off, or some: one switch for a skill or a whole group. */
function Check({
  state,
  onChange,
  label,
}: {
  state: boolean | "some";
  onChange: (on: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === "some" ? "mixed" : state}
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onChange(state !== true);
      }}
      className={cn(
        "flex size-4 items-center justify-center rounded border transition-colors",
        state === true
          ? "border-primary bg-primary text-primary-foreground"
          : state === "some"
            ? "border-primary bg-primary/30"
            : "border-muted-foreground/40 hover:border-foreground",
      )}
    >
      {state === true && <span className="text-[10px] leading-none">✓</span>}
    </button>
  );
}

/**
 * Settings → Skills: which assistant uses which skill, one by one or a
 * group at a time. Each skill adds its name and description to every
 * request of the assistants it's on for, so fewer means fewer tokens.
 */
export function SkillsSettings() {
  const [skills, setSkills] = useState<LibrarySkill[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSkills(await invoke<LibrarySkill[]>("skills_library"));
    } catch (err) {
      setSkills([]);
      toast.error(String(err));
    }
  }, []);
  useEffect(() => {
    void load();
    invoke<Category[]>("get_skill_categories")
      .then(setCategories)
      .catch(() => {});
  }, [load]);

  const categoryOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories) {
      for (const s of c.skills) map.set(s.folder, c.name);
    }
    return map;
  }, [categories]);

  const groupOf = useCallback(
    (s: LibrarySkill) => s.group ?? categoryOf.get(s.folder) ?? "Other",
    [categoryOf],
  );

  const groups = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const byGroup = new Map<string, LibrarySkill[]>();
    for (const s of skills ?? []) {
      const text =
        `${s.name} ${s.folder} ${s.description} ${groupOf(s)}`.toLowerCase();
      if (!words.every((w) => text.includes(w))) continue;
      const g = groupOf(s);
      byGroup.set(g, [...(byGroup.get(g) ?? []), s]);
    }
    return [...byGroup].sort(([a], [b]) => a.localeCompare(b));
  }, [skills, query, groupOf]);

  const totals = useMemo(() => {
    const t: Record<Ai, { count: number; tokens: number }> = {
      claude: { count: 0, tokens: 0 },
      codex: { count: 0, tokens: 0 },
      gemini: { count: 0, tokens: 0 },
      copilot: { count: 0, tokens: 0 },
    };
    for (const s of skills ?? []) {
      for (const ai of AIS) {
        if (s.enabled[ai.id]) {
          t[ai.id].count++;
          t[ai.id].tokens += s.tokens;
        }
      }
    }
    return t;
  }, [skills]);

  const set = async (list: LibrarySkill[], ai: Ai, enabled: boolean) => {
    // Shown at once; the folders follow.
    setSkills((prev) =>
      (prev ?? []).map((s) =>
        list.some((x) => x.folder === s.folder)
          ? { ...s, enabled: { ...s.enabled, [ai]: enabled } }
          : s,
      ),
    );
    try {
      await invoke("skills_set", {
        changes: list.map((s) => ({ folder: s.folder, ai, enabled })),
      });
    } catch (err) {
      toast.error(String(err));
      void load();
    }
  };

  const moveTo = async (folder: string, group: string) => {
    try {
      await invoke("skills_set_group", {
        folders: [folder],
        group: group.trim() || null,
      });
      void load();
    } catch (err) {
      toast.error(String(err));
    }
  };

  const stateOf = (list: LibrarySkill[], ai: Ai): boolean | "some" => {
    const on = list.filter((s) => s.enabled[ai]).length;
    return on === 0 ? false : on === list.length ? true : "some";
  };

  if (skills === null) {
    return <p className="px-5 py-4 text-muted-foreground text-sm">Loading…</p>;
  }
  if (skills.length === 0) {
    return (
      <p className="px-5 py-4 text-muted-foreground text-sm">
        No skills installed. Settings → Environment installs the scientific
        skills.
      </p>
    );
  }

  const groupNames = groups.map(([g]) => g);
  const cols =
    "grid grid-cols-[minmax(0,1fr)_repeat(4,4.5rem)] items-center gap-x-2";

  return (
    <div className="py-2">
      <div className={cn(cols, "px-5 pt-1 pb-2")}>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a skill or group…"
            aria-label="Find a skill"
            className="h-7 pl-7 text-xs"
          />
        </div>
        {AIS.map((ai) => (
          <div key={ai.id} className="text-center" title={ai.hint}>
            <div className="truncate font-medium text-xs">{ai.label}</div>
            <div className="text-[10px] text-muted-foreground tabular-nums">
              {totals[ai.id].count} · {k(totals[ai.id].tokens)} tok
            </div>
          </div>
        ))}
      </div>
      <p className="px-5 pb-2 text-muted-foreground text-xs">
        Tokens: what the enabled skills add to each request.
      </p>

      <div className="border-border border-t">
        {groups.map(([group, list]) => {
          const isOpen = open.has(group) || query.trim() !== "";
          return (
            <div key={group} className="border-border border-b">
              <div
                role="button"
                tabIndex={0}
                onClick={() =>
                  setOpen((prev) => {
                    const next = new Set(prev);
                    if (next.has(group)) next.delete(group);
                    else next.add(group);
                    return next;
                  })
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter")
                    (e.currentTarget as HTMLElement).click();
                }}
                className={cn(
                  cols,
                  "cursor-default px-5 py-2 hover:bg-muted/40",
                )}
              >
                <span className="flex min-w-0 items-center gap-1 text-sm">
                  {isOpen ? (
                    <ChevronDownIcon className="size-3.5 shrink-0" />
                  ) : (
                    <ChevronRightIcon className="size-3.5 shrink-0" />
                  )}
                  <span className="truncate font-medium">{group}</span>
                  <span className="text-muted-foreground text-xs">
                    {list.length}
                  </span>
                </span>
                {AIS.map((ai) => (
                  <div key={ai.id} className="flex justify-center">
                    <Check
                      state={stateOf(list, ai.id)}
                      onChange={(on) => set(list, ai.id, on)}
                      label={`${group} for ${ai.label}`}
                    />
                  </div>
                ))}
              </div>
              {isOpen &&
                list.map((s) => (
                  <div key={s.folder}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() =>
                        setExpanded((e) => (e === s.folder ? null : s.folder))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter")
                          (e.currentTarget as HTMLElement).click();
                      }}
                      className={cn(
                        cols,
                        "cursor-default py-1.5 pr-5 pl-10 hover:bg-muted/40",
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm">{s.name}</span>
                        <span className="block truncate text-muted-foreground text-xs">
                          {k(s.tokens)} tok · {s.description}
                        </span>
                      </span>
                      {AIS.map((ai) => (
                        <div key={ai.id} className="flex justify-center">
                          <Check
                            state={s.enabled[ai.id]}
                            onChange={(on) => set([s], ai.id, on)}
                            label={`${s.name} for ${ai.label}`}
                          />
                        </div>
                      ))}
                    </div>
                    {expanded === s.folder && (
                      <SkillDetail
                        skill={s}
                        group={groupOf(s)}
                        groups={groupNames}
                        onMove={(g) => moveTo(s.folder, g)}
                      />
                    )}
                  </div>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SkillDetail({
  skill,
  group,
  groups,
  onMove,
}: {
  skill: LibrarySkill;
  group: string;
  groups: string[];
  onMove: (group: string) => void;
}) {
  const [value, setValue] = useState(group);
  return (
    <div className="space-y-2 bg-muted/30 py-2 pr-5 pl-10">
      <p className="text-muted-foreground text-xs">{skill.description}</p>
      <div className="flex items-center gap-2">
        <span className="text-xs">Group</span>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          list={`skill-groups-${skill.folder}`}
          className="h-7 w-56 text-xs"
          aria-label="Group"
        />
        <datalist id={`skill-groups-${skill.folder}`}>
          {groups.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
        <Button
          size="sm"
          variant="outline"
          className="h-7"
          disabled={value.trim() === group}
          onClick={() => onMove(value)}
        >
          Move
        </Button>
        {skill.group && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            onClick={() => onMove("")}
          >
            Reset category
          </Button>
        )}
      </div>
    </div>
  );
}
