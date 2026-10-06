import { useEffect, useMemo, useRef, useState } from "react";
import { LightbulbIcon, Loader2Icon, PlusIcon, TagIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { PassageGroup } from "@/lib/vault/add-passage";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useDockStore } from "@/stores/dock-store";
import { useVaultStore } from "@/stores/vault-store";

/**
 * Picks the idea (or topic) a highlight goes under: the vault's own, found
 * by typing, or a new one by the name typed.
 */
export function GroupPicker({
  group,
  anchor,
  onPick,
  onCancel,
}: {
  group: PassageGroup;
  anchor: { left: number; top: number };
  onPick: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const index = useVaultStore((s) => s.index);
  const boxRef = useRef<HTMLDivElement>(null);
  // Esc, or a click anywhere else, closes it, wherever the focus is.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      }
    };
    const click = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) onCancel();
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("mousedown", click, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("mousedown", click, true);
    };
  }, [onCancel]);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const existing = useMemo(
    () =>
      (index?.list ?? [])
        .filter((n) => n.kind === group)
        .map((n) => n.title || n.name)
        .sort((a, b) => a.localeCompare(b)),
    [index, group],
  );
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = existing
    .filter((name) => words.every((w) => name.toLowerCase().includes(w)))
    .slice(0, 8);
  const typed = query.trim();
  const isNew =
    typed !== "" &&
    !existing.some((n) => n.toLowerCase() === typed.toLowerCase());
  const options = [
    ...(isNew ? [{ name: typed, isNew: true }] : []),
    ...matches.map((name) => ({ name, isNew: false })),
  ];
  const label = group === "idea" ? "idea" : "topic";
  const Icon = group === "idea" ? LightbulbIcon : TagIcon;

  const pick = async (name: string) => {
    if (busy || !name.trim()) return;
    setBusy(true);
    try {
      await onPick(name.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      ref={boxRef}
      className="fixed z-50 w-72 rounded-lg border border-border bg-background p-2 shadow-xl"
      style={{
        left: Math.min(anchor.left, window.innerWidth - 300),
        top: Math.min(anchor.top + 8, window.innerHeight - 320),
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActive((i) => Math.min(i + 1, options.length - 1));
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setActive((i) => Math.max(i - 1, 0));
        }
        if (e.key === "Enter") {
          e.preventDefault();
          void pick(options[active]?.name ?? typed);
        }
      }}
    >
      <div className="mb-1.5 flex items-center gap-1.5 px-1 font-medium text-xs">
        <Icon className="size-3.5 text-muted-foreground" />
        Add to {label}
        {busy && <Loader2Icon className="ml-auto size-3.5 animate-spin" />}
      </div>
      <Input
        autoFocus
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        placeholder={
          group === "idea" ? "An idea, new or yours…" : "A topic, new or yours…"
        }
        aria-label={`Name of the ${label}`}
        className="h-7 text-xs"
        disabled={busy}
      />
      <div className="mt-1 max-h-56 overflow-y-auto">
        {options.map((o, i) => (
          <button
            key={`${o.isNew}:${o.name}`}
            type="button"
            disabled={busy}
            onMouseEnter={() => setActive(i)}
            onClick={() => void pick(o.name)}
            className={cn(
              "flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs",
              i === active ? "bg-muted" : "hover:bg-muted/60",
            )}
          >
            {o.isNew ? (
              <>
                <PlusIcon className="size-3 shrink-0" />
                <span className="truncate">
                  New {label} “{o.name}”
                </span>
              </>
            ) : (
              <span className="truncate">{o.name}</span>
            )}
          </button>
        ))}
        {options.length === 0 && (
          <p className="px-2 py-1.5 text-muted-foreground text-xs">
            {existing.length
              ? `No ${label} by that name. Type one to make it.`
              : `Type a name for your first ${label}.`}
          </p>
        )}
      </div>
    </div>
  );
}

/** Says where a passage went, with a way to open that note. */
export function filedToast(group: PassageGroup, note: string) {
  toast.success(
    `Added to ${group === "idea" ? "the idea" : "the topic"} “${note}”`,
    {
      action: {
        label: "Open",
        onClick: () => {
          useDockStore.getState().setOpen("vault", true);
          useVaultStore.getState().open(note);
        },
      },
    },
  );
}
