import { useMemo } from "react";
import { PlusIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { groupColor } from "@/components/workspace/vault-panel";
import { KIND_GROUPS } from "@/lib/vault/vault-index";
import {
  useGroupColors,
  useNoteTypes,
  useVaultStore,
} from "@/stores/vault-store";

const NEW_TYPE_COLORS = ["#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16"];

/** A color swatch that opens the system color picker, with a reset. */
function ColorPick({
  group,
  kind,
  label,
}: {
  group: string;
  kind?: string;
  label: string;
}) {
  const picked = useGroupColors()[group];
  const setGroupColor = useVaultStore((s) => s.setGroupColor);
  // Read afresh each render: it follows picks and type colors.
  const color = groupColor(group, kind);
  return (
    <span className="flex shrink-0 items-center gap-1">
      <input
        type="color"
        value={color}
        onChange={(e) => setGroupColor(group, e.target.value)}
        aria-label={`Color for ${label}`}
        className="size-6 cursor-pointer rounded border border-border bg-transparent p-0.5"
      />
      {picked && (
        <button
          type="button"
          onClick={() => setGroupColor(group, null)}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          title="Back to its own color"
          aria-label={`Reset the color for ${label}`}
        >
          <RotateCcwIcon className="size-3" />
        </button>
      )}
    </span>
  );
}

/**
 * Note types for Settings → Vault: the built-in ones and folders (color
 * only), and your own (name, color, and the folder or tag that brings notes
 * into them on their own).
 */
export function NoteTypesSettings() {
  const types = useNoteTypes();
  const index = useVaultStore((s) => s.index);
  const addNoteType = useVaultStore((s) => s.addNoteType);
  const updateNoteType = useVaultStore((s) => s.updateNoteType);
  const removeNoteType = useVaultStore((s) => s.removeNoteType);
  const setGroupColor = useVaultStore((s) => s.setGroupColor);

  // Folders that group plain notes, as the vault has them now.
  const folders = useMemo(() => {
    const names = new Set<string>();
    for (const n of index?.list ?? []) {
      if (n.kind === "note" && n.group) names.add(n.group);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [index]);

  const builtIn = Object.entries(KIND_GROUPS) as [string, string][];
  const row = "flex items-center gap-2 px-5 py-2";

  return (
    <div className="py-2">
      <div className="px-5 pt-1 pb-2">
        <div className="text-sm">Note types</div>
        <div className="text-muted-foreground text-xs">
          A type's folder is where its notes live: choosing the type moves a
          note there. Notes in it, or with its tag, get the type on their own.
        </div>
      </div>

      {builtIn.map(([kind, group]) => (
        <div key={kind} className={row}>
          <ColorPick group={group} kind={kind} label={group} />
          <span className="text-sm">{group}</span>
          <span className="ml-auto text-muted-foreground text-xs">
            Built in
          </span>
        </div>
      ))}

      {types.map((t) => (
        <div key={t.id} className={`${row} flex-wrap`}>
          <input
            type="color"
            value={t.color}
            onChange={(e) => {
              updateNoteType(t.id, { color: e.target.value });
              // Its own color, not an older pick for the same name.
              setGroupColor(t.label, null);
            }}
            aria-label={`Color for ${t.label}`}
            className="size-6 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0.5"
          />
          <Input
            value={t.label}
            onChange={(e) => updateNoteType(t.id, { label: e.target.value })}
            className="h-7 w-28 text-xs"
            aria-label="Type name"
          />
          <Input
            value={t.folder ?? ""}
            onChange={(e) =>
              updateNoteType(t.id, { folder: e.target.value || undefined })
            }
            placeholder="Folder (optional)"
            className="h-7 min-w-0 flex-1 text-xs"
            aria-label={`Folder for ${t.label}`}
          />
          <Input
            value={t.tag ?? ""}
            onChange={(e) =>
              updateNoteType(t.id, { tag: e.target.value || undefined })
            }
            placeholder="#tag"
            className="h-7 w-24 text-xs"
            aria-label={`Tag for ${t.label}`}
          />
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            onClick={() => removeNoteType(t.id)}
            aria-label={`Delete ${t.label}`}
            title="Delete this type"
          >
            <Trash2Icon className="size-3.5" />
          </Button>
        </div>
      ))}

      <div className="px-5 py-2">
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={() =>
            addNoteType(
              "New type",
              NEW_TYPE_COLORS[types.length % NEW_TYPE_COLORS.length],
            )
          }
        >
          <PlusIcon className="size-3.5" />
          Add a type
        </Button>
      </div>

      {folders.length > 0 && (
        <>
          <div className="px-5 pt-3 pb-1 text-muted-foreground text-xs">
            Folders
          </div>
          {folders.map((folder) => (
            <div key={folder} className={row}>
              <ColorPick group={folder} label={folder} />
              <span className="truncate text-sm">{folder}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
